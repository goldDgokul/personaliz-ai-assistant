# Personaliz.ai – OpenClaw Desktop Task: Completion Audit

> **Audit date:** 2026-03-20  
> **Branch audited:** `main`  
> **Purpose:** Document the unresolved gaps and blockers between the current implementation and the full requirements of the *Personaliz.ai – OpenClaw Desktop Task*.

---

## Quick Summary

| # | Requirement | Status |
|---|-------------|--------|
| 1 | True offline local LLM runtime (no Ollama required) | ❌ Not fixed |
| 2 | OpenClaw-based agent creation/execution | ❌ Not fixed |
| 3 | Chat-driven setup replacing CLI end-to-end | ❌ Not fixed |
| 4 | Cron scheduling | ❌ Not fixed |
| 5 | Generic event handler system (beyond heartbeat) | ❌ Not fixed |
| 6 | Hardening demo agents for live-demo constraints | ❌ Not fixed |
| 7 | Always-on floating assistant / overlay | ⚠️ Not fully fixed |
| 8 | Natural language → config → preview → deploy | ❌ Not fixed |
| 9 | Logs & observability completeness | ❌ Not fixed |
| 10 | Documentation completeness | ❌ Not fixed |

---

## Detailed Gap Checklist

### 1. True offline local LLM runtime without requiring Ollama

**Status: ❌ Not fixed**

- [ ] Bundle or auto-manage a local LLM runtime (e.g. `llama.cpp` binary, `gguf` runner, `mistral.rs`) **without** requiring the user to separately install Ollama
- [ ] First-install onboarding works fully **offline** — no manual CLI steps
- [ ] Installer flow detects OS, downloads the appropriate runtime, and places it in a managed location
- [ ] Onboarding UI reflects the selected runtime and confirms it is operational before proceeding

**Current state:** The app requires a running Ollama instance for local LLM inference. While `llama.cpp` is mentioned in the README as an alternative, no bundled binary or automatic management exists; users must install and run either service manually before the app functions.

---

### 2. OpenClaw-based agent creation/execution (core requirement)

**Status: ❌ Not fixed**

- [ ] Implement a wrapper layer that creates real OpenClaw projects/agents via CLI calls
- [ ] Generate `openclaw.config.json` (or equivalent) files that OpenClaw actually understands and executes
- [ ] Start/stop/monitor OpenClaw agents through the in-app scheduler (not via ad-hoc `python agent_engine.py`)
- [ ] Map every chat intent → OpenClaw artifact (project, agent, tool config)
- [ ] Capture and display OpenClaw CLI stdout/stderr per run in the UI

**Current state:** Agent execution relies on Playwright Python scripts (`agent_engine.py`). OpenClaw detection and installation helpers exist, but no real OpenClaw project/agent/config flow is wired up. Demo agents are not driven by OpenClaw.

---

### 3. Chat-driven setup replacing CLI end-to-end

**Status: ❌ Not fixed**

- [ ] Detect OS and required dependencies (Node, Python, Playwright, OpenClaw) from within chat
- [ ] Ask user permission inside chat before running any install command
- [ ] Stream install progress and stdout back into the chat as messages/log entries
- [ ] Allow user to retry or skip individual steps through chat commands
- [ ] Remove any remaining requirement for the user to open a terminal

**Current state:** Dependency setup is handled by a wizard UI (`Onboarding.tsx`) that checks Ollama and installs OpenClaw. There is no fully conversational install mode where a user can type "setup" and have the assistant drive all installs interactively with streamed progress.

---

### 4. Cron scheduling

**Status: ❌ Not fixed**

- [ ] Parse full 5-field cron expressions (e.g. `*/15 9-17 * * 1-5`)
- [ ] Validate cron strings live in the UI with human-readable next-run preview
- [ ] Persist cron expressions in SQLite per agent
- [ ] Compute and display the next scheduled run time for each agent
- [ ] Replace or augment the current `hourly`/`daily`/`weekly` enum with free-form cron input

**Current state:** The scheduler in `scheduler.rs` supports fixed frequency labels (`hourly`, `daily`, `weekly`). No cron expression parser, storage, or UI input exists.

---

### 5. Generic event handler system (beyond heartbeat)

**Status: ❌ Not fixed**

- [ ] Define a general-purpose event-trigger model (URL change, keyword found, new post detected, etc.)
- [ ] Store event definitions and history in SQLite (separate from the existing `heartbeat_runs` table)
- [ ] Allow agents to be triggered by events, not only on a time schedule
- [ ] Expose event logs and trigger history in the UI
- [ ] Support at minimum: polling-based web triggers, keyword detection triggers

**Current state:** Only heartbeat polling is implemented. There is no generic event system; `heartbeat_runs` is the only non-schedule trigger table in the schema.

---

### 6. Hardening demo agents to satisfy all live demo constraints

**Status: ❌ Not fixed**

