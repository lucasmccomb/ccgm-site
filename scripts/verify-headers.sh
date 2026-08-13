#!/usr/bin/env bash
# Curl-based assertion of the header set scripts/gen-headers.ts writes into
# dist/_headers, run against a real running deployment (a wrangler pages dev
# instance in CI/local, a Cloudflare Pages preview/production URL in E7).
# Exits non-zero with a specific message on the first mismatch.
#
# E7 extends E1's original `/`-only security/discovery-header assertions
# with the machine-surface content-type contract (§3.4): /llms.txt,
# /llms-full.txt, a .md twin's Content-Type + X-Robots-Tag, /modules.json,
# /presets.json, and one raw per-file .txt endpoint (discovered via
# /modules.json, never hardcoded to a specific module name).
set -euo pipefail

BASE_URL="${1:?usage: verify-headers.sh <base-url>}"
BASE_URL="${BASE_URL%/}"

fail() {
  echo "verify-headers: FAIL -- $1" >&2
  exit 1
}

get_header_from() {
  local headers="$1"
  local name="$2"
  printf '%s\n' "$headers" | grep -i "^${name}:" | head -1 | cut -d':' -f2- | tr -d '\r' | sed 's/^ //'
}

assert_contains_in() {
  local headers="$1"
  local label="$2"
  local name="$3"
  local needle="$4"
  local value
  value="$(get_header_from "$headers" "$name")"
  if [ -z "$value" ]; then
    fail "$label: missing header: $name"
  fi
  if ! printf '%s' "$value" | grep -qF -- "$needle"; then
    fail "$label: header '$name' did not contain expected value '$needle'. got: $value"
  fi
}

response_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/")" || fail "curl request to $BASE_URL/ failed"
get_header() { get_header_from "$response_headers" "$1"; }
assert_contains() { assert_contains_in "$response_headers" "/" "$1" "$2"; }

assert_contains "content-security-policy" "default-src 'self'"
assert_contains "content-security-policy" "'wasm-unsafe-eval'"
assert_contains "x-content-type-options" "nosniff"
assert_contains "referrer-policy" "strict-origin-when-cross-origin"
assert_contains "permissions-policy" "camera=()"
assert_contains "x-llms-txt" "llms.txt"
assert_contains "link" "rel=\"llms-txt\""

# --- Machine-surface content types (§3.4) --------------------------------

llms_txt_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/llms.txt")" || fail "curl request to $BASE_URL/llms.txt failed"
assert_contains_in "$llms_txt_headers" "/llms.txt" "content-type" "text/plain"

llms_full_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/llms-full.txt")" || fail "curl request to $BASE_URL/llms-full.txt failed"
assert_contains_in "$llms_full_headers" "/llms-full.txt" "content-type" "text/plain"

md_twin_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/modules/index.md")" || fail "curl request to $BASE_URL/modules/index.md failed"
assert_contains_in "$md_twin_headers" "/modules/index.md" "content-type" "text/markdown"
assert_contains_in "$md_twin_headers" "/modules/index.md" "x-robots-tag" "noindex"

modules_json_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/modules.json")" || fail "curl request to $BASE_URL/modules.json failed"
assert_contains_in "$modules_json_headers" "/modules.json" "content-type" "application/json"

presets_json_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/presets.json")" || fail "curl request to $BASE_URL/presets.json failed"
assert_contains_in "$presets_json_headers" "/presets.json" "content-type" "application/json"

# Raw per-file endpoint: discovered from /modules.json rather than
# hardcoded, so this keeps working as the module set changes.
modules_json_body="$(curl -fsS --connect-timeout 5 --max-time 15 "$BASE_URL/modules.json")" || fail "curl request to $BASE_URL/modules.json (body) failed"
raw_url="$(printf '%s' "$modules_json_body" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for module in data.get("modules", []):
    files = module.get("files", [])
    if files:
        print(files[0]["rawUrl"])
        break
' 2>/dev/null)"
if [ -z "$raw_url" ]; then
  fail "could not find any module file rawUrl in $BASE_URL/modules.json"
fi
raw_path="$(printf '%s' "$raw_url" | sed -E 's#^https?://[^/]+##')"
raw_file_headers="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL$raw_path")" || fail "curl request to $BASE_URL$raw_path failed"
assert_contains_in "$raw_file_headers" "$raw_path" "content-type" "text/plain"

echo "verify-headers: OK -- $BASE_URL/"
