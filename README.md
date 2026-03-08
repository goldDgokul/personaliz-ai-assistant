# 🤖 Personaliz AI Desktop Assistant

A UI-first desktop automation assistant powered by **local AI (Phi-3 Mini / Llama3)** + **Tauri** that makes **OpenClaw** automation accessible to non-technical users.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri)](https://tauri.app/)
[![Powered by Ollama](https://img.shields.io/badge/Powered%20by-Ollama-FF6B6B)](https://ollama.ai/)

---

## ✨ Features

- **Chat-First Interface** – create automation agents by chatting
- **Local AI, offline-first** – runs with Phi-3 Mini (or Llama3) via Ollama; no API key needed
- **External AI support** – set an OpenAI or Anthropic key in Settings to switch automatically
- **Browser automation** – post to LinkedIn and comment on hashtag threads via Playwright
- **Approval flow** – review and edit content before any production post
- **Sandbox mode** – simulate every action safely before going live
- **SQLite persistence** – agents, schedules, logs, and run history stored locally
- **Background scheduler** – hourly / daily schedule execution inside the Tauri runtime
- **Two demo agents** – LinkedIn Trending Poster (daily) + #openclaw Hashtag Commenter (hourly)

---

## 🚀 Quick Start

### Prerequisites

| Tool | Install |
|------|---------|
| Rust + Cargo | https://rustup.rs |
| Node.js 18+ | https://nodejs.org |
| Ollama | https://ollama.ai |
| Python 3.9+ | https://python.org |
| Playwright | `pip install playwright && playwright install chromium` |

### 1. Clone & install

```bash
git clone https://github.com/goldDgokul/personaliz-ai-assistant
cd personaliz-ai-assistant
npm install
```

### 2. Pull a local model

```bash
# Recommended – small and fast (3 GB)
ollama pull phi3

# Or the larger Llama 3 (4.7 GB)
ollama pull llama3
```

### 3. Run in development mode

```bash
npm run tauri dev
```

The onboarding wizard will guide you through the rest (Ollama check, OpenClaw install, optional API keys).

---

## 🔑 Model Switching Logic

The app selects the LLM automatically based on Settings:

```
if llm_api_key is set in localStorage
  → use external model (OpenAI / Anthropic)
else
  → use local Ollama model (default: phi3)
```

You can change the local model name in **Settings → Local AI Model** (e.g. `phi3`, `llama3`, `mistral`).

---

## 🤖 Demo Agents

Click **⚡ Add Demo Agents** in the Agents tab (or Chat tab) to instantly create:

### Agent 1 – LinkedIn Trending Poster (Daily)
1. Searches for trending OpenClaw topics
2. Generates a LinkedIn post
3. Shows **Approval Modal** (in production mode) for review/edit
4. Posts to LinkedIn via Playwright browser automation
5. Scheduled to run **daily**

### Agent 2 – #openclaw Hashtag Commenter (Hourly)
1. Navigates to LinkedIn `#openclaw` hashtag feed
2. Comments on the top posts with a promotional message
3. Runs in **sandbox mode by default** (no real comments)
4. Scheduled to run **hourly**

---

## 🔒 Sandbox vs Production

| Mode | Behaviour |
|------|-----------|
| **Sandbox** (default) | Simulates every action; nothing is posted |
| **Production** | Real browser automation; approval required before posting |

Toggle in **Settings → Sandbox Mode**.

---

## ⏰ Scheduling

Schedules are persisted in SQLite and checked every 60 seconds by the Rust background scheduler.

Supported frequencies: `hourly`, `daily`, `weekly`.

Run history (start time, status, result) is displayed in the **Agents** tab under **Run History**.

---

## 🗄️ SQLite Persistence

The local database lives at:

- **Linux / macOS**: `~/.local/share/personaliz-assistant/data.db`
- **Windows**: `%APPDATA%\personaliz-assistant\data.db`

Tables: `agents`, `schedules`, `logs`, `run_history`.

---

## 🐍 Python CLI (agent_engine.py)

The agent engine supports two interfaces:

### New subcommand interface (used by Rust)

```bash
# Post to LinkedIn
python3 public/agent_engine.py linkedin_post \
  --content "My post text" \
  --sandbox true

# Comment on hashtag posts
python3 public/agent_engine.py linkedin_comment_hashtag \
  --hashtag openclaw \
  --comment "Check out Personaliz!" \
  --sandbox true

# Get trending topics (JSON)
python3 public/agent_engine.py trending_topics
```

### Legacy positional interface (backward compatible)

```bash
python3 public/agent_engine.py linkedin_trending_agent sandbox
python3 public/agent_engine.py hashtag_comment_agent sandbox
```

Playwright uses a **persistent browser profile** stored at:
`~/.local/share/personaliz-assistant/linkedin-profile/`

This means you log into LinkedIn **once** and the session is reused on subsequent runs.

---

## ⚙️ OpenClaw Setup

During onboarding Step 3, the app runs `npm install -g openclaw` for you.  
Requires Node.js 18+. You can also skip and install manually:

```bash
npm install -g openclaw
```

---

## 🏗️ Architecture

```
personaliz-ai-assistant/
├── src/                       React + TypeScript frontend
│   ├── App.tsx                Main app (Chat, Agents, Logs, Settings tabs)
│   └── components/
│       ├── Onboarding.tsx     5-step setup wizard (runs OpenClaw install)
│       ├── AgentCreationModal.tsx
│       └── ApprovalModal.tsx  Human-in-the-loop content review
├── src-tauri/
│   └── src/
│       ├── main.rs            Tauri commands (LLM, LinkedIn, DB, OpenClaw)
│       ├── db.rs              SQLite layer (rusqlite)
│       └── scheduler.rs       Background hourly/daily scheduler
└── public/
    └── agent_engine.py        Python Playwright automation engine
```

---

## 🛠️ Development

```bash
# Frontend only (Vite)
npm run dev

# Full Tauri app
npm run tauri dev

# Rust check (without running)
cd src-tauri && cargo check

# Build for production
npm run tauri build
```

---

## 🔐 Security & Privacy

- API keys are stored in `localStorage` (never sent to Personaliz servers)
- All agent actions require explicit user approval in production mode
- Sandbox mode is enabled by default
- Browser profile stored locally; LinkedIn credentials never leave your machine

---

## 📜 License

MIT © 2024 Personaliz
