# n8n Scraper Project

## Overview
n8n deployed on Kubernetes scraping German news articles (Tagesspiegel, WiWo, SZ-Dossier, Capital).

- **Namespace:** `preme-n8n`
- **Deployment:** `n8n`
- **Two containers in pod:** `n8n` (main) and `task-runner` (sidecar)
- **GitHub repo:** https://github.com/vts30/my-test3

## Architecture
Workflow has 3 Code nodes:
- `node1-source-config.js` — source/publication config
- `node2-get-articles.js` — article list scraper
- `node3-scrape-article.js` — article content scraper

Code nodes run via the **internal task-runner** (subprocess inside the n8n container). The sidecar `task-runner` container is present but unused in current mode.

## Kubernetes Setup

### Apply env patch
```bash
kubectl patch deployment n8n -n preme-n8n --patch-file n8n-env-patch.yaml
```

### Key env vars (n8n container)
| Variable | Value |
|---|---|
| `N8N_RUNNERS_MODE` | `internal` |
| `N8N_RUNNERS_ENABLED` | `true` |
| `N8N_RUNNERS_TASK_TIMEOUT` | `600` |
| `N8N_RUNNERS_AUTH_TOKEN` | `premeIsMegaCool` |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` |
| `NODE_FUNCTION_ALLOW_EXTERNAL` | `*` |

### Credentials
- K8s secret `scraper-creds` mounted on both containers → `$env.TS_EMAIL`, `$env.TS_PASSWORD`

## Docker Image

- **Local tag:** `my-n8n:latest`
- **Harbor tag:** `preme-n8n-base:1.0.10`
- Packages installed to `/install/node_modules`: `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `puppeteer-core`, `crawlee`, `n8n-nodes-firecrawl`, `n8n-nodes-pdfco`
- `NODE_PATH=/install/node_modules` set in image
- Chromium at `/usr/bin/chromium-browser` (n8n container only)

### Symlink fix (already applied in image)
Internal task-runner subprocess doesn't inherit `NODE_PATH`, so packages are symlinked into `/home/node/node_modules`:
```dockerfile
RUN mkdir -p /home/node/node_modules && \
    ln -s /install/node_modules/puppeteer-extra /home/node/node_modules/puppeteer-extra && \
    ln -s /install/node_modules/puppeteer-extra-plugin-stealth /home/node/node_modules/puppeteer-extra-plugin-stealth && \
    ln -s /install/node_modules/puppeteer-core /home/node/node_modules/puppeteer-core
```

### Build & deploy
```bash
# Build
docker build -t my-n8n:latest .

# Test puppeteer modules load
docker run --rm -v $(pwd)/test-modules.js:/tmp/test-modules.js \
  --entrypoint /usr/local/bin/node my-n8n:latest /tmp/test-modules.js

# Push to Harbor (tag with real harbor host first)
docker tag my-n8n:latest <harbor-host>/preme/preme-n8n-base:1.0.10
docker push <harbor-host>/preme/preme-n8n-base:1.0.10

# Restart pod
kubectl rollout restart deployment/n8n -n preme-n8n
```

## Common Debug Commands

```bash
# Watch pods
kubectl get pods -n preme-n8n -w

# Check env vars on n8n container
kubectl exec -it deployment/n8n -n preme-n8n -c n8n -- env | grep RUNNERS

# Test puppeteer in n8n container
kubectl exec -it deployment/n8n -n preme-n8n -c n8n -- node -e "require('puppeteer-extra'); console.log('OK')"

# Test all 3 puppeteer modules in task-runner container
kubectl exec -it deployment/n8n -n preme-n8n -c task-runner -- node -e "
['puppeteer-extra','puppeteer-extra-plugin-stealth','puppeteer-core'].forEach(p => {
  try { require(p); console.log(p + ' OK'); }
  catch(e) { console.log(p + ' FAIL: ' + e.message); }
})"

# Pod logs
kubectl logs deployment/n8n -n preme-n8n -c n8n --tail=50
kubectl logs deployment/n8n -n preme-n8n -c task-runner --tail=50
```

## Full Project History (never lose this)

### Phase 1 — Basic Setup
- Created n8n workflow for Tagesspiegel, WiWo, SZ-Dossier, Capital
- Fixed N8N_PORT conflict (K8s service links injecting wrong port → used `enableServiceLinks: false` then removed)
- Fixed task-runner 401 → added `N8N_RUNNERS_AUTH_TOKEN`
- Fixed `$env` credentials access for `TS_EMAIL`/`TS_PASSWORD`

### Phase 2 — Connectivity / Proxy
- Got `ERR_CONNECTION_RESET` and SSL errors on all sites
- Investigated: CA certs, VirtualService deletion, Istio egress gateway
- **Root cause: Istio was blocking all outbound traffic**
- Fix: pass corporate proxy via `--proxy-server` arg to Chromium launch

### Phase 3 — Internal Task-Runner (first time)
- Task-runner sidecar didn't have puppeteer → switched to internal mode (`N8N_RUNNERS_ENABLED=false`, `N8N_RUNNERS_MODE=internal`)
- Built custom Docker image `preme-n8n-base:1.0.10` with puppeteer at `/install/node_modules`
- Internal runner subprocess (child process) doesn't inherit `NODE_PATH` → fixed with Dockerfile symlinks into `/home/node/node_modules`
- ✅ Internal runner + scraping worked

### Phase 4 — External Task-Runner attempt (failed)
- Built custom task-runner image `preme-n8n-runner:1.0.5` with puppeteer + Chromium
- Fixed `NODE_FUNCTION_ALLOW_EXTERNAL` blocked by `n8n-task-runners.json` (internal config file in runner image)
- Fixed `puppeteer-core Errors.js` sandbox patch
- ✅ Puppeteer modules loaded OK, Chromium launched
- ❌ Navigation through corporate proxy kept hanging/timing out
- Tried: timeout 120s → 300s → 600s, `domcontentloaded`, `setDefaultNavigationTimeout(0)`, doubled resources
- Root cause never fully confirmed — suspected CPU throttle (500m limit) + proxy latency compound effect
- **Decision: external runner too slow/unreliable for Chromium through proxy → abandoned**

### Phase 5 — External Runner Fixed (2026-03-26) ✅
- Root cause found: `page.type()` keyboard events have `isTrusted: false` in external runner
- background.tagesspiegel.de login form rejects untrusted keyboard events → email field stays empty
- Fix: `USE_NATIVE_SETTER = true` in node1 → uses `page.evaluate()` with native HTMLInputElement value setter
- `console.log` does NOT work in external runner Code nodes — use `throw new Error()` for debugging
- Both internal and external runner now work — toggle via `USE_NATIVE_SETTER` flag in node1

## Notes
- Use `k` as alias for `kubectl`
- Corporate npm proxy: `sdst.sbaintern.de`
- Company uses `pnpm` (not npm) in the task-runner container
- Harbor allows overwriting the same tag (`1.0.10`) without bumping version
- Debug commands are tracked in `debug-commands.txt` and pushed to GitHub after each investigation step
- Screenshots/debug images saved to `picture/`
