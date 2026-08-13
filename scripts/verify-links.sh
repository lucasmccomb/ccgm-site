#!/usr/bin/env bash
# Resolves every absolute link /llms.txt emits against the deployment under
# test, plus the X-Llms-Txt/Link discovery header URLs -- catches the
# "baked-in host that doesn't serve this content yet" class (§3.4:
# absolute URLs are baked from SITE_URL at BUILD time, so a link can point
# at a host that isn't the deployment currently being checked).
#
# Each URL's PATH is resolved against the base-url argument (the origin is
# swapped, never trusted) -- so this script is meaningful against any
# deployment (a local wrangler/preview server, a Cloudflare preview URL, or
# production) regardless of what SITE_URL that deployment was built with.
set -uo pipefail

BASE_URL="${1:?usage: verify-links.sh <base-url>}"
BASE_URL="${BASE_URL%/}"

FAILURES=0

fail() {
  echo "verify-links: FAIL -- $1" >&2
  FAILURES=$((FAILURES + 1))
}

# Resolves a possibly-absolute URL's PATH against $BASE_URL and returns the
# HTTP status code.
resolve_status() {
  local url="$1"
  local path
  path="$(printf '%s' "$url" | sed -E 's#^https?://[^/]+##')"
  curl -o /dev/null -s -w '%{http_code}' --connect-timeout 5 --max-time 15 "$BASE_URL$path"
}

LLMS_TXT="$(curl -fsS --connect-timeout 5 --max-time 15 "$BASE_URL/llms.txt")" || {
  echo "verify-links: FAIL -- could not fetch $BASE_URL/llms.txt" >&2
  exit 1
}

# Every absolute URL /llms.txt emits: markdown links "](url)" (the format
# every entry uses today) plus any bare absolute URL, for robustness against
# a future format change. Non-overlapping left-to-right scan means a
# markdown-link match already consumes its inner URL, so there is no
# double-count.
URLS="$(printf '%s' "$LLMS_TXT" | grep -oE '\]\([^)]+\)|https?://[^][:space:]")>]+' | sed -E 's/^\]\(//; s/\)$//' | sort -u)"

if [ -z "$URLS" ]; then
  fail "no absolute URLs found in $BASE_URL/llms.txt"
fi

CHECKED=0
while IFS= read -r url; do
  [ -z "$url" ] && continue
  CHECKED=$((CHECKED + 1))
  status="$(resolve_status "$url")"
  if [ "$status" != "200" ]; then
    fail "$url -> $(printf '%s' "$url" | sed -E 's#^https?://[^/]+##') on $BASE_URL returned $status (expected 200)"
  fi
done <<< "$URLS"

echo "verify-links: checked $CHECKED URL(s) referenced from $BASE_URL/llms.txt"

# Discovery headers on / also carry absolute URLs (X-Llms-Txt, and the
# Link: <...>; rel="llms-txt" header) -- their paths must resolve too.
RESPONSE_HEADERS="$(curl -sS --connect-timeout 5 --max-time 15 -D - -o /dev/null "$BASE_URL/")"

get_header() {
  printf '%s\n' "$RESPONSE_HEADERS" | grep -i "^${1}:" | head -1 | cut -d':' -f2- | tr -d '\r' | sed 's/^ //'
}

XLLMS_URL="$(get_header 'x-llms-txt')"
if [ -n "$XLLMS_URL" ]; then
  status="$(resolve_status "$XLLMS_URL")"
  [ "$status" = "200" ] || fail "X-Llms-Txt header URL '$XLLMS_URL' returned $status (expected 200)"
else
  fail "missing X-Llms-Txt header on $BASE_URL/"
fi

LINK_HEADER="$(get_header 'link')"
if [ -n "$LINK_HEADER" ]; then
  LINK_URL="$(printf '%s' "$LINK_HEADER" | grep -oE '<[^>]+>' | head -1 | tr -d '<>')"
  if [ -n "$LINK_URL" ]; then
    status="$(resolve_status "$LINK_URL")"
    [ "$status" = "200" ] || fail "Link header URL '$LINK_URL' returned $status (expected 200)"
  else
    fail "could not parse a URL out of the Link header: $LINK_HEADER"
  fi
else
  fail "missing Link header on $BASE_URL/"
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "verify-links: FAIL -- $FAILURES failure(s)" >&2
  exit 1
fi

echo "verify-links: OK -- $BASE_URL"
