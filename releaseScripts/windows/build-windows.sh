#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOST_LABEL="${1:-Windows 10 or 11}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "Run the $HOST_LABEL release script in Git Bash on a native 64-bit Windows host." >&2
    exit 1
    ;;
esac

# Git Bash does not always inherit Node and pnpm from Windows. Prefer the
# developer's normal tools, then try the standard Windows locations and the
# bundled Codex development runtime used by this workspace. Keep these as
# functions so child Bash scripts inherit the exact resolved executables.
resolve_node() {
  local candidate=""
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in \
    "/c/Program Files/nodejs/node.exe" \
    "$HOME/AppData/Local/Programs/nodejs/node.exe" \
    "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node.exe \
    "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_pnpm() {
  local candidate=""
  if command -v pnpm >/dev/null 2>&1; then
    command -v pnpm
    return 0
  fi
  if command -v pnpm.cmd >/dev/null 2>&1; then
    command -v pnpm.cmd
    return 0
  fi
  for candidate in \
    "$HOME/AppData/Local/pnpm/pnpm.cmd" \
    "/c/Program Files/nodejs/pnpm.cmd" \
    "$HOME"/.cache/codex-runtimes/*/dependencies/bin/fallback/pnpm.cmd; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! OSCODE_NODE_BIN="$(resolve_node)"; then
  echo "Node.js 22 or newer was not found. Install Node.js, then reopen Git Bash." >&2
  exit 1
fi
if ! OSCODE_PNPM_BIN="$(resolve_pnpm)"; then
  echo "pnpm was not found. Install pnpm 11, then reopen Git Bash." >&2
  exit 1
fi
export OSCODE_NODE_BIN OSCODE_PNPM_BIN
node() { "$OSCODE_NODE_BIN" "$@"; }
pnpm() { "$OSCODE_PNPM_BIN" "$@"; }
export -f node pnpm
export PATH="$(dirname "$OSCODE_NODE_BIN"):$(dirname "$OSCODE_PNPM_BIN"):$PATH"
# Node's Windows environment can preserve the inherited mixed-case key. Keep
# both spellings synchronized so application-level command discovery sees the
# same build tool path as Git Bash.
export Path="$PATH"
export CI=true
export PNPM_DISABLE_SELF_UPDATE_CHECK=true
export NO_UPDATE_NOTIFIER=true
export npm_config_user_agent="pnpm/$(pnpm --version) node/$(node --version)"
export npm_execpath="$OSCODE_PNPM_BIN"

NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 22 )); then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi
echo "Using $(node --version) and pnpm $(pnpm --version)"

echo "Building osChat for $HOST_LABEL"
node "$ROOT/releaseScripts/common/cleanup-release.mjs"
bash "$ROOT/releaseScripts/common/prepare-source.sh"
cd "$ROOT"
export CSC_IDENTITY_AUTO_DISCOVERY=false
node "$ROOT/node_modules/electron-builder/cli.js" --win nsis --x64 --publish never
node scripts/verify-package.mjs windows --run-smoke
pnpm run release:stage:windows
node releaseScripts/common/cleanup-release.mjs
