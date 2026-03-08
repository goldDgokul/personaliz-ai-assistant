# 🤖 Personaliz AI Desktop Assistant

A UI-first desktop automation assistant powered by **local AI (Llama 3 / Phi-3 via Ollama)** + **Tauri** that makes **OpenClaw** automation accessible to non-technical users — no terminal required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri)](https://tauri.app/)
[![Powered by Ollama](https://img.shields.io/badge/Powered%20by-Ollama-FF6B6B)](https://ollama.ai/)

---

## ✨ Features

- **Chat-First Interface** – create automation agents by chatting (no CLI needed)
- **Offline-first, local AI** – uses **llama3** (or phi3 / mistral) via Ollama by default; no API key required
- **External AI support** – set an OpenAI or Anthropic key in Settings to switch automatically; routing logged to SQLite
- **Floating assistant icon** – always-visible button to open/close the chat panel from any tab
- **Browser automation** – post to LinkedIn and comment on hashtag threads via Playwright
- **Human-in-the-loop approval** – review and edit content before any production post
- **Sandbox mode** – simulate every action safely before going live
- **SQLite persistence** – agents, schedules, logs, run history, LLM usage, and heartbeats stored locally
- **Background scheduler** – hourly / daily schedule execution inside the Tauri runtime
- **Heartbeat monitoring** – per-agent health checks polled every N minutes; results logged to SQLite
- **Two demo agents** – LinkedIn Trending Poster (daily) + #openclaw Hashtag Commenter (hourly)

---

## 🚀 Quick Start

### Prerequisites

| Tool | Install |
|------|---------|
| Rust + Cargo | https://rustup.rs |
| Node.js 18+ | https://nodejs.org |
| **Ollama** | https://ollama.ai |
| Python 3.9+ | https://python.org |
| Playwright | `pip install playwright && playwright install chromium` |

### 1. Clone & install

```bash
git clone https://github.com/goldDgokul/personaliz-ai-assistant
cd personaliz-ai-assistant
npm install
```

### 2. Pull the default local model (llama3)

```bash
# Default – llama3 (already installed per project requirements)
ollama pull llama3

# Alternative lighter model
ollama pull phi3
```

### 3. Run in development mode

```bash
npm run tauri dev
```

The onboarding wizard guides you through the rest (Ollama check, OpenClaw install, optional API keys).

---

## 🔑 LLM Routing – Local vs External

The app picks the LLM **automatically** based on Settings, with no manual switching needed:

```
if llm_api_key is set in Settings
  → use external provider (OpenAI / Anthropic)
  → routed through Tauri backend (logged to llm_usage table in SQLite)
else
  → use local Ollama model (default: llama3)
  → also logged to llm_usage table in SQLite
```

### Local model (offline-first)

- Default model: **`llama3`** (Llama 3 8B, already installed)
- Changed in **Settings → Local AI Model** (`llama3`, `phi3`, `mistral`, …)
- The Tauri backend (`send_message_to_llm`) sends requests to `http://localhost:11434/api/chat`
- Falls back to direct HTTP if running outside Tauri (dev mode)

### External model (optional)

- Set an API key in **Settings → External LLM**
- Supported providers:
  - **OpenAI**: `gpt-4`, `gpt-4o`, `gpt-3.5-turbo`
  - **Anthropic**: `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`
- The Tauri backend (`send_message_to_external_llm`) routes the request and **records usage in SQLite** so you can audit which model was used
- API keys are stored in **localStorage** only; they are never sent to Personaliz servers

### LLM usage log

Every chat message records which provider and model was used in the `llm_usage` SQLite table.  
Visible in **Logs tab → LLM Usage Log**.

---

## 🤖 Demo Agents

Click **⚡ Add Demo Agents** in the Agents or Chat tab:

### Agent 1 – LinkedIn Trending Poster (Daily)
1. Searches for trending OpenClaw topics
2. Generates a LinkedIn post via local LLM
3. **Production mode**: shows Approval Modal for human review/edit before posting
4. Posts to LinkedIn via Playwright browser automation
5. Scheduled to run **daily** (background scheduler)

### Agent 2 – #openclaw Hashtag Commenter (Hourly)
1. Navigates to LinkedIn `#openclaw` hashtag feed
2. Comments on the top posts with a promotional message
3. Runs in **sandbox mode by default** (logs what *would* happen)
4. Scheduled to run **hourly** (background scheduler)

---

## 🔒 Sandbox vs Production

| Mode | Behaviour |
|------|-----------|
| **Sandbox** (default) | Simulates every action; nothing is posted; prefix `[SANDBOX]` in logs |
| **Production** | Real browser automation; **approval modal required** before LinkedIn posting |

Toggle in **Settings → Sandbox Mode**.

---

## ⏰ Scheduling

Schedules are persisted in SQLite and checked every **60 seconds** by the Rust background scheduler.

Supported frequencies: `hourly`, `daily`, `weekly`.

Run history (start time, status, result) is displayed in the **Agents** tab under **Run History**.

---

## 💓 Heartbeat Monitoring

Each agent can have a heartbeat enabled from the agent card in the **Agents** tab:

- **Enable heartbeat**: click the `💓 Heartbeat` button on an agent card (default: every 60 min)
- **Disable heartbeat**: click `💔 Heartbeat` to stop monitoring
- The background scheduler polls heartbeat configs alongside schedules and records outcomes in the `heartbeat_runs` table
- Results show in **Agents tab → Heartbeat Monitor** (refresh with 🔄)
- Heartbeat checks also append entries to the `logs` table for auditing

Heartbeat data is stored in two SQLite tables:
- `heartbeats` – per-agent config (interval, enabled flag, last check timestamp)
- `heartbeat_runs` – historical outcomes of each check

---

## 🗄️ SQLite Persistence

The local database lives at:

- **Linux / macOS**: `~/.local/share/personaliz-assistant/data.db`
- **Windows**: `%APPDATA%\personaliz-assistant\data.db`

Tables:

| Table | Contents |
|-------|----------|
| `agents` | Agent definitions (name, role, goal, tools, status) |
| `schedules` | Run schedules (frequency, enabled, next_run) |
| `logs` | Append-only execution log |
| `run_history` | Per-invocation outcome records |
| `heartbeats` | Per-agent heartbeat config |
| `heartbeat_runs` | Historical heartbeat check results |
| `llm_usage` | Which provider/model was used for each LLM call |

---

## 🐍 Python CLI (agent_engine.py)

`public/agent_engine.py` is the **single, unified** Python automation entrypoint.

### Subcommand interface (used by the Rust/Tauri backend)

```bash
# Post to LinkedIn (or simulate in sandbox)
python3 public/agent_engine.py linkedin_post \
  --content "My post text" \
  --sandbox true

# Comment on hashtag posts
python3 public/agent_engine.py linkedin_comment_hashtag \
  --hashtag openclaw \
  --comment "Check out Personaliz!" \
  --sandbox true

# Get trending topics as JSON
python3 public/agent_engine.py trending_topics
```

### Legacy positional interface (backward compatible)

```bash
python3 public/agent_engine.py linkedin_trending_agent sandbox
python3 public/agent_engine.py hashtag_comment_agent sandbox
```

All commands output structured JSON:

```json
{
  "status": "success",
  "message": "Human-readable summary",
  "logs": [{"timestamp": "ISO", "level": "info", "message": "..."}],
  "posted": 0,
  "comments_posted": 3
}
```

Playwright uses a **persistent browser profile** stored at:
`~/.local/share/personaliz-assistant/linkedin-profile/`

Log into LinkedIn **once** and the session is reused on subsequent runs.

---

## ⚙️ OpenClaw Setup

During onboarding Step 3, the app runs `npm install -g openclaw` for you — no terminal needed.

The Tauri backend exposes:
- `check_openclaw_installed` – detects if `openclaw` is in PATH
- `install_openclaw` – runs `npm install -g openclaw`
- `run_openclaw_command` – executes arbitrary openclaw commands
- `check_node_available` – verifies Node.js is installed
- `check_playwright_available` – verifies Playwright Python package is importable

---

## 🏗️ Architecture

```
personaliz-ai-assistant/
├── src/                         React + TypeScript frontend
│   ├── App.tsx                  Main app (Chat, Agents, Logs, Settings tabs + floating FAB)
│   └── components/
│       ├── Onboarding.tsx       5-step setup wizard
│       ├── AgentCreationModal.tsx
│       └── ApprovalModal.tsx    Human-in-the-loop content review
├── src-tauri/
│   └── src/
│       ├── main.rs              Tauri commands (LLM, LinkedIn, DB, OpenClaw, heartbeats)
│       ├── db.rs                SQLite layer (rusqlite) – 7 tables
│       └── scheduler.rs         Background scheduler (60-sec poll) + heartbeat checks
└── public/
    └── agent_engine.py          Python Playwright automation engine (unified CLI)
```

### Tauri command reference

| Command | Purpose |
|---------|---------|
| `check_ollama_status` | TCP connect check on 127.0.0.1:11434 |
| `send_message_to_llm` | Send message to local Ollama; logs usage to SQLite |
| `send_message_to_external_llm` | Send message to OpenAI or Anthropic; logs usage to SQLite |
| `db_record_llm_usage` / `db_get_llm_usage` | Manual LLM usage log CRUD |
| `post_to_linkedin` | Run `agent_engine.py linkedin_post` |
| `comment_linkedin_hashtag` | Run `agent_engine.py linkedin_comment_hashtag` |
| `check_openclaw_installed` / `install_openclaw` | OpenClaw dependency management |
| `check_node_available` / `check_playwright_available` | Dependency checks |
| `get_os_info` | Returns OS / arch info |
| `db_upsert_heartbeat` / `db_list_heartbeats` / `db_delete_heartbeat` | Heartbeat config CRUD |
| `db_get_heartbeat_runs` | Heartbeat history |

---

## 🛠️ Development

```bash
# Frontend only (Vite)
npm run dev

# Full Tauri app
npm run tauri dev

# TypeScript type check
npx tsc --noEmit

# Rust syntax check (without running)
cd src-tauri && cargo check

# Build for production
npm run tauri build
```

---

## 🔐 Security & Privacy

- API keys are stored in `localStorage` only; never sent to Personaliz servers
- All agent actions require explicit user approval in production mode
- Sandbox mode is enabled by default
- Browser profile stored locally; LinkedIn credentials never leave your machine
- LLM usage is logged locally to SQLite for auditing; no telemetry

---

## 📜 License

MIT © 2024 Personaliz

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
