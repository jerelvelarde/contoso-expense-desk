#!/usr/bin/env bash
# Smoke test a deployed (or locally served) Expense Desk dashboard.
#
#   deploy/smoke.sh <base_url> [out_dir]
#
# Demo mode (default): health check, server behaviour (SPA fallback, cache
# headers, 404s, basic auth), then walks every demo state with
# design/capture_states.py and fails on any console error, then checks the
# presenter controls are open on load and clickable.
#
# Env:
#   BASIC_AUTH_USER / BASIC_AUTH_PASSWORD  the site's basic-auth credentials, if it has them
#   EXPECT_DEMO_CONTROLS=0                 skip the controls check (build made without VITE_SHOW_DEMO_CONTROLS)
#   SMOKE_MODE=live                        live mode: skip the scripted walk-through and check
#                                          the agent runtime answers through the web host instead
#   RUNTIME_PATH=/copilotkit               where the runtime is mounted on the web host (live mode)
#   HEALTH_PATH=/healthz                   health endpoint (use / for hosts without one, e.g. Vercel)
#
# Needs: curl, python3 with Playwright (same as design/capture_states.py).
set -euo pipefail

base="${1:?usage: deploy/smoke.sh <base_url> [out_dir]}"
base="${base%/}"
root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${SMOKE_MODE:-demo}"
out="${2:-}"
if [[ -z "$out" && "$mode" != live ]]; then out="$(mktemp -d "${TMPDIR:-/tmp}/expense-desk-smoke.XXXXXX")"; fi
health="${HEALTH_PATH:-/healthz}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok:   $*"; }

curl_auth=()
page_url="$base/"
if [[ -n "${BASIC_AUTH_USER:-}" || -n "${BASIC_AUTH_PASSWORD:-}" ]]; then
  [[ -n "${BASIC_AUTH_USER:-}" && -n "${BASIC_AUTH_PASSWORD:-}" ]] || fail "set both BASIC_AUTH_USER and BASIC_AUTH_PASSWORD"
  curl_auth=(--user "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD")
  # Playwright takes the credentials from the URL.
  page_url="$(python3 -I -c '
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1])
q = lambda s: u.quote(s, safe="")
print(u.urlunsplit((p.scheme, f"{q(sys.argv[2])}:{q(sys.argv[3])}@{p.netloc}", p.path or "/", p.query, p.fragment)))
' "$base/" "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD")"
fi

# status <path> [extra curl args...] -> prints the HTTP status code
status() { local p="$1"; shift; curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" "$base$p" || true; }
header() { curl -sS -o /dev/null -D - --max-time 20 "${curl_auth[@]+"${curl_auth[@]}"}" "$base$2" | tr -d '\r' | awk -v h="$1" -F': ' 'tolower($1)==tolower(h) {print $2}' | tail -1; }

echo "smoke test: $base ($mode mode)${out:+, screenshots in $out}"

# 1. Health check: must answer without credentials.
code="$(status "$health")"
[[ "$code" == 200 ]] || fail "$health returned $code"
pass "$health 200"

# 2. Basic auth, when configured.
if [[ ${#curl_auth[@]} -gt 0 ]]; then
  code="$(status /)"
  [[ "$code" == 401 ]] || fail "/ without credentials returned $code, expected 401"
  code="$(status / --user "$BASIC_AUTH_USER:wrong-$RANDOM")"
  [[ "$code" == 401 ]] || fail "/ with a wrong password returned $code, expected 401"
  pass "basic auth rejects missing and wrong credentials"
fi

# 3. Static hosting behaviour.
code="$(status / "${curl_auth[@]+"${curl_auth[@]}"}")"
[[ "$code" == 200 ]] || fail "/ returned $code"
html="$(curl -sS --max-time 20 "${curl_auth[@]+"${curl_auth[@]}"}" "$base/")"
asset="$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' <<<"$html" | head -1 || true)"
[[ -n "$asset" ]] || fail "no /assets/index-*.js in index.html"
[[ "$(header cache-control "$asset")" == *immutable* ]] || fail "$asset is not served with an immutable Cache-Control"
pass "hashed assets are immutable ($asset)"
[[ "$(header cache-control /)" == no-cache ]] || echo "warn: index.html Cache-Control is '$(header cache-control /)', expected no-cache"
code="$(status /requests/EXP-0000 "${curl_auth[@]+"${curl_auth[@]}"}")"
[[ "$code" == 200 ]] || fail "SPA fallback: /requests/EXP-0000 returned $code"
code="$(status /assets/does-not-exist.js "${curl_auth[@]+"${curl_auth[@]}"}")"
[[ "$code" == 404 ]] || fail "a missing asset returned $code, expected 404"
pass "SPA fallback serves index.html; missing assets 404"

if [[ "$mode" == live ]]; then
  # 4L. The runtime answers through the web host. 502/503/504 means the web
  # host cannot reach the agent (AGENT_UPSTREAM_URL, private networking, agent down).
  rt="${RUNTIME_PATH:-/copilotkit}"
  code="$(status "$rt/info" "${curl_auth[@]+"${curl_auth[@]}"}")"
  [[ "$code" =~ ^(502|503|504|000)$ ]] && fail "$rt/info returned $code: the web host cannot reach the agent runtime"
  [[ "$code" == 200 ]] || echo "warn: $rt/info returned $code (reached the runtime, but not 200; check the runtime's routes)"
  pass "agent runtime reachable through $rt ($code)"
  echo "PASS"
  exit 0
fi

# 4. Walk every scripted demo state; fail on any console error.
python3 -I "$root/design/capture_states.py" "$out" "$page_url" >/dev/null
errors="$(cat "$out/errors.txt")"
[[ "$errors" == "no console errors" ]] || fail "console errors during the walk-through:"$'\n'"$errors"
pass "walked $(find "$out" -name '*.png' | wc -l | tr -d ' ') demo states with 0 console errors"

# 5. Presenter controls are open on load and drive the demo by clicking.
if [[ "${EXPECT_DEMO_CONTROLS:-1}" != 0 ]]; then
  python3 -I "$root/deploy/check_controls.py" "$page_url" || fail "demo controls check"
  pass "demo controls open on load and clickable"
fi

echo "PASS"
