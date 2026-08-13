#!/usr/bin/env bash
# Verifies that ccgm-site's live deployment actually reflects new content --
# POSTing the deploy hook is not evidence a rebuild happened (a Cloudflare-
# side build failure is otherwise invisible outside the CF dashboard, §3.6
# point 4).
#
# POLL-ONLY BY DEFAULT: this script POSTs the deploy hook only when
# $CCGM_SITE_DEPLOY_HOOK_URL is present in the environment -- true inside
# nightly-rebuild.yml (which owns the secret) and false everywhere else,
# including an agent session (HE1 step 7: the hook URL must never enter a
# session). Otherwise it only polls -- useful for confirming a deploy that
# was already triggered some other way (site-deploy-hook.yml's own inline
# poll, a manual dashboard deploy, etc).
#
# Two modes:
#   verify-rebuild.sh [base-url]
#       Poll /modules.json until meta.generatedAt advances past its value
#       at the start of the poll. Reports the resulting sourceSha for the
#       caller to inspect/compare -- this script has no independent way to
#       know "ccgm main HEAD" from inside the ccgm-site repo.
#
#   verify-rebuild.sh [base-url] --expect-site-sha <sha>
#       Poll /modules.json until meta.siteSha equals <sha> exactly -- the
#       "this deployment is this ccgm-site commit" oracle (§3.3, §9.1,
#       §9.4 step 4).
#
# base-url defaults to https://ccgm-site.pages.dev. 15-minute timeout.
set -uo pipefail

BASE_URL="https://ccgm-site.pages.dev"
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  BASE_URL="$1"
  shift
fi
BASE_URL="${BASE_URL%/}"

EXPECT_SITE_SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-site-sha)
      EXPECT_SITE_SHA="${2:?--expect-site-sha requires a commit sha}"
      shift 2
      ;;
    *)
      echo "verify-rebuild: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "verify-rebuild: FAIL -- $1" >&2
  exit 1
}

# Prints three lines: generatedAt, sourceSha, siteSha (any may be empty on
# a fetch/parse failure -- callers treat empty as "not yet available").
fetch_modules_meta() {
  curl -fsS --connect-timeout 5 --max-time 15 "$BASE_URL/modules.json" 2>/dev/null | python3 -c '
import json, sys
try:
    meta = json.load(sys.stdin)["meta"]
    print(meta.get("generatedAt", ""))
    print(meta.get("sourceSha", ""))
    print(meta.get("siteSha", ""))
except Exception:
    print("")
    print("")
    print("")
'
}

TIMEOUT_SECONDS=$((15 * 60))
POLL_INTERVAL_SECONDS=20
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))

if [ -n "$EXPECT_SITE_SHA" ]; then
  echo "verify-rebuild: polling $BASE_URL/modules.json for siteSha == $EXPECT_SITE_SHA (timeout ${TIMEOUT_SECONDS}s)"
  # Tracked separately from the per-iteration fetch so a timeout message can
  # tell "the endpoint never once returned parseable JSON" apart from "JSON
  # parsed fine, the siteSha just never matched" -- the two point at very
  # different problems (site unreachable/broken vs. deploy genuinely stale).
  EVER_PARSED="false"
  LAST_PARSED_SITE_SHA=""
  while true; do
    META="$(fetch_modules_meta)"
    LIVE_SITE_SHA="$(printf '%s\n' "$META" | sed -n '3p')"
    if [ -n "$LIVE_SITE_SHA" ]; then
      EVER_PARSED="true"
      LAST_PARSED_SITE_SHA="$LIVE_SITE_SHA"
    fi
    if [ -n "$LIVE_SITE_SHA" ] && [ "$LIVE_SITE_SHA" = "$EXPECT_SITE_SHA" ]; then
      echo "verify-rebuild: OK -- live siteSha matches $EXPECT_SITE_SHA"
      exit 0
    fi
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      if [ "$EVER_PARSED" = "true" ]; then
        fail "timed out waiting for siteSha to become $EXPECT_SITE_SHA; last parsed siteSha=$LAST_PARSED_SITE_SHA"
      else
        fail "timed out waiting for siteSha to become $EXPECT_SITE_SHA; $BASE_URL/modules.json never returned parseable JSON during the poll window"
      fi
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
fi

# Poll-only mode: capture the baseline generatedAt, optionally POST the
# hook if the secret is present in the environment, then poll for advance.
BASELINE_META="$(fetch_modules_meta)"
BASELINE_GENERATED_AT="$(printf '%s\n' "$BASELINE_META" | sed -n '1p')"

if [ -n "${CCGM_SITE_DEPLOY_HOOK_URL:-}" ]; then
  echo "verify-rebuild: CCGM_SITE_DEPLOY_HOOK_URL is set -- POSTing the deploy hook"
  curl -fsS --connect-timeout 5 --max-time 15 --retry 3 --retry-all-errors --retry-delay 5 -X POST "$CCGM_SITE_DEPLOY_HOOK_URL" \
    || fail "deploy hook POST failed"
else
  echo "verify-rebuild: CCGM_SITE_DEPLOY_HOOK_URL not set -- poll-only, not triggering a new build"
fi

echo "verify-rebuild: polling $BASE_URL/modules.json for generatedAt to advance past '${BASELINE_GENERATED_AT:-<none>}' (timeout ${TIMEOUT_SECONDS}s)"
# Same "never parsed at all" vs "parsed fine, just never advanced" split as
# the --expect-site-sha branch above -- seeded from the baseline fetch so a
# baseline that itself failed to parse is reflected from the first check.
EVER_PARSED="false"
LAST_PARSED_GENERATED_AT="$BASELINE_GENERATED_AT"
if [ -n "$BASELINE_GENERATED_AT" ]; then
  EVER_PARSED="true"
fi
while true; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    if [ "$EVER_PARSED" = "true" ]; then
      fail "timed out waiting for generatedAt to advance past '${BASELINE_GENERATED_AT:-<none>}'; last parsed generatedAt=$LAST_PARSED_GENERATED_AT"
    else
      fail "timed out waiting for generatedAt to advance past '${BASELINE_GENERATED_AT:-<none>}'; $BASE_URL/modules.json never returned parseable JSON during the poll window"
    fi
  fi
  sleep "$POLL_INTERVAL_SECONDS"
  META="$(fetch_modules_meta)"
  GENERATED_AT="$(printf '%s\n' "$META" | sed -n '1p')"
  SOURCE_SHA="$(printf '%s\n' "$META" | sed -n '2p')"
  if [ -n "$GENERATED_AT" ]; then
    EVER_PARSED="true"
    LAST_PARSED_GENERATED_AT="$GENERATED_AT"
  fi
  if [ -n "$GENERATED_AT" ] && [ "$GENERATED_AT" != "$BASELINE_GENERATED_AT" ]; then
    echo "verify-rebuild: OK -- generatedAt advanced ('${BASELINE_GENERATED_AT:-<none>}' -> '$GENERATED_AT'), sourceSha=$SOURCE_SHA"
    exit 0
  fi
done
