#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${HOME:-~}/.config/opencode"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Cortex Setup ==="
echo ""

# 1. Copy opencode config
SRC="$SCRIPT_DIR/config"
if [ ! -d "$SRC" ]; then
  echo "ERROR: config directory not found at $SRC" >&2
  echo "Run this script from the cortex/ folder on the USB drive." >&2
  exit 1
fi

echo "Step 1: Installing OpenCode config..."
mkdir -p "$CONFIG_DIR"
cp -r "$SRC/"* "$CONFIG_DIR/"
echo "  Copied AGENTS.md, opencode.jsonc to $CONFIG_DIR"
echo ""

# 2. Summary
echo "Step 2: Project location"
PROJ="$SCRIPT_DIR/project"
echo "  Project files are at: $PROJ"
echo "  Deploy the Hub from: $PROJ/hub/mcp-server"
echo "  Agent AGENTS.md at:  $PROJ/agents/<role>/AGENTS.md"
echo ""

echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy project to target machine or work from USB"
echo "  2. Deploy Hub: cd hub/mcp-server && npm install && npm run build"
echo "  3. Start opencode"
