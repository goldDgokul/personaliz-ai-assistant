# 🛠️ Full Setup Guide – Personaliz AI Desktop Assistant

This guide walks you through everything needed to run **Personaliz AI Desktop Assistant** from scratch on **Windows**, **macOS**, or **Linux** — no prior experience with Tauri or Rust required.

---

## Table of Contents

1. [Prerequisites overview](#1-prerequisites-overview)
2. [Install system dependencies](#2-install-system-dependencies)
   - [Windows](#windows)
   - [macOS](#macos)
   - [Linux (Ubuntu / Debian)](#linux-ubuntu--debian)
3. [Install Rust](#3-install-rust)
4. [Install Node.js 18+](#4-install-nodejs-18)
5. [Install Python 3.9+](#5-install-python-39)
6. [Set up a local LLM (choose one)](#6-set-up-a-local-llm-choose-one)
   - [Option A – Ollama (recommended)](#option-a--ollama-recommended)
   - [Option B – llama.cpp (no installer)](#option-b--llamacpp-no-installer)
   - [Option C – Cloud API key (OpenAI / Anthropic)](#option-c--cloud-api-key-openai--anthropic)
7. [Install OpenClaw](#7-install-openclaw)
8. [Clone the repository & install JS dependencies](#8-clone-the-repository--install-js-dependencies)
9. [Install Python automation dependencies](#9-install-python-automation-dependencies)
10. [Run the app](#10-run-the-app)
    - [Development mode (recommended for first run)](#development-mode-recommended-for-first-run)
    - [Frontend-only Vite dev server](#frontend-only-vite-dev-server)
    - [Production build](#production-build)
11. [First launch: onboarding wizard](#11-first-launch-onboarding-wizard)
12. [Configure the app](#12-configure-the-app)
13. [Try the demo agents](#13-try-the-demo-agents)
14. [Verification checklist](#14-verification-checklist)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Prerequisites overview

| Tool | Minimum version | Required for |
|------|----------------|-------------|
| **Rust + Cargo** | stable (1.77+) | Tauri backend |
| **Node.js** | 18 LTS | Frontend build & npm |
| **npm** | 9+ (bundled with Node) | JS dependency management |
| **Python** | 3.9+ | LinkedIn automation |
| **pip** | latest | Python packages |
| **Playwright + Chromium** | latest | Browser automation |
| **Ollama** _or_ **llama.cpp** | latest | Local LLM |
| **OpenClaw CLI** | latest | Agent execution |
| WebKit / GTK / system libs | see below | Tauri window rendering |

---

## 2. Install system dependencies

### Windows

> **Tested on Windows 10 and Windows 11.**

1. Install [**Microsoft C++ Build Tools**](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — choose *Desktop development with C++* workload. This is required by Rust.
2. Install [**WebView2 Runtime**](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) — usually already present on Windows 11; download *Evergreen Standalone Installer* if missing.
3. Open **PowerShell (as Administrator)** for the steps below.

```powershell
# (Optional) Use winget to install Node.js and Python instead of the installers
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
```

Skip to [§3 Install Rust](#3-install-rust) — no additional system libs needed on Windows.

---

### macOS

> **Tested on macOS 13 (Ventura) and 14 (Sonoma), Apple Silicon and Intel.**

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Xcode Command Line Tools (required by Rust/Cargo)
xcode-select --install

# Install Node.js and Python via Homebrew
brew install node python@3.12
```

No additional GTK/WebKit libs are needed — macOS uses WKWebView natively.

---

### Linux (Ubuntu / Debian)

> **Tested on Ubuntu 22.04 LTS and 24.04 LTS. Adapt package names for Fedora/Arch.**

```bash
sudo apt update

# Tauri system dependencies (GTK3 + WebKit2)
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev

# Node.js 18 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Python 3
sudo apt install -y python3 python3-pip python3-venv
```

**Fedora / RHEL:**

```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  nodejs python3 python3-pip
```

**Arch Linux:**

```bash
sudo pacman -Syu webkit2gtk-4.1 base-devel curl wget openssl nodejs npm python python-pip
```

---

## 3. Install Rust

Rust is required to compile the Tauri backend. The official installer works on all platforms:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Windows (PowerShell):**

```powershell
# Download and run rustup-init.exe
Invoke-WebRequest -Uri https://win.rustup.rs -OutFile rustup-init.exe
.\rustup-init.exe
```

During installation choose **"1) Proceed with standard installation"** (default).

After installation, restart your terminal (or run `source "$HOME/.cargo/env"` on macOS/Linux) and verify:

```bash
rustc --version   # should print: rustc 1.77.x (or newer)
cargo --version   # should print: cargo 1.77.x (or newer)
```

---

## 4. Install Node.js 18+

### macOS / Linux

If you haven't installed via Homebrew/apt above, use **nvm** (Node Version Manager):

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Restart terminal, then:
nvm install 18
nvm use 18
```

### Windows

Download the **Node.js 18 LTS** installer from [nodejs.org](https://nodejs.org/) and run it, or use `winget`:

```powershell
winget install OpenJS.NodeJS.LTS
```

Verify:

```bash
node --version   # should print: v18.x.x or newer
npm --version    # should print: 9.x.x or newer
```

---

## 5. Install Python 3.9+

Python is required for the LinkedIn automation engine (`public/agent_engine.py`). If you installed it in §2, verify:

```bash
# macOS / Linux
python3 --version   # should print: Python 3.9.x or newer
pip3 --version

# Windows
python --version    # should print: Python 3.9.x or newer
pip --version
```

If Python is missing, download from [python.org](https://python.org) or use your system package manager (see §2). **On Windows, check "Add Python to PATH"** during installation.

---

## 6. Set up a local LLM (choose one)

The app works in three modes. Choose **one**:

---

### Option A – Ollama (recommended)

Ollama is the simplest option — it manages models and exposes a local API automatically.

**macOS:**

```bash
brew install ollama
```

**Linux:**

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

**Windows:** Download the installer from [ollama.ai](https://ollama.ai) and run it.

After installation, **start Ollama** (it may start automatically on macOS/Windows):

```bash
ollama serve   # starts the API on http://localhost:11434
```

Then **download a model** (open a new terminal tab):

```bash
# Recommended: Phi-3 Mini (fast, ~3 GB)
ollama pull phi3

# Alternative: Llama 3 8B (higher quality, ~4.7 GB)
ollama pull llama3
```

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
# Should return JSON listing available models
```

> 💡 The app detects Ollama automatically on port 11434. No further configuration needed.

---

### Option B – llama.cpp (no installer)

Use this if you prefer a standalone binary without a background service.

**Step 1: Download the pre-built `llama-server` binary**

Go to [github.com/ggerganov/llama.cpp/releases](https://github.com/ggerganov/llama.cpp/releases) and download the latest release for your platform:

| Platform | File to download |
|----------|-----------------|
| Windows (AVX2) | `llama-*-bin-win-avx2-x64.zip` |
| macOS (Apple Silicon) | `llama-*-bin-macos-arm64.zip` |
| macOS (Intel) | `llama-*-bin-macos-x64.zip` |
| Linux (x86_64) | `llama-*-bin-ubuntu-x64.zip` |

Extract the archive and note the path to the `llama-server` (or `llama-server.exe`) binary.

**Step 2: Download a GGUF model**

Recommended: [Phi-3-mini-4k-instruct GGUF](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/tree/main)

```bash
# Using wget (Linux/macOS):
wget https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf
```

Or download directly from the HuggingFace page. Place the `.gguf` file in a convenient folder (e.g. `~/models/`).

**Step 3: Start the llama-server**

```bash
# macOS / Linux
./llama-server -m ~/models/Phi-3-mini-4k-instruct-q4.gguf --port 8080

# Windows (PowerShell, from the extracted folder)
.\llama-server.exe -m C:\Users\YourName\models\Phi-3-mini-4k-instruct-q4.gguf --port 8080
```

The server exposes an OpenAI-compatible endpoint at **`http://localhost:8080/v1/chat/completions`**.

Verify it's running:

```bash
curl http://localhost:8080/v1/models
# Should return JSON with model info
```

> 💡 Keep this terminal open while running the app. The app will detect llama.cpp on port 8080 automatically when Ollama is not present.

---

### Option C – Cloud API key (OpenAI / Anthropic)

No local model needed. You'll enter your API key in the app's Settings tab after launch. The app will use it automatically.

- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Anthropic: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)

---

## 7. Install OpenClaw

OpenClaw is the CLI that executes agent automation scripts. It is installed as a global npm package:

```bash
npm install -g openclaw
```

Verify:

```bash
openclaw --version
```

> 💡 The onboarding wizard inside the app can also install OpenClaw for you automatically — click **Install OpenClaw** in Step 3 of the wizard.

---

## 8. Clone the repository & install JS dependencies

```bash
# Clone the repository
git clone https://github.com/goldDgokul/personaliz-ai-assistant
cd personaliz-ai-assistant

# Install JavaScript dependencies (React, Vite, Tauri API, etc.)
npm install
```

This will download all frontend packages into `node_modules/`. The Tauri CLI (`@tauri-apps/cli`) is included as a dev dependency — no global install needed.

---

## 9. Install Python automation dependencies

The LinkedIn automation engine uses **Playwright** for browser control:

```bash
# macOS / Linux
pip3 install playwright
playwright install chromium

# Windows
pip install playwright
playwright install chromium
```

> ⚠️ The `playwright install chromium` step downloads a bundled Chromium browser (~150 MB). This only needs to be done once.

Verify:

```bash
python3 -c "from playwright.sync_api import sync_playwright; print('Playwright OK')"
```

---

## 10. Run the app

### Development mode (recommended for first run)

This starts both the Vite dev server (frontend) and the Tauri native window in one command:

```bash
npm run tauri dev
```

**What happens:**
1. Vite compiles the React frontend and starts a dev server on `http://localhost:1420`
2. Cargo compiles the Rust backend (first run takes 2–5 minutes — subsequent runs are much faster)
3. A native desktop window titled **"Personaliz Assistant"** opens

> ⚠️ The **first Rust compilation** downloads and compiles all Cargo dependencies. Expect 3–10 minutes depending on your machine. Subsequent runs reuse the compiled cache and start in ~10 seconds.

---

### Frontend-only Vite dev server

If you only want to work on the React UI without the native window (e.g. on a headless server or CI):

```bash
npm run dev
```

Open [http://localhost:1420](http://localhost:1420) in your browser. Note: Tauri commands (SQLite, agent execution, etc.) will not be available in this mode.

---

### Production build

Creates an installable native package (`.dmg`, `.msi`, `.AppImage`, etc.) in `src-tauri/target/release/bundle/`:

```bash
npm run tauri build
```

> ⚠️ This requires all system libraries from §2 to be installed. The resulting installer is in `src-tauri/target/release/bundle/`.

---

## 11. First launch: onboarding wizard

When the desktop window opens for the first time, you will see a **5-step onboarding wizard**:

| Step | What it does |
|------|-------------|
| **Step 1 – Welcome** | Intro and overview |
| **Step 2 – Local AI** | Detects Ollama (port 11434) or llama.cpp (port 8080); lets you pick the LLM type and test the connection |
| **Step 3 – OpenClaw** | Checks if `openclaw` is in PATH; offers to install it automatically (`npm install -g openclaw`) |
| **Step 4 – API Keys** | Optional: enter OpenAI or Anthropic key for cloud model routing |
| **Step 5 – Ready** | Confirms all dependencies are green; takes you to the main app |

Click **Next** on each step. The wizard saves your choices to `localStorage`.

> 💡 You can re-run onboarding at any time by typing `setup` in the chat.

---

## 12. Configure the app

Open the **⚙️ Settings** tab (top navigation):

| Setting | What to set |
|---------|------------|
| **Local AI Model** | `phi3`, `llama3`, or any model name returned by `ollama list` |
| **LLM API Key** | OpenAI or Anthropic key (leave blank to use local model) |
| **LLM Provider** | `openai` or `anthropic` (only used when API key is set) |
| **Sandbox Mode** | **On** (default) – simulates actions without posting; turn off for real LinkedIn posting |

All settings are stored in browser `localStorage` — they persist between app restarts.

---

## 13. Try the demo agents

The fastest way to see the app in action:

1. Go to the **Chat** tab
2. Type: `add demo agents`
3. The app creates two ready-to-run agents:
   - **LinkedIn Trending Poster** – daily at 9 AM, posts about trending OpenClaw topics
   - **#openclaw Hashtag Commenter** – hourly, comments on LinkedIn `#openclaw` posts
4. Switch to the **Agents** tab to see both agents
5. Click **▶ Run** on either agent to execute it immediately (safe in sandbox mode)
6. Switch to the **Logs** tab to see execution output and LLM usage

Both agents run in **sandbox mode by default** — they log what they _would_ do, but make no real posts. Perfect for demos.

---

## 14. Verification checklist

Run through these checks to confirm everything is working:

```
✅ rustc --version          → rustc 1.77+ (or newer)
✅ cargo --version          → cargo 1.77+ (or newer)
✅ node --version           → v18.x.x (or newer)
✅ npm --version            → 9.x.x (or newer)
✅ python3 --version        → Python 3.9+ (or newer)
✅ openclaw --version       → prints version string
✅ ollama list              → lists downloaded models  (if using Ollama)
✅ curl localhost:11434/api/tags → returns JSON        (if using Ollama)
✅ curl localhost:8080/v1/models → returns JSON        (if using llama.cpp)
✅ npm run tauri dev        → native window opens
✅ Onboarding Step 2 shows green checkmark for LLM
✅ Onboarding Step 3 shows green checkmark for OpenClaw
✅ Chat tab → type "add demo agents" → two agents appear
✅ Agents tab → click ▶ Run → Logs tab shows output
```

---

## 15. Troubleshooting

### `npm run tauri dev` fails with Rust/linker errors

**Linux:** Make sure all GTK/WebKit packages from §2 are installed:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libayatana-appindicator3-dev
```

**Windows:** Ensure **Microsoft C++ Build Tools** are installed (see §2).

---

### `error: linker 'cc' not found` (Linux)

```bash
sudo apt install -y build-essential
```

---

### Ollama not detected (Step 2 shows red)

Make sure Ollama is running:

```bash
ollama serve
```

Check it is reachable:

```bash
curl -s http://localhost:11434/api/tags
```

If you're using llama.cpp, ensure it's started on port 8080 (see §6 Option B).

---

### `playwright install chromium` hangs or fails

Try with verbose output:

```bash
playwright install --with-deps chromium
```

On Ubuntu, you may need additional system libraries:

```bash
sudo apt install -y libgbm-dev libnss3 libasound2
```

---

### Port 1420 already in use

Stop whatever is using that port, or change the Vite port in `vite.config.ts`:

```ts
server: {
  port: 1421,   // change to any free port
  strictPort: true,
```

---

### OpenClaw not found after `npm install -g openclaw`

Ensure your global npm bin is on PATH:

```bash
# macOS / Linux
export PATH="$(npm root -g)/../bin:$PATH"

# Or find the path with:
npm config get prefix
# then add <prefix>/bin to your PATH
```

---

### App window doesn't open (Linux / headless)

Tauri requires a display. If you're on a headless server, use `Xvfb`:

```bash
sudo apt install -y xvfb
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99
npm run tauri dev
```

---

### SQLite / data location

| Platform | Database path |
|----------|--------------|
| Linux / macOS | `~/.local/share/personaliz-assistant/data.db` |
| Windows | `%APPDATA%\personaliz-assistant\data.db` |

Delete this file to reset all agents, logs, and settings.

---

### Reset onboarding

Clear the app's localStorage by opening DevTools in the Tauri window:
- **macOS / Linux:** right-click anywhere → **Inspect** → **Application → Local Storage** → clear all
- Or type `setup` in chat to re-run the onboarding wizard

---

## Multiple run/build paths — summary

| Command | What it does | When to use |
|---------|-------------|-------------|
| `npm run tauri dev` | Full app (Vite + Tauri native window) | Daily development & first run |
| `npm run dev` | Frontend only (browser, no native APIs) | UI-only development |
| `npm run tauri build` | Production installer | Shipping / distributing |
| `cd src-tauri && cargo check` | Rust type check (no GTK required) | CI / headless Rust check |
| `cd src-tauri && cargo test` | Rust unit tests (cron parser, etc.) | Testing scheduler logic |
| `npx tsc --noEmit` | TypeScript type check | Frontend type safety |

---

> 💬 **Still stuck?** Type `setup` in the app's chat at any time for guided dependency help, or open an issue at [github.com/goldDgokul/personaliz-ai-assistant/issues](https://github.com/goldDgokul/personaliz-ai-assistant/issues).