- [ ] Replace hardcoded trending topics in `agent_engine.py` with a real (or reliably-seeded) data source
- [ ] Ensure production-mode approval is **always** enforced before any public LinkedIn post or comment
- [ ] Make hashtag commenter run reliably every hour through the scheduler and confirm logs are visible in the UI
- [ ] Update Playwright selectors to be resilient to LinkedIn DOM changes (e.g. use `aria-label`, role selectors)
- [ ] Add end-to-end smoke tests (or documented manual test steps) for both demo agents

**Current state:** Trending topics return a hardcoded list; Playwright selectors are fragile; the hourly hashtag agent scheduler path is not fully verified; approval enforcement is inconsistent between sandbox and production modes.

---

### 7. Always-on floating assistant / overlay

**Status: ⚠️ Not fully fixed**

- [ ] Ensure the floating assistant FAB and mini-chat overlay are accessible from **every** tab/state within the app, including during long-running background operations
- [ ] Consider implementing a Tauri secondary window for a true OS-level overlay that persists above other apps
- [ ] Add a "mini mode" / compact view so the overlay is non-intrusive
- [ ] Verify the overlay does not get hidden behind modals or other UI layers

**Current state:** A floating 🤖 FAB exists within the app window. It is in-app only (not an OS-level overlay) and may be obscured by modals. Its visibility across all app states has not been fully verified.

---

### 8. Natural language → config → preview → deploy

**Status: ❌ Not fixed**

- [ ] Implement an "agent config generator" that turns a plain-English description into a structured config (role, goal, tools, schedule, event triggers, sandbox flag)
- [ ] Show the generated config as a formatted JSON/YAML preview inside chat before the user confirms
- [ ] Wire the approval step to actually persist and deploy the agent only after explicit user confirmation
- [ ] Support iterative refinement: user can say "change the schedule to every 6 hours" and the config updates in the preview
- [ ] Cover the full pipeline: intent → config → preview → approve → deploy → running agent

**Current state:** Agent creation uses a manual form modal (`AgentCreationModal`). A chat-based config-preview-approve flow does not exist.

---

### 9. Logs & observability completeness

**Status: ❌ Not fixed**

- [ ] Add an `approval_audit` table capturing: agent ID, content previewed, approver action, timestamp, execution outcome
- [ ] Capture and store OpenClaw CLI command stdout/stderr per run in a `openclaw_runs` table (or equivalent)
- [ ] UI: per-agent run history panel showing each run, its status, and full error/stack output on failure
- [ ] UI: scheduler runs panel showing fired schedules, next run times, and miss/skip events
- [ ] UI: approval audit log panel accessible from the agent detail view

**Current state:** SQLite tables exist for agents, schedules, logs, run history, LLM usage, and heartbeats. Approval audit trail, per-command OpenClaw logs, and failure stack traces in the UI are missing.

---

### 10. Documentation completeness

**Status: ❌ Not fixed**

- [ ] Add a README section showing the exact OpenClaw CLI commands the app runs and how each maps to a UI action
- [ ] Document the real model-switching implementation: which file/table stores the selection, how the Rust backend reads it, which model is called at runtime
- [ ] Add a demo video link (or animated GIF) to the README
- [ ] Add a submission checklist (resume link, contact email, deliverable list) per the original task brief
- [ ] Update the Quick-Start guide to reflect the current actual state (Ollama vs llama.cpp vs cloud key routing)

**Current state:** The README is detailed but does not prove end-to-end OpenClaw control. Model switching, demo evidence, and submission checklist items are undocumented.

---

## What IS Working

The items below are implemented and functional in the current codebase:

- ✅ Tauri desktop app scaffold with multi-tab UI
- ✅ Onboarding wizard (Ollama availability check + OpenClaw install step)
- ✅ Local LLM inference via Ollama (phi3 / llama3) + external LLM routing (OpenAI / Anthropic)
- ✅ SQLite persistence layer (agents, schedules, logs, run history, LLM usage, heartbeats)
- ✅ Background scheduler with 60-second poll loop
- ✅ Playwright-based LinkedIn automation engine (post + hashtag comment flows)
- ✅ Human-in-the-loop approval modal before posting
- ✅ Sandbox mode (all actions simulated, nothing posted publicly)
- ✅ Floating assistant FAB with in-app mini-chat overlay (partial)
- ✅ Two demo agents pre-configured (LinkedIn Trending Poster + #openclaw Hashtag Commenter)

---

## Priority / Blocking Order

```
[MVP BLOCKERS — must fix before any meaningful demo]
  1. OpenClaw-based agent creation/execution  (#2)
  2. Hardening demo agents for live demo      (#6)
  3. Chat-driven setup end-to-end             (#3)

[CORE REQUIREMENTS — needed for full spec compliance]
  4. True offline local LLM runtime          (#1)
  5. Cron scheduling                          (#4)
  6. Natural language → config → deploy       (#8)
  7. Logs & observability completeness        (#9)

[BONUS / POLISH]
  8. Generic event handler system             (#5)
  9. Always-on overlay (OS-level)             (#7)
 10. Documentation completeness              (#10)
```

---

*This audit was compiled against the `main` branch on 2026-03-20. Re-audit after each sprint to track closure of the above items.*
