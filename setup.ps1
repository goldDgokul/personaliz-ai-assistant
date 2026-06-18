# Personaliz AI Assistant – one-shot setup for Windows (PowerShell)
# Usage (run as Administrator or allow execution first):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup.ps1

$ErrorActionPreference = "Stop"
Write-Host "=== Personaliz AI Assistant Setup ===" -ForegroundColor Cyan

# ── 1. Rust ──────────────────────────────────────────────────────────────────
if (!(Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host "[1/4] Installing Rust..." -ForegroundColor Yellow
    $rustup = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustup
    & $rustup -y
    $env:PATH += ";$env:USERPROFILE\.cargo\bin"
} else {
    Write-Host "[1/4] Rust already installed ($(rustc --version))" -ForegroundColor Green
}

# ── 2. Python + Playwright ───────────────────────────────────────────────────
Write-Host "[2/4] Installing Python dependencies..." -ForegroundColor Yellow
if (!(Get-Command pip -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: pip not found. Install Python 3.9+ from https://python.org and re-run this script." -ForegroundColor Red
    exit 1
}
pip install playwright
playwright install chromium

# ── 3. Node dependencies ─────────────────────────────────────────────────────
Write-Host "[3/4] Installing Node dependencies..." -ForegroundColor Yellow
npm install

# ── 4. OpenClaw CLI ──────────────────────────────────────────────────────────
Write-Host "[4/4] Installing OpenClaw CLI..." -ForegroundColor Yellow
npm install -g openclaw

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Development:  npm run tauri dev"
Write-Host "  Production:   npm run tauri build"
