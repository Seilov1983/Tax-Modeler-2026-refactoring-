#!/usr/bin/env bash
# ─── TSM26 Strategy Copilot — Ollama Setup Script ────────────────────────────
# Creates the custom model "tsm26-strategy-copilot" from scripts/ai/Modelfile.
# Run via: npm run ai:setup
set -euo pipefail

# Bind Ollama to all interfaces so it's reachable from Docker/remote if needed
export OLLAMA_HOST=0.0.0.0:11434

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELFILE="$SCRIPT_DIR/Modelfile"

echo "──────────────────────────────────────────────"
echo "  TSM26 Strategy Copilot — Ollama Setup"
echo "──────────────────────────────────────────────"

# 1. Check Ollama is installed
if ! command -v ollama &>/dev/null; then
  echo "ERROR: ollama CLI not found. Install from https://ollama.com"
  exit 1
fi

# 2. Check Ollama server is running
if ! ollama list &>/dev/null; then
  echo "ERROR: Ollama server is not running. Start it with: ollama serve"
  exit 1
fi

# 3. Pull base model if not present
echo "[1/3] Ensuring base model qwen2.5:14b is available..."
ollama pull qwen2.5:14b

# 4. Create custom model from Modelfile
echo "[2/3] Creating tsm26-strategy-copilot from Modelfile..."
ollama create tsm26-strategy-copilot -f "$MODELFILE"

# 5. Verify
echo "[3/3] Verifying model..."
ollama show tsm26-strategy-copilot --modelfile | head -5

echo ""
echo "✓ tsm26-strategy-copilot is ready."
echo "  API endpoint: http://127.0.0.1:11434/v1"
echo "  Model ID:     tsm26-strategy-copilot"
echo "──────────────────────────────────────────────"
