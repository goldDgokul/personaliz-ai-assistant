# 🤖 Personaliz AI Desktop Assistant

A UI-first desktop automation assistant powered by **local AI (Llama 3 / Phi-3)** + **Tauri** that makes **OpenClaw** automation accessible to non-technical users — no terminal required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri)](https://tauri.app/)

---

## ✨ Features

- **Chat-First Interface** – create automation agents by chatting (type "create agent" or just describe your task)
- **Offline-first, local AI** – uses **llama3** / **phi3** via **Ollama** _or_ **llama.cpp** by default; no API key required
- **External AI support** – set an OpenAI or Anthropic key in Settings to switch automatically; routing logged to SQLite
- **Browser automation** – post to LinkedIn and comment on hashtag threads via Playwright
- **Human-in-the-loop approval** – review and edit generated content before any production post; every decision persisted to the `approvals` audit table
- **Sandbox mode** – simulate every action safely before going live
- **SQLite persistence** – agents, schedules, logs, run history, LLM usage, and approval decisions stored locally
- **Background scheduler** – cron-aware scheduler inside the Tauri runtime (60-second poll)
- **Cron scheduling** – full 5-field cron expression support per-agent (validated live in the UI)
- **Agent creation via chat** – wizard opens automatically when you describe a task; shows a JSON config preview in chat before confirming
- **OpenClaw config generation** – every new agent writes an `openclaw.config.json` to `~/.local/share/personaliz-assistant/agents/<id>/`
- **Chat-driven onboarding** – type `setup` in chat for a guided dependency help message; the onboarding wizard supports both Ollama and llama.cpp
- **Two demo agents** – LinkedIn Trending Poster (daily) + #openclaw Hashtag Commenter (hourly)

---

## 🚀 Quick Start

> 📖 **Need the full platform-specific guide?** See **[SETUP.md](./SETUP.md)** for copy-pasteable instructions covering Windows, macOS, and Linux from scratch.

### Prerequisites

| Tool | Install | Required? |
|------|---------|-----------|
| Rust + Cargo | https://rustup.rs | Yes |
| Node.js 18+ | https://nodejs.org | Yes |
| **Ollama** _or_ **llama.cpp** | see below | One of the two (or use cloud API key) |
| Python 3.9+ | https://python.org | For LinkedIn automation |
| Playwright | `pip install playwright && playwright install chromium` | For LinkedIn automation |
| OpenClaw CLI | `npm install -g openclaw` | For agent execution |

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
ollama serve            # start the API on http://localhost:11434
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

### 3. Install OpenClaw

```bash
npm install -g openclaw
```

The onboarding wizard can also install this automatically at Step 3.

### 4. Install Python automation dependencies

```bash
pip3 install playwright
playwright install chromium
```

### 5. Run in development mode

```bash
npm run tauri dev
```

> ⚠️ The **first Rust compilation** takes 3–10 minutes. Subsequent runs use a cache and start in ~10 seconds.

The onboarding wizard guides you through the rest (LLM check, OpenClaw install, optional API keys).

---

## 🌐 Remote Control MVP (Option C: single main laptop agent)

- Main laptop device id: `gokul-pc`
- Broker service (Render): `personaliz-broker` (`broker/` FastAPI + WebSocket)
- UI project (Vercel): `personaliz-ui`
- Storage: in-memory (MVP)
- Local Ollama endpoint stays private on laptop: `http://127.0.0.1:11434`

### Local development

1. Run broker:
   ```bash
   cd broker
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
   pip install -r requirements.txt
   export USER_TOKEN=your_user_token
   export AGENT_TOKEN=your_agent_token
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
2. Run UI (browser mode):
   ```bash
   npm install
   npm run dev
   ```
   Default broker URL is `http://localhost:8000` (override with `VITE_BROKER_URL`).
3. Run laptop app (`tauri dev` for testing, built app for daily use) with:
   - `BROKER_URL=http://localhost:8000`
   - `AGENT_TOKEN=<same as broker>`
   - `DEVICE_ID=gokul-pc` (optional; defaults to `gokul-pc`)

### Troubleshooting (remote mode)

- **`Port 1420 is already in use` when running `npm run tauri dev`**
  - Another Vite/Tauri dev server is already running.
  - Stop it (Windows example): `netstat -ano | findstr :1420` then `taskkill /PID <PID> /F`, then re-run `npm run tauri dev`.
- **Device stays offline in browser UI**
  - The laptop connector must complete the broker WebSocket handshake (`/ws/agent`) successfully with `X-AGENT-TOKEN`.
  - If handshake fails, the connector keeps retrying and the device remains offline until a successful WS connection is established.

### Production configuration

- **Render (`personaliz-broker`) env vars**
  - `AGENT_TOKEN=<secret>`
  - `USER_TOKEN=<secret>`
  - `CORS_ALLOWED_ORIGINS=https://<your-vercel-domain>`
- **Vercel (`personaliz-ui`) env vars**
  - `VITE_BROKER_URL=https://<your-render-service>.onrender.com`
- **Laptop built app env vars**
  - `BROKER_URL=https://<your-render-service>.onrender.com`
  - `AGENT_TOKEN=<same AGENT_TOKEN>`
  - `DEVICE_ID=gokul-pc`

### Authentication model

- Browser UI asks for `USER_TOKEN` at runtime and stores it in `localStorage` (`X-USER-TOKEN` for REST, token on client WS URL).
- Laptop agent connector authenticates with `X-AGENT-TOKEN`.
- Do **not** embed `USER_TOKEN` into build artifacts.

### Windows auto-start (built app)

1. Build app: `npm run tauri build`
2. Press `Win + R`, run: `shell:startup`
3. Place a shortcut to the built Personaliz `.exe` in this Startup folder.

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
1. Fetches today's latest AI/automation topics from multiple RSS feeds
2. Picks a fresh topic (skips the one used in the previous run to avoid repeats)
3. **Generates a unique "viral" LinkedIn post** using a local Ollama LLM (`llama3:8b`) — no API key required
4. Validates the post structure (hook with 🤯, transition with ↓, `->` bullets, ends with `Thoughts? 👇`) and retries once if it fails
5. **Production mode**: shows Approval Modal for human review/edit before posting
6. Posts to LinkedIn via Playwright browser automation (instant paste — not letter-by-letter typing)
7. Scheduled to run **daily** (`daily` frequency, `0 9 * * *` as cron)

#### Required local setup for LLM generation
```bash
# 1. Install and start Ollama (https://ollama.com)
ollama serve

# 2. Pull the default model (one-time download, ~5 GB)
ollama pull llama3:8b
```

The agent defaults to `llama3:8b`. Override via the `OLLAMA_MODEL` environment variable (e.g. `OLLAMA_MODEL=llama3.1:8b`).

#### Debugging browser automation
Set `KEEP_BROWSER_OPEN=1` before running to prevent the Chromium window from closing when an error occurs. The window will stay open for 60 seconds so you can inspect the page state (login wall, captcha, selector mismatch, etc.):

```bash
KEEP_BROWSER_OPEN=1 python3 public/agent_engine.py linkedin_post --content "test" --sandbox false
```

This is also respected by the Trending Agent when it calls `post_to_linkedin_browser` internally.

### Agent 2 – #openclaw Hashtag Commenter (Hourly)
1. Navigates to LinkedIn `#openclaw` hashtag feed
2. Comments on the top posts with a promotional message
3. Runs in **sandbox mode by default** (logs what _would_ happen)
4. Scheduled to run **hourly**
5. Generates `openclaw.config.json` automatically

Both agents are fully functional in sandbox mode out of the box — no LinkedIn credentials needed to demo.

---

## 🗑️ Clear Logs / Clear Data

### Clear Logs button (Logs tab)
A **🗑️ Clear Logs** button appears at the top of the **Logs** tab.  
Clicking it:
- Deletes all rows from the SQLite `logs` table
- Removes the `openclaw_logs` key from `localStorage`
- Clears the in-memory logs list in the UI

After a restart, old logs will **not** re-appear.

### Reset App button (Settings tab)
The existing **🔄 Reset App** button in Settings has been updated to also:
- Delete all SQLite `logs` rows (in addition to clearing `localStorage` and resetting UI state)

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
| `llm_usage` | Which provider/model was used for each LLM call |
| `approvals` | Human approval decisions (outcome, content preview) |
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
│   ├── App.tsx                       Main app (Chat, Agents, Logs, Settings)
│   └── components/
│       ├── Onboarding.tsx            5-step wizard (Ollama or llama.cpp, OpenClaw, API keys)
│       ├── AgentCreationModal.tsx    4-step wizard incl. cron expression input + live validation
│       └── ApprovalModal.tsx         Human-in-the-loop review (logs outcome to DB)
├── src-tauri/
│   └── src/
│       ├── main.rs                   All Tauri commands (incl. run_openclaw_agent)
│       ├── db.rs                     SQLite layer (rusqlite) – 11 tables
│       └── scheduler.rs              Background scheduler + cron parser
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
| `check_openclaw_installed` / `install_openclaw` | OpenClaw dependency management |
| `create_openclaw_config` | Writes `openclaw.config.json` for an agent |
| `run_openclaw_agent` | Runs `openclaw run <config_path>` and stores stdout/stderr in `openclaw_runs` table |
| `db_get_openclaw_runs` | Returns stored OpenClaw run records |
| `validate_cron_expression` | Validates a 5-field cron expression and returns next run time |
| `db_upsert_schedule` | Upsert schedule (supports `cron_expression` field) |
| `db_record_approval` / `db_list_approvals` | Approval audit log CRUD |
| `check_node_available` / `check_python_available` / `check_playwright_available` | Dependency detection |
| `get_os_info` | Returns OS platform and arch |

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
| **NL→config→deploy** | Type `create agent` / describe a task → JSON config preview in chat → type `confirm` to deploy |
| **Approval audit** | Every approval/rejection recorded in `approvals` table; visible in Logs tab |
| **OpenClaw runs log** | Every `openclaw run` stdout/stderr stored in `openclaw_runs` table; visible in Logs tab |
| **Sandbox mode** | Enabled by default; toggle in Settings |
| **Local LLM** | Ollama (phi3 / llama3) _or_ llama.cpp (`llama-server`) — configured in onboarding |
| **External LLM** | OpenAI / Anthropic / Google AI — set API key in Settings |
| **Documentation** | This README — covers all integration points, CLI commands, model routing, tables |
