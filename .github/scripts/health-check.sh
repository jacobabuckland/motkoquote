#!/bin/bash
set -e

# Health check script for post-deploy verification
# Reads critical paths from deploy-health-check.json and verifies each one
# Returns exit code 0 on success, non-zero on failure

DEPLOYMENT_URL="${1:-${DEPLOYMENT_URL}}"
CONFIG_FILE="${CONFIG_FILE:-deploy-health-check.json}"

if [ -z "$DEPLOYMENT_URL" ]; then
  echo "::error::DEPLOYMENT_URL is required (pass as first argument or environment variable)"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "::error::Configuration file $CONFIG_FILE not found"
  exit 1
fi

echo "Running health checks against $DEPLOYMENT_URL"
echo "Configuration: $CONFIG_FILE"

# Read the JSON configuration
PATHS=$(cat "$CONFIG_FILE" | jq -r '.paths')
TOTAL=$(echo "$PATHS" | jq 'length')

if [ "$TOTAL" -eq 0 ]; then
  echo "::error::No paths configured in $CONFIG_FILE"
  exit 1
fi

echo "Found $TOTAL critical paths to check"

# Warm-up phase: make initial requests to handle cold starts
echo ""
echo "=== Warm-up phase ==="
for i in $(seq 0 $((TOTAL - 1))); do
  PATH_ENTRY=$(echo "$PATHS" | jq -r ".[$i].path")
  FULL_URL="${DEPLOYMENT_URL}${PATH_ENTRY}"

  echo "Warming up: $PATH_ENTRY"

  # Make warm-up request, ignore result
  curl -s -o /dev/null -w "" \
    --max-time 30 \
    --retry 0 \
    "$FULL_URL" 2>/dev/null || true
done

# Wait after warm-up to let everything stabilize
echo "Waiting 10 seconds for cold start stabilization..."
sleep 10

# Actual health check phase
echo ""
echo "=== Health check phase ==="
FAILED=0
FAILED_PATHS=""

for i in $(seq 0 $((TOTAL - 1))); do
  PATH_ENTRY=$(echo "$PATHS" | jq -r ".[$i].path")
  REQUIRES_AUTH=$(echo "$PATHS" | jq -r ".[$i].requiresAuth")
  DESCRIPTION=$(echo "$PATHS" | jq -r ".[$i].description // \"\"")
  ACCEPTED_CODES=$(echo "$PATHS" | jq -r ".[$i].acceptedStatusCodes // [] | join(\",\")")

  # Default accepted codes if not specified
  if [ -z "$ACCEPTED_CODES" ]; then
    ACCEPTED_CODES="200,201,202,203,204,301,302,303,307,308"
  fi

  FULL_URL="${DEPLOYMENT_URL}${PATH_ENTRY}"

  echo ""
  echo "Checking: $PATH_ENTRY"
  [ -n "$DESCRIPTION" ] && echo "  Description: $DESCRIPTION"
  echo "  Requires auth: $REQUIRES_AUTH"
  echo "  Accepted status codes: $ACCEPTED_CODES"

  # Build curl command
  CURL_ARGS=(-s -w "\n%{http_code}" --max-time 30 --retry 2 --retry-delay 5)

  # Handle authentication if required
  if [ "$REQUIRES_AUTH" = "true" ]; then
    # Use test account credentials from secrets
    if [ -z "$TEST_ACCOUNT_EMAIL" ] || [ -z "$TEST_ACCOUNT_PASSWORD" ]; then
      echo "::error::TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD are required for authenticated paths"
      FAILED=$((FAILED + 1))
      FAILED_PATHS="${FAILED_PATHS}\n  - $PATH_ENTRY (missing credentials)"
      continue
    fi

    if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
      echo "::error::SUPABASE_URL and SUPABASE_ANON_KEY are required for authenticated paths"
      FAILED=$((FAILED + 1))
      FAILED_PATHS="${FAILED_PATHS}\n  - $PATH_ENTRY (missing Supabase config)"
      continue
    fi

    # Authenticate via Supabase to get session cookies
    echo "  Authenticating via Supabase..."
    AUTH_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$TEST_ACCOUNT_EMAIL\",\"password\":\"$TEST_ACCOUNT_PASSWORD\"}" \
      --cookie-jar /tmp/health-check-cookies.txt 2>&1 || echo "AUTH_FAILED")

    if [ "$AUTH_RESPONSE" = "AUTH_FAILED" ]; then
      echo "::error::Authentication request failed for test account"
      FAILED=$((FAILED + 1))
      FAILED_PATHS="${FAILED_PATHS}\n  - $PATH_ENTRY (authentication failed)"
      continue
    fi

    # Check if authentication was successful by looking for access_token
    if ! echo "$AUTH_RESPONSE" | jq -e '.access_token' > /dev/null 2>&1; then
      echo "::error::Authentication failed - no access token returned"
      echo "Auth response: $AUTH_RESPONSE"
      FAILED=$((FAILED + 1))
      FAILED_PATHS="${FAILED_PATHS}\n  - $PATH_ENTRY (invalid credentials)"
      continue
    fi

    echo "  ✓ Authenticated successfully"

    # Use the session cookies for authenticated requests
    CURL_ARGS+=(--cookie /tmp/health-check-cookies.txt)
  fi

  # Make the request
  RESPONSE=$(curl "${CURL_ARGS[@]}" "$FULL_URL" 2>&1 || echo "CURL_FAILED")

  if [ "$RESPONSE" = "CURL_FAILED" ]; then
    echo "::error::Request failed for $PATH_ENTRY"
    FAILED=$((FAILED + 1))
    FAILED_PATHS="${FAILED_PATHS}\n  - $PATH_ENTRY (request failed)"
    continue
  fi

  # Extract status code (last line of response)
  HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

  # Check if status code is in the accepted list
  if echo ",$ACCEPTED_CODES," | grep -q ",$HTTP_CODE,"; then
    echo "  ✓ Success (HTTP $HTTP_CODE)"
  else
    echo "::error::Health check failed for $PATH_ENTRY - HTTP $HTTP_CODE (expected one of: $ACCEPTED_CODES)"
    FAILED=$((FAILED + 1))
    FAILED_PATHS="${FAILED_PATHS}\n  - $PATH_ENTRY (HTTP $HTTP_CODE, expected: $ACCEPTED_CODES)"
  fi
done

echo ""
echo "=== Health check summary ==="
echo "Total paths checked: $TOTAL"
echo "Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "::error::Health check failed for $FAILED path(s):"
  echo -e "$FAILED_PATHS"
  exit 1
fi

echo ""
echo "✓ All health checks passed"
exit 0
