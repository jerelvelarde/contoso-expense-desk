#!/usr/bin/env bash
# Upload one service's build context to Railway and deploy it.
#
#   deploy/railway-up.sh web   [extra `railway up` flags, e.g. --ci or --detach]
#   deploy/railway-up.sh agent [extra `railway up` flags]
#
# `railway up` would otherwise upload the whole folder (design/ and film/ are
# ~100 MB, and local .env files would go too). This stages only what that
# service's Dockerfile needs, then runs `railway up` from the repo root so the
# project linked with `railway link` is used.
#
#   RAILWAY_SERVICE=name  deploy to a differently named service (e.g. web-live)
#   DRY_RUN=1             stage and list the files, don't deploy
#   STAGE_DIR=d           stage into d (must not exist) and keep it
set -euo pipefail

svc="${1:?usage: deploy/railway-up.sh <web|agent> [railway up flags]}"
shift
root="$(cd "$(dirname "$0")/.." && pwd)"

case "$svc" in
  web) paths=(web seed deploy/web deploy/web.Dockerfile .dockerignore) ;;
  agent) paths=(agent seed cards deploy/agent.Dockerfile .dockerignore) ;;
  *) echo "unknown service '$svc': use web or agent" >&2; exit 2 ;;
esac
for p in "${paths[@]}"; do
  [[ -e "$root/$p" ]] || { echo "missing $p (needed to build $svc)" >&2; exit 1; }
done

if [[ -n "${STAGE_DIR:-}" ]]; then
  [[ ! -e "$STAGE_DIR" ]] || { echo "STAGE_DIR $STAGE_DIR already exists" >&2; exit 1; }
  stage="$STAGE_DIR"
  mkdir -p "$stage"
else
  stage="$(mktemp -d "${TMPDIR:-/tmp}/expense-desk-$svc.XXXXXX")"
  trap 'rm -rf "$stage"' EXIT
fi

# Same exclusions as .dockerignore: build output, dependencies, local secrets.
tar -C "$root" -cf - \
  --exclude node_modules --exclude dist --exclude bin --exclude obj --exclude .vs \
  --exclude .DS_Store --exclude '*.log' --exclude .env --exclude '.env.*' --exclude '*.local' \
  "${paths[@]}" | tar -C "$stage" -xf -

echo "staged $svc: $(find "$stage" -type f | wc -l | tr -d ' ') files, $(du -sh "$stage" | cut -f1) in $stage"
if [[ -n "${DRY_RUN:-}" ]]; then
  (cd "$stage" && find . -type f | sed 's|^\./||' | sort)
  exit 0
fi

cd "$root"
railway up "$stage" --path-as-root --service "${RAILWAY_SERVICE:-$svc}" "$@"
