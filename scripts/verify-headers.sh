#!/usr/bin/env bash
# Curl-based assertion of the header set scripts/gen-headers.ts writes into
# dist/_headers, run against a real running deployment (a wrangler pages dev
# instance in CI/local, a Cloudflare Pages preview/production URL in E7).
# Exits non-zero with a specific message on the first mismatch.
set -euo pipefail

BASE_URL="${1:?usage: verify-headers.sh <base-url>}"
BASE_URL="${BASE_URL%/}"

fail() {
  echo "verify-headers: FAIL -- $1" >&2
  exit 1
}

response_headers="$(curl -sS -D - -o /dev/null "$BASE_URL/")" || fail "curl request to $BASE_URL/ failed"

get_header() {
  local name="$1"
  printf '%s\n' "$response_headers" | grep -i "^${name}:" | head -1 | cut -d':' -f2- | tr -d '\r' | sed 's/^ //'
}

assert_contains() {
  local name="$1"
  local needle="$2"
  local value
  value="$(get_header "$name")"
  if [ -z "$value" ]; then
    fail "missing header: $name"
  fi
  if ! printf '%s' "$value" | grep -qF -- "$needle"; then
    fail "header '$name' did not contain expected value '$needle'. got: $value"
  fi
}

assert_contains "content-security-policy" "default-src 'self'"
assert_contains "content-security-policy" "'wasm-unsafe-eval'"
assert_contains "x-content-type-options" "nosniff"
assert_contains "referrer-policy" "strict-origin-when-cross-origin"
assert_contains "permissions-policy" "camera=()"
assert_contains "x-llms-txt" "llms.txt"
assert_contains "link" "rel=\"llms-txt\""

echo "verify-headers: OK -- $BASE_URL/"
