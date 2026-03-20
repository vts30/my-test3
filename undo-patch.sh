#!/bin/bash
set -e

NAMESPACE=preme-n8n
DEPLOYMENT=n8n

echo "Removing added env vars from n8n container..."
kubectl set env deployment/$DEPLOYMENT -n $NAMESPACE -c n8n \
  N8N_HOST- \
  N8N_PORT- \
  NODE_FUNCTION_ALLOW_EXTERNAL-

echo "Removing envFrom (scraper-creds) from n8n container..."
kubectl patch deployment $DEPLOYMENT -n $NAMESPACE --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/containers/0/envFrom"}
]'

echo "Removing envFrom (scraper-creds) from task-runner container..."
kubectl patch deployment $DEPLOYMENT -n $NAMESPACE --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/containers/1/envFrom"}
]'

echo "Done. Watching pods..."
kubectl get pods -n $NAMESPACE -w
