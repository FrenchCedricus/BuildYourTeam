#!/usr/bin/env bash
# BuildYourTeam installer (macOS / Linux / Git Bash).
#   From a clone:   ./install.sh
#   From the web:   curl -fsSL https://raw.githubusercontent.com/FrenchCedricus/BuildYourTeam/main/install.sh | bash
set -euo pipefail

REPO="FrenchCedricus/BuildYourTeam"
BRANCH="${BYT_BRANCH:-main}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DIR="$CLAUDE_DIR/skills/byt"
BYT_HOME="${BYT_HOME:-$HOME/.byt}"

info() { printf '\033[36m›\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m✔\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✖\033[0m %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node.js 18 or later: https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js $NODE_MAJOR found: version 18 or later is required."

# Source: the local clone when run from one, otherwise the GitHub archive.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/skill/byt.mjs" ]; then
  SRC="$SCRIPT_DIR/skill"
  info "Installing from $SCRIPT_DIR"
else
  command -v curl >/dev/null 2>&1 || fail "curl is required to download BuildYourTeam."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  info "Downloading $REPO ($BRANCH)…"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP"
  SRC="$(find "$TMP" -mindepth 2 -maxdepth 2 -type d -name skill | head -n 1)"
  [ -n "$SRC" ] && [ -f "$SRC/byt.mjs" ] || fail "Unexpected archive: skill/ folder not found."
fi

# The skill folder belongs to BYT only: replace it entirely.
rm -rf "$SKILL_DIR"
mkdir -p "$SKILL_DIR"
cp -R "$SRC/." "$SKILL_DIR/"
mkdir -p "$BYT_HOME/teams"
ok "Skill installed in $SKILL_DIR"
ok "Data folder: $BYT_HOME"

VERSION="$(node "$SKILL_DIR/byt.mjs" version)"
ok "BuildYourTeam $VERSION ready."
echo
echo "  In Claude Code:"
echo "    /byt help"
echo "    /byt list --available"
echo "    /byt install software-dev"
echo
echo "  (Restart Claude Code if the /byt command does not show up.)"
