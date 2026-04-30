#!/usr/bin/env bash
# Runs terraform plan across all stage directories and generates a change report.
# Usage: ./tf-plan-report.sh [--stages-dir <path>] [--env idst|dst|all] [--region vfz1|vfz2|all]
#
# Requires: terraform, kubectl, and valid credentials/kubeconfig already set.
# Kube context is switched automatically before each stage using the pattern:
#   {env}-{region}-preme-fqdn  (e.g. idst-vfz1-preme-fqdn)
# Override the suffix with --context-suffix if your names differ.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
STAGES_DIR="stages"
FILTER_ENV="all"       # idst | dst | all
FILTER_REGION="all"    # vfz1 | vfz2 | all
REPORT_FILE="tf-plan-report-$(date +%Y%m%d-%H%M%S).txt"
PARALLEL=false         # set true to run plans in parallel (risks lock conflicts)
CONTEXT_SUFFIX="preme-fqdn"   # appended after {env}-{region}-

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stages-dir) STAGES_DIR="$2"; shift 2 ;;
    --env)        FILTER_ENV="$2"; shift 2 ;;
    --region)     FILTER_REGION="$2"; shift 2 ;;
    --parallel)        PARALLEL=true; shift ;;
    --output)          REPORT_FILE="$2"; shift 2 ;;
    --context-suffix)  CONTEXT_SUFFIX="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ ! -d "$STAGES_DIR" ]]; then
  echo -e "${RED}Error:${RESET} stages directory '${STAGES_DIR}' not found."
  echo "Run from the repo root, or pass --stages-dir <path>."
  exit 1
fi

