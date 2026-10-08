#!/bin/sh
set -eu
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
cat > "$test_dir/curl" <<'STUB'
#!/bin/sh
exit "${TEST_CURL_STATUS:-0}"
STUB
chmod +x "$test_dir/curl"
export PATH="$test_dir:$PATH" DEPLOY_HEALTH_ATTEMPTS=2 DEPLOY_HEALTH_DELAY=0
TEST_CURL_STATUS=0 sh scripts/check-deploy.sh
if TEST_CURL_STATUS=7 sh scripts/check-deploy.sh; then
  echo 'Unhealthy deployment incorrectly succeeded' >&2
  exit 1
fi
