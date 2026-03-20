#!/bin/bash

NAMESPACE=preme-n8n
DEPLOYMENT=n8n

echo "=== Step 1: Remove added env vars from n8n container ==="
kubectl set env deployment/$DEPLOYMENT -n $NAMESPACE -c n8n \
  N8N_LISTEN_ADDRESS- \
  N8N_WORKER_SERVER_ADDRESS- \
  N8N_HOST- \
  N8N_PORT- \
  N8N_DIAGNOSTICS_ENABLED- \
  N8N_RUNNERS_AUTH_TOKEN- \
  NODE_FUNCTION_ALLOW_EXTERNAL- 2>/dev/null || true

echo "=== Step 2: Remove envFrom from n8n container ==="
kubectl patch deployment $DEPLOYMENT -n $NAMESPACE --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/containers/0/envFrom"}
]' 2>/dev/null || echo "  (envFrom not present on n8n container — skipping)"

echo ""
echo "=== Current env vars ==="
kubectl set env deployment/$DEPLOYMENT -n $NAMESPACE --list

echo ""
echo "=== Watching pods ==="
kubectl get pods -n $NAMESPACE -w
