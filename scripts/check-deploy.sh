#!/bin/sh
set -eu

attempt=0
while [ "$attempt" -lt "${DEPLOY_HEALTH_ATTEMPTS:-6}" ]; do
  if curl --fail --silent --show-error --max-time 5 http://localhost:8000/healthz; then
    echo ' [deploy OK]'
    exit 0
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -lt "${DEPLOY_HEALTH_ATTEMPTS:-6}" ]; then
    sleep "${DEPLOY_HEALTH_DELAY:-10}"
  fi
done
echo 'Deployment failed: the API did not become healthy.' >&2
exit 1
