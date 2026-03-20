#!/usr/bin/env bash
# Personaliz AI Assistant – one-shot setup for macOS and Linux
# Usage: bash setup.sh
set -e

echo "=== Personaliz AI Assistant Setup ==="

# ── 1. Rust ─────────────────────────────────────────────────────────────────
if ! command -v rustc &>/dev/null; then
  echo "[1/5] Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "[1/5] Rust already installed ($(rustc --version))"
fi

# ── 2. Tauri system libraries (Linux only) ──────────────────────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo "[2/5] Installing Tauri system dependencies (Linux)..."
  sudo apt-get update -y
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
else
  echo "[2/5] macOS detected – skipping Linux system packages"
fi

# ── 3. Python + Playwright ──────────────────────────────────────────────────
echo "[3/5] Installing Python dependencies..."
if ! command -v pip3 &>/dev/null; then
  echo "ERROR: pip3 not found. Install Python 3.9+ from https://python.org and re-run this script." >&2
  exit 1
fi
pip3 install playwright
playwright install chromium

# ── 4. Node dependencies ─────────────────────────────────────────────────────
echo "[4/5] Installing Node dependencies..."
npm install

# ── 5. OpenClaw CLI ──────────────────────────────────────────────────────────
echo "[5/5] Installing OpenClaw CLI..."
npm install -g openclaw

echo ""
echo "✅  Setup complete!"
echo ""
echo "  Development:  npm run tauri dev"
echo "  Production:   npm run tauri build"