# ── Discover stage directories ────────────────────────────────────────────────
discover_stages() {
  local dirs=()
  while IFS= read -r -d '' d; do
    local base
    base=$(basename "$d")
    # Match pattern: <anything>-<env>-<region>  where env=idst|dst, region=vfz1|vfz2
    if [[ ! "$base" =~ ^.+-(idst|dst)-vfz[0-9]+$ ]]; then
      continue
    fi
    local env region
    env=$(echo "$base"   | grep -oE '(idst|dst)')
    region=$(echo "$base" | grep -oE 'vfz[0-9]+')
    [[ "$FILTER_ENV"    != "all" && "$env"    != "$FILTER_ENV"    ]] && continue
    [[ "$FILTER_REGION" != "all" && "$region" != "$FILTER_REGION" ]] && continue
    dirs+=("$d")
  done < <(find "$STAGES_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
  printf '%s\n' "${dirs[@]}"
}

# ── Switch kube context for an env+region ────────────────────────────────────
switch_context() {
  local env="$1"
  local region="$2"
  local ctx="${env}-${region}-${CONTEXT_SUFFIX}"

  # Check the context exists before switching
  if ! kubectl config get-contexts "$ctx" &>/dev/null; then
    echo -e "${YELLOW}  Warning:${RESET} kube context '$ctx' not found — skipping context switch." >&2
    return 0
  fi

  kubectl config use-context "$ctx" > /dev/null
  echo -e "  ${CYAN}context${RESET}   switched to $ctx"
}

# ── Run terraform plan in one directory ───────────────────────────────────────
# Writes plan output to a tmp file, returns 0/1/2 (success/error/changes)
run_plan() {
  local stage_dir="$1"
  local out_file="$2"
  local log_file="${out_file}.log"
  local env="$3"
  local region="$4"

  switch_context "$env" "$region"

  pushd "$stage_dir" > /dev/null

  # Init only if .terraform is missing or providers need refresh
  if [[ ! -d ".terraform" ]]; then
    terraform init -input=false -no-color > "$log_file" 2>&1 || {
      echo "INIT_FAILED" > "$out_file"
      popd > /dev/null
      return 1
    }
  fi

  terraform plan -input=false -no-color -out="${out_file}.tfplan" \
    >> "$log_file" 2>&1
  local exit_code=$?

  # exit 0 = no changes, exit 2 = changes present, anything else = error
  if [[ $exit_code -eq 0 || $exit_code -eq 2 ]]; then
    terraform show -no-color "${out_file}.tfplan" > "$out_file" 2>> "$log_file"
    rm -f "${out_file}.tfplan"
  else
    echo "PLAN_FAILED" > "$out_file"
  fi

  popd > /dev/null
  return $exit_code
}

# ── Parse plan output ─────────────────────────────────────────────────────────
parse_plan() {
  local plan_file="$1"

  if grep -q "INIT_FAILED\|PLAN_FAILED" "$plan_file" 2>/dev/null; then
    echo "ERROR"
    return
  fi

  local summary
  summary=$(grep -E '^Plan:' "$plan_file" 2>/dev/null | tail -1)

  if [[ -z "$summary" ]]; then
    # No "Plan:" line → no changes
    echo "0 to add, 0 to change, 0 to destroy"
    return
  fi

  # Extract numbers from "Plan: X to add, Y to change, Z to destroy."
  local add chg destroy
  add=$(    echo "$summary" | grep -oE '[0-9]+ to add'     | grep -oE '[0-9]+' || echo 0)
  chg=$(    echo "$summary" | grep -oE '[0-9]+ to change'  | grep -oE '[0-9]+' || echo 0)
  destroy=$(echo "$summary" | grep -oE '[0-9]+ to destroy' | grep -oE '[0-9]+' || echo 0)
  echo "${add} to add, ${chg} to change, ${destroy} to destroy"
}

# ── Collect changed resources from plan output ────────────────────────────────
parse_changes() {
  local plan_file="$1"
  grep "# module\." "$plan_file" 2>/dev/null \
    | sed 's/^\s*/  /' \
    | head -50
}

# ── Main ──────────────────────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
ORIGINAL_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")
restore_context() {
  rm -rf "$TMP_DIR"
  if [[ -n "$ORIGINAL_CONTEXT" ]]; then
    kubectl config use-context "$ORIGINAL_CONTEXT" > /dev/null 2>&1 || true
    echo -e "\n${CYAN}Restored kube context to:${RESET} $ORIGINAL_CONTEXT"
  fi
}
trap restore_context EXIT

mapfile -t STAGES < <(discover_stages)

if [[ ${#STAGES[@]} -eq 0 ]]; then
  echo -e "${YELLOW}No matching stage directories found.${RESET}"
  echo "  stages-dir : $STAGES_DIR"
  echo "  env filter : $FILTER_ENV"
  echo "  region     : $FILTER_REGION"
  exit 0
fi

echo -e "${BOLD}${CYAN}Terraform Plan Report${RESET}"
echo -e "Env: ${FILTER_ENV}  |  Region: ${FILTER_REGION}  |  Stages: ${#STAGES[@]}"
echo ""

declare -A PLAN_FILES
declare -A STAGE_STATUS   # "ok" | "error"

run_single() {
  local stage="$1"
  local name env region
  name=$(basename "$stage")
  env=$(echo "$name"    | grep -oE '(idst|dst)')
  region=$(echo "$name" | grep -oE 'vfz[0-9]+')
  local out="${TMP_DIR}/${name}.plan"

  echo -e "  ${CYAN}planning${RESET}  $name ..."
  run_plan "$stage" "$out" "$env" "$region"
  local ec=$?
  if [[ $ec -eq 0 || $ec -eq 2 ]]; then
    STAGE_STATUS[$stage]="ok"
  else
    STAGE_STATUS[$stage]="error"
  fi
  PLAN_FILES[$stage]="$out"
}

if [[ "$PARALLEL" == "true" ]]; then
  for stage in "${STAGES[@]}"; do
    run_single "$stage" &
  done
  wait
else
  for stage in "${STAGES[@]}"; do
    run_single "$stage"
  done
fi

# ── Build report ──────────────────────────────────────────────────────────────
{
  echo "==============================================================="
  echo " TERRAFORM PLAN REPORT — $(date)"
  echo " Env: ${FILTER_ENV}   Region: ${FILTER_REGION}"
  echo "==============================================================="
  echo ""

  total_add=0; total_chg=0; total_destroy=0; error_count=0; no_change_count=0; change_count=0

  for stage in "${STAGES[@]}"; do
    name=$(basename "$stage")
    env=$(echo "$name"    | grep -oE '(idst|dst)')
    region=$(echo "$name" | grep -oE 'vfz[0-9]+')
    pf="${PLAN_FILES[$stage]}"
    summary=$(parse_plan "$pf")

    if [[ "$summary" == "ERROR" ]]; then
      echo "[ ERROR ] $name"
      echo "  -> Check ${pf}.log for details"
      echo ""
      ((error_count++))
      continue
    fi

    add=$(    echo "$summary" | grep -oE '[0-9]+ to add'     | grep -oE '[0-9]+' || echo 0)
    chg=$(    echo "$summary" | grep -oE '[0-9]+ to change'  | grep -oE '[0-9]+' || echo 0)
    destroy=$(echo "$summary" | grep -oE '[0-9]+ to destroy' | grep -oE '[0-9]+' || echo 0)

    total_add=$(( total_add + add ))
    total_chg=$(( total_chg + chg ))
    total_destroy=$(( total_destroy + destroy ))

    if [[ $add -eq 0 && $chg -eq 0 && $destroy -eq 0 ]]; then
      echo "[ OK - NO CHANGES ] $name  (env: $env, region: $region)"
      ((no_change_count++))
    else
      echo "[ CHANGES ] $name  (env: $env, region: $region)"
      echo "  Summary : $summary"
      changes=$(parse_changes "$pf")
      if [[ -n "$changes" ]]; then
        echo "  Resources:"
        echo "$changes"
      fi
      echo ""
      ((change_count++))
    fi
  done

  echo ""
  echo "==============================================================="
  echo " TOTALS"
  echo "---------------------------------------------------------------"
  echo "  Stages scanned  : ${#STAGES[@]}"
  echo "  With changes    : $change_count"
  echo "  No changes      : $no_change_count"
  echo "  Errors          : $error_count"
  echo "---------------------------------------------------------------"
  echo "  Total to add    : $total_add"
  echo "  Total to change : $total_chg"
  echo "  Total to destroy: $total_destroy"
  echo "==============================================================="

} | tee "$REPORT_FILE"

# ── Coloured summary to terminal ──────────────────────────────────────────────
echo ""
if [[ $error_count -gt 0 ]]; then
  echo -e "${RED}${BOLD}$error_count stage(s) failed to plan — check the .log files.${RESET}"
fi
if [[ $total_destroy -gt 0 ]]; then
  echo -e "${RED}${BOLD}WARNING: $total_destroy resource(s) will be destroyed!${RESET}"
fi
if [[ $total_chg -gt 0 ]]; then
  echo -e "${YELLOW}$total_chg resource(s) will be changed.${RESET}"
fi
if [[ $change_count -eq 0 && $error_count -eq 0 ]]; then
  echo -e "${GREEN}All stages are up to date — no changes needed.${RESET}"
fi

echo ""
echo -e "Full report saved to: ${BOLD}${REPORT_FILE}${RESET}"
