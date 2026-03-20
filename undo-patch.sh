#!/bin/bash

NAMESPACE=preme-n8n
DEPLOYMENT=n8n

echo "=== Step 1: Remove added env vars from n8n container ==="
kubectl set env deployment/$DEPLOYMENT -n $NAMESPACE -c n8n \
  N8N_LISTEN_ADDRESS- \
  N8N_HOST- \
  N8N_PORT- \
  N8N_DIAGNOSTICS_ENABLED- \
  NODE_FUNCTION_ALLOW_EXTERNAL- 2>/dev/null || true

echo "=== Step 2: Re-enable service links ==="
kubectl patch deployment $DEPLOYMENT -n $NAMESPACE --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/enableServiceLinks"}
]' 2>/dev/null || echo "  (enableServiceLinks not set — skipping)"

echo "=== Step 3: Remove envFrom from n8n container (index 0) ==="
kubectl patch deployment $DEPLOYMENT -n $NAMESPACE --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/containers/0/envFrom"}
]' 2>/dev/null || echo "  (envFrom not present on n8n container — skipping)"

echo "=== Step 4: Remove envFrom from task-runner container (index 1) ==="
kubectl patch deployment $DEPLOYMENT -n $NAMESPACE --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/containers/1/envFrom"}
]' 2>/dev/null || echo "  (envFrom not present on task-runner container — skipping)"

echo ""
echo "=== Current env vars ==="
kubectl set env deployment/$DEPLOYMENT -n $NAMESPACE --list

echo ""
echo "=== Watching pods ==="
kubectl get pods -n $NAMESPACE -w
