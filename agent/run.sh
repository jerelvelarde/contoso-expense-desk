#!/usr/bin/env bash
# Starts the expense agent and the CopilotKit runtime on http://localhost:5000.
# Reads agent/.env if present; 1Password references (op://...) in it are
# resolved by `op run`, so the secrets only ever live in the process.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.dotnet:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
cmd=(dotnet run --project "$here/ExpenseDesk" --launch-profile http)

if [[ ! -f "$here/.env" ]]; then
  exec "${cmd[@]}"
elif grep -q 'op://' "$here/.env"; then
  exec op run --env-file="$here/.env" -- "${cmd[@]}"
else
  set -a
  # shellcheck disable=SC1091
  source "$here/.env"
  set +a
  exec "${cmd[@]}"
fi
