# 🤖 Personaliz AI Desktop Assistant

A UI-first desktop automation assistant powered by **local AI (Llama 3 / Phi-3)** + **Tauri** that makes **OpenClaw** automation accessible to non-technical users — no terminal required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri)](https://tauri.app/)

---

## ✨ Features

- **Chat-First Interface** – create automation agents by chatting (type "create agent" or just describe your task)
- **Offline-first, local AI** – uses **llama3** / **phi3** via **Ollama** _or_ **llama.cpp** by default; no API key required
- **External AI support** – set an OpenAI or Anthropic key in Settings to switch automatically; routing logged to SQLite
- **Persistent floating assistant** – always-visible 🤖 FAB; opens a mini-chat overlay from any tab without leaving your current view
- **Browser automation** – post to LinkedIn and comment on hashtag threads via Playwright
- **Human-in-the-loop approval** – review and edit generated content before any production post; every decision persisted to the `approvals` audit table
- **Sandbox mode** – simulate every action safely before going live
- **SQLite persistence** – agents, schedules, logs, run history, LLM usage, heartbeats, and approval decisions stored locally
- **Background scheduler** – cron-aware scheduler inside the Tauri runtime (60-second poll)
- **Cron scheduling** – full 5-field cron expression support per-agent (validated live in the UI)
- **Agent creation via chat** – wizard opens automatically when you describe a task; shows a JSON config preview in chat before confirming
- **OpenClaw config generation** – every new agent writes an `openclaw.config.json` to `~/.local/share/personaliz-assistant/agents/<id>/`
- **Chat-driven onboarding** – type `setup` in chat for a guided dependency help message; the onboarding wizard supports both Ollama and llama.cpp
- **Heartbeat monitoring** – per-agent health checks polled every N minutes; results logged to SQLite
- **Two demo agents** – LinkedIn Trending Poster (daily) + #openclaw Hashtag Commenter (hourly)

---

## 🚀 Quick Start

### Prerequisites

| Tool | Install | Required? |
|------|---------|-----------|
| Rust + Cargo | https://rustup.rs | Yes |
| Node.js 18+ | https://nodejs.org | Yes |
| **Ollama** _or_ **llama.cpp** | see below | One of the two (or use cloud API key) |
| Python 3.9+ | https://python.org | For LinkedIn automation |
| Playwright | `pip install playwright && playwright install chromium` | For LinkedIn automation |

### 1. Clone & install

```bash
git clone https://github.com/goldDgokul/personaliz-ai-assistant
cd personaliz-ai-assistant
npm install
```

### 2. Set up a local model (choose one)

#### Option A – Ollama (recommended)

```bash
# Install Ollama from https://ollama.ai then pull a model:
ollama pull phi3        # 3 GB – fast and recommended
ollama pull llama3      # 4.7 GB – larger, higher quality
```

Ollama exposes an API on **port 11434** automatically after installation.

#### Option B – llama.cpp (no installer, pre-built binary)

1. Download **llama-server** from [github.com/ggerganov/llama.cpp/releases](https://github.com/ggerganov/llama.cpp/releases) (pre-built for macOS / Linux / Windows – no compilation needed)
2. Download a GGUF model, e.g. [Phi-3-mini GGUF on HuggingFace](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf)
3. Start the server:
   ```bash
   llama-server -m phi-3-mini.gguf --port 8080
   ```
   The server exposes an OpenAI-compatible `/v1/chat/completions` endpoint on **port 8080**.

The onboarding wizard (Step 2) lets you select between Ollama and llama.cpp and tests the connection for you.

### 3. Run in development mode

```bash
npm run tauri dev
```

The onboarding wizard guides you through the rest (LLM check, OpenClaw install, optional API keys).

---

## 🧠 Local Model Management

### Ollama

| Task | Command |
|------|---------|
| Install a model | `ollama pull phi3` |
| List installed models | `ollama list` |
| Remove a model | `ollama rm phi3` |
| Start the server manually | `ollama serve` |
| Default API endpoint | `http://localhost:11434/api/chat` |

Change the active model in **Settings → Local AI Model**.

### llama.cpp

| Task | How |
|------|-----|
| Download binary | [GitHub Releases](https://github.com/ggerganov/llama.cpp/releases) → `llama-server` |
| Download models | [HuggingFace GGUF models](https://huggingface.co/models?library=gguf) |
| Start the server | `llama-server -m <model>.gguf --port 8080` |
| Default API endpoint | `http://localhost:8080/v1/chat/completions` |

The app checks llama.cpp availability via a TCP connect to port 8080 (`check_llamacpp_status` command).

---

## 🔑 LLM Routing – Local vs External

The app picks the LLM **automatically** based on Settings, with no manual switching needed:

```
if llm_api_key is set in Settings
  → use external provider (OpenAI / Anthropic / Google)
  → routed through Tauri backend (logged to llm_usage table in SQLite)
else if Ollama is running on :11434
  → use local Ollama model
else
  → use llama.cpp model on :8080
```

### Supported external providers & key formats

| Provider | Key format | Example models |
|---|---|---|
| **OpenAI** | `sk-…` | `gpt-4`, `gpt-4o`, `gpt-3.5-turbo` |
| **Anthropic** | `sk-ant-…` | `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` |
| **Google AI** | `AIzaSy…` | `gemini-2.0-flash`, `gemini-1.5-pro`, `gemma-2-2b-it` |

> **Using Gemma 2B for free?** Run it locally via Ollama — no API key needed:
> ```
> ollama pull gemma2:2b
> ```
> Then select `gemma2:2b` in ⚙️ Settings → Local AI Model.

> **Using Google AI Studio key?** Enter your `AIzaSy…` key in ⚙️ Settings → External LLM  
> and select a **Gemini** or **Gemma** model from the *External Model* dropdown.

Every chat message records which provider and model was used in the `llm_usage` SQLite table.  
Visible in **Logs tab → LLM Usage Log**.

---

## ⚙️ OpenClaw Integration

### Onboarding (automatic)

During onboarding Step 3 the app runs `npm install -g openclaw` for you — no terminal needed.

### OpenClaw config file generation

Every agent you create generates an `openclaw.config.json` file:

```
~/.local/share/personaliz-assistant/agents/<agent_id>/openclaw.config.json
```

Example file:

```json
{
  "id": "agent_1712345678",
  "name": "LinkedIn Trending Poster",
  "role": "Content Creator",
  "goal": "Post trending OpenClaw topics daily",
  "tools": ["LinkedIn", "Browser"],
  "schedule": "0 9 * * *",
  "version": "1",
  "created_at": "2025-01-01T09:00:00Z"
}
```

This file is consumed directly by the OpenClaw CLI when running agents outside the GUI:

```bash
openclaw run ~/.local/share/personaliz-assistant/agents/<agent_id>/openclaw.config.json
```

### Tauri OpenClaw commands

| Command | Purpose |
|---------|---------|
| `check_openclaw_installed` | Detects if `openclaw` is in PATH |
| `install_openclaw` | Runs `npm install -g openclaw` |
| `run_openclaw_command` | Executes arbitrary openclaw commands |
| `create_openclaw_config` | Writes `openclaw.config.json` for an agent |

---

## ⏰ Scheduling & Cron Support

Schedules are persisted in SQLite and checked every **60 seconds** by the Rust background scheduler.

### Predefined frequencies

`once`, `hourly`, `daily`, `weekly`

### Custom cron expressions (5-field standard)

When creating an agent, select **Custom (cron)** in the Schedule step to enter a full 5-field cron expression:

| Field | Range | Example |
|-------|-------|---------|
| minute | 0–59 | `0` = on the hour |
| hour | 0–23 | `9` = 9 AM |
| day of month | 1–31 | `*` = every day |
| month | 1–12 | `*` = every month |
| day of week | 0–6 (Sun=0) | `1-5` = Mon–Fri |

**Common examples:**

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | 9 AM every day |
| `0 9 * * 1-5` | 9 AM Monday–Friday |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | 1st of every month at midnight |

The UI validates the expression live and shows the next scheduled run time.  
Cron expressions are stored in the `cron_expression` column of the `schedules` table and parsed in Rust (`scheduler.rs`).

---

## 🤖 Demo Agents (Live-Demo Ready)

Click **⚡ Add Demo Agents** in the Agents or Chat tab:

### Agent 1 – LinkedIn Trending Poster (Daily)
1. Searches for trending OpenClaw topics
2. Generates a LinkedIn post via local LLM
3. **Production mode**: shows Approval Modal for human review/edit before posting
4. Posts to LinkedIn via Playwright browser automation
5. Scheduled to run **daily** (`daily` frequency, `0 9 * * *` as cron)
6. Generates `openclaw.config.json` automatically

### Agent 2 – #openclaw Hashtag Commenter (Hourly)
1. Navigates to LinkedIn `#openclaw` hashtag feed
2. Comments on the top posts with a promotional message
3. Runs in **sandbox mode by default** (logs what _would_ happen)
4. Scheduled to run **hourly**
5. Generates `openclaw.config.json` automatically

Both agents are fully functional in sandbox mode out of the box — no LinkedIn credentials needed to demo.

---

## 🔒 Sandbox vs Production

| Mode | Behaviour |
|------|-----------|
| **Sandbox** (default) | Simulates every action; nothing is posted; prefix `[SANDBOX]` in logs |
| **Production** | Real browser automation; **Approval Modal required** before LinkedIn posting |

Toggle in **Settings → Sandbox Mode**.

---

## 💬 Chat-Driven Onboarding

Type any of these in the chat to get guided help:

| Input | Response |
|-------|----------|
| `setup` or `/setup` | Step-by-step dependency guide (LLM, OpenClaw, API keys) |
| `add demo agents` | Creates both LinkedIn agents instantly |
| `create agent` / `new agent` | Opens the agent creation wizard with a JSON config preview |
| `what is sandbox mode?` | Explanation from the LLM |

---

## ✅ Approval Audit Log

Every human approval decision is recorded in the `approvals` SQLite table:

| Column | Value |
|--------|-------|
| `agent_id` | Which agent generated the content |
| `content_preview` | First 200 chars of the content |
| `outcome` | `approved` / `rejected` / `cancelled` |
| `decided_at` | ISO 8601 timestamp |
| `notes` | Optional note |

Visible in **Logs tab → Approval Audit Log**.

---

## 💓 Heartbeat Monitoring

Each agent can have a heartbeat enabled from the agent card:

- **Enable**: click `💓 Heartbeat` (default: every 60 min)
- **Disable**: click `💔 Heartbeat`
- Results show in **Agents tab → Heartbeat Monitor** (refresh with 🔄)
- All check outcomes appended to `logs` table for auditing

---

## 🗄️ SQLite Persistence

Database path:
- **Linux / macOS**: `~/.local/share/personaliz-assistant/data.db`
- **Windows**: `%APPDATA%\personaliz-assistant\data.db`

| Table | Contents |
|-------|----------|
| `agents` | Agent definitions (name, role, goal, tools, status) |
| `schedules` | Run schedules (frequency, `cron_expression`, enabled, next_run) |
| `logs` | Append-only execution log |
| `run_history` | Per-invocation outcome records |
| `heartbeats` | Per-agent heartbeat config |
| `heartbeat_runs` | Historical heartbeat check results |
| `llm_usage` | Which provider/model was used for each LLM call |
| `approvals` | Human approval decisions (outcome, content preview) |
| `event_triggers` | Generic event trigger definitions (type, URL, keyword, interval) |
| `event_history` | One row per event trigger firing |
| `openclaw_runs` | Per-invocation OpenClaw CLI stdout/stderr capture |

---

## 🐍 Python CLI (agent_engine.py)

`public/agent_engine.py` is the unified Python automation entrypoint.

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

Log into LinkedIn **once** — the session is reused on subsequent runs.

---

## 🏗️ Architecture

```
personaliz-ai-assistant/
├── src/                              React + TypeScript frontend
│   ├── App.tsx                       Main app (Chat, Agents, Events, Logs, Settings + floating mini-chat)
│   └── components/
│       ├── Onboarding.tsx            5-step wizard (Ollama or llama.cpp, OpenClaw, API keys)
│       ├── AgentCreationModal.tsx    4-step wizard incl. cron expression input + live validation
│       └── ApprovalModal.tsx         Human-in-the-loop review (logs outcome to DB)
├── src-tauri/
│   └── src/
│       ├── main.rs                   All Tauri commands (incl. run_openclaw_agent, event triggers)
│       ├── db.rs                     SQLite layer (rusqlite) – 11 tables
│       └── scheduler.rs              Background scheduler + cron parser + heartbeat + event trigger checks
└── public/
    └── agent_engine.py               Python Playwright automation engine (with RSS topic fetching)
```

### Tauri command reference

| Command | Purpose |
|---------|---------|
| `check_ollama_status` | TCP connect check on 127.0.0.1:11434 |
| `check_llamacpp_status` | TCP connect check on 127.0.0.1:8080 |
| `send_message_to_llm` | Send message to local Ollama; logs usage to SQLite |
| `send_message_to_external_llm` | Send message to OpenAI or Anthropic; logs usage to SQLite |
| `post_to_linkedin` / `comment_linkedin_hashtag` | LinkedIn automation via agent_engine.py |
| `check_openclaw_installed` / `install_openclaw` / `run_openclaw_command` | OpenClaw dependency management |
| `create_openclaw_config` | Writes `openclaw.config.json` for an agent |
| `run_openclaw_agent` | Runs `openclaw run <config_path>` and stores stdout/stderr in `openclaw_runs` table |
| `db_get_openclaw_runs` | Returns stored OpenClaw run records |
| `validate_cron_expression` | Validates a 5-field cron expression and returns next run time |
| `db_upsert_schedule` | Upsert schedule (supports `cron_expression` field) |
| `db_record_approval` / `db_list_approvals` | Approval audit log CRUD |
| `db_upsert_heartbeat` / `db_list_heartbeats` / `db_delete_heartbeat` | Heartbeat config CRUD |
| `db_get_heartbeat_runs` | Heartbeat history |
| `db_upsert_event_trigger` / `db_list_event_triggers` / `db_delete_event_trigger` | Event trigger CRUD |
| `db_get_event_history` | Event trigger firing history |
| `check_node_available` / `check_python_available` / `check_playwright_available` | Dependency detection |
| `get_os_info` | Returns OS platform and arch |

---

## ⚡ Event Triggers (Generic Event Handler)

Event triggers run an agent automatically when a web condition fires. They are polled every 60 seconds by the Rust scheduler alongside regular cron schedules.

### Trigger types

| Type | What it does |
|------|-------------|
| `keyword_found` | Fetches a URL, fires the agent if the keyword appears in the page body |
| `url_change` | Fires if the page content has changed since last check (FNV hash comparison) |
| `new_post` | Fires when new RSS/feed items appear at the target URL |

### How it works internally

```
Scheduler loop (every 60s)
  └── run_due_event_triggers()
        ├── For each enabled trigger
        │     ├── Check if check_interval_min has elapsed since last_checked
        │     ├── HTTP GET target_url (blocking, stdlib only, http:// only)
        │     ├── Compare against last_hash / search for keyword
        │     ├── If triggered → record_event_history + run agent Python
        │     └── Update last_checked and last_hash in SQLite
```

### SQLite tables

| Table | Contents |
|-------|----------|
| `event_triggers` | Trigger definitions (type, URL, keyword, interval, enabled) |
| `event_history` | One row per firing (trigger_id, agent_id, fired_at, matched_content) |

### UI

Create and manage triggers in the **⚡ Events** tab. View firing history below the trigger list.

---

## 🛠️ Development

```bash
# Frontend only (Vite dev server)
npm run dev

# Full Tauri app
npm run tauri dev

# TypeScript type check
npx tsc --noEmit

# Rust syntax check (without GTK / display)
cd src-tauri && cargo check

# Rust unit tests (cron parser etc.)
cd src-tauri && cargo test

# Build for production
npm run tauri build
```

---

## 🔐 Security & Privacy

- API keys are stored in `localStorage` only; never sent to Personaliz servers
- All agent actions require explicit user approval in production mode (logged to `approvals` table)
- Sandbox mode is enabled by default
- Browser profile stored locally; LinkedIn credentials never leave your machine
- LLM usage logged locally to SQLite for auditing; no telemetry

---

## 📜 License

MIT © 2024 Personaliz

---

## 🎬 Demo

> **Demo video / animated GIF:** *(link to be added — run `npm run tauri dev`, open the app, type `add demo agents` in chat, then run the LinkedIn Trending Poster in sandbox mode to see the full flow)*

---

## 📋 Submission Checklist

| Item | Detail |
|------|--------|
| **Repository** | https://github.com/goldDgokul/personaliz-ai-assistant |
| **Branch** | `main` (all features merged) |
| **Demo agents** | LinkedIn Trending Poster + #openclaw Hashtag Commenter — run out-of-the-box in sandbox mode |
| **OpenClaw CLI integration** | `create_openclaw_config` writes `openclaw.config.json`; `run_openclaw_agent` invokes `openclaw run <path>` and captures stdout/stderr in `openclaw_runs` table |
| **Chat-driven setup** | Type `setup` in chat → live dependency scan; type `install openclaw` → runs install |
| **Cron scheduling** | Full 5-field cron expressions stored in SQLite; validated live in UI; next run preview |
| **Event triggers** | Generic event handler (keyword found / URL change / new post) — managed in ⚡ Events tab |
| **NL→config→deploy** | Type `create agent` / describe a task → JSON config preview in chat → type `confirm` to deploy |
| **Approval audit** | Every approval/rejection recorded in `approvals` table; visible in Logs tab |
| **OpenClaw runs log** | Every `openclaw run` stdout/stderr stored in `openclaw_runs` table; visible in Logs tab |
| **Sandbox mode** | Enabled by default; toggle in Settings |
| **Local LLM** | Ollama (phi3 / llama3) _or_ llama.cpp (`llama-server`) — configured in onboarding |
| **External LLM** | OpenAI / Anthropic / Google AI — set API key in Settings |
| **Floating assistant** | 🤖 FAB always visible; opens mini-chat overlay on all tabs; `z-index: 10001` |
| **Documentation** | This README — covers all integration points, CLI commands, model routing, tables |
