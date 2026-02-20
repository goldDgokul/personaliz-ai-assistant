# 🤖 Personaliz AI Desktop Assistant

A desktop automation assistant powered by **local AI (Llama3)** + **Tauri** that makes **OpenClaw** automation accessible to non-technical users.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri)](https://tauri.app/)
[![Powered by Llama3](https://img.shields.io/badge/Powered%20by-Llama3-FF6B6B?logo=meta)](https://ollama.ai/)

---

## 📋 Table of Contents
- [Features](#-features)
- [Architecture](#-architecture)
- [LLM Integration](#-llm-integration)
- [Installation](#-installation)
- [Usage](#-usage)
- [Demo Agents](#-demo-agents)
- [How It Works](#-how-it-works)
- [Development](#-development)
- [Tech Stack](#-tech-stack)

---

## ✨ Features

### 🎯 Core Capabilities
- **✅ Chat-First Interface** - Natural language agent creation
- **✅ Local AI (Llama3)** - Runs entirely offline via Ollama
- **✅ External AI Support** - Switch to OpenAI GPT-4 or Anthropic Claude
- **✅ Automatic Model Switching** - Uses local AI by default, switches to API if key provided
- **✅ Agent Management** - Create, run, schedule, and delete automation agents
- **✅ Sandbox Mode** - Test automations safely before going live
- **✅ Human Approval Flow** - Review and edit content before posting
- **✅ LinkedIn Automation** - Post trending topics with browser automation
- **✅ Activity Logging** - Track all agent executions and errors
- **✅ Dark Theme UI** - Beautiful, responsive interface

### 🚀 What Makes This Special
- **No coding required** - Create agents by chatting
- **Works offline** - Local Llama3 model via Ollama
- **Safe testing** - Sandbox mode simulates actions
- **Human-in-the-loop** - Approve content before posting
- **OpenClaw wrapper** - Makes CLI automation accessible via GUI

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop Application                       │
│                        (Tauri)                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │             React Frontend (TypeScript)             │    │
│  │                                                      │    │
│  │  • Chat Interface                                   │    │
│  │  • Agent Creation Wizard (4 steps)                 │    │
│  │  • Approval Modal (Human-in-the-loop)              │    │
│  │  • Settings Panel                                   │    │
│  │  • Activity Logs                                    │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │      LLM Service Layer (TypeScript)                 │    │
│  │                                                      │    │
│  │  ┌─────────────────┐    ┌────────────────────┐    │    │
│  │  │  Local Llama3   │    │  External APIs     │    │    │
│  │  │  (Ollama)       │◄──►│  GPT-4 / Claude    │    │    │
│  │  │  localhost:11434│    │  (with API keys)   │    │    │
│  │  └─────────────────┘    └────────────────────┘    │    │
│  │           │                       │                 │    │
│  │           └───────────┬───────────┘                 │    │
│  │                       │                              │    │
│  │              Automatic Routing                      │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Tauri Backend (Rust)                        │    │
│  │                                                      │    │
│  │  • Tauri Commands (invoke handlers)                │    │
│  │  • OpenClaw CLI Wrapper                            │    │
│  │  • System Integration                              │    │
│  │  • Python Script Executor                          │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
           ┌───────────────────────────────┐
           │   Python Automation Scripts    │
           │                                │
           │  • agent_engine.py             │
           │  • openclaw_logic.py           │
           │  • LinkedIn automation         │
           │  • Browser control (Playwright)│
           └───────────────────────────────┘
                           │
                           ▼
           ┌───────────────────────────────┐
           │      LinkedIn / Web           │
           └───────────────────────────────┘
```

---

## 🧠 LLM Integration

### Architecture: Local-First with External Fallback

```typescript
// Automatic Model Routing Logic
if (user_has_api_key) {
    use_external_api_model()  // GPT-4, Claude
} else {
    use_local_llama3_model()  // Ollama
}
```

### Local LLM (Default)
**Model:** Llama3 via Ollama  
**Endpoint:** `http://localhost:11434/api/chat`  
**Benefits:**
- ✅ Runs completely offline
- ✅ No API costs
- ✅ Privacy-first
- ✅ Fast responses

**Implementation:** `src/App.tsx` - `callLocalLLM()` function

```typescript
const callLocalLLM = async (message: string): Promise<string> => {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
        { role: 'user', content: message }
      ],
      stream: false,
      temperature: 0.7
    })
  });
  return data.message?.content;
};
```

### External LLM (Optional)
**Supported Models:**
- OpenAI: GPT-4, GPT-3.5 Turbo
- Anthropic: Claude 3 Sonnet, Claude 3 Opus

**Implementation:** `src/App.tsx` - `callExternalLLM()` function

**How Switching Works:**
1. User enters API key in Settings
2. Key saved to `localStorage`
3. App automatically detects key presence
4. All future LLM calls route to external API
5. Remove key → switches back to local Llama3

**Model Selection:**
```tsx
<select onChange={(e) => localStorage.setItem('llm_model', e.target.value)}>
  <option value="gpt-4">GPT-4 (OpenAI)</option>
  <option value="claude-3-sonnet-20240229">Claude 3 Sonnet (Anthropic)</option>
</select>
```

### System Prompt
```
You are Personaliz, a helpful desktop assistant that helps users 
automate tasks with OpenClaw. You guide users step by step to:
1. Create automation agents
2. Set up OpenClaw
3. Schedule recurring tasks
4. Test agents in sandbox mode
```

---

## 📦 Installation

### Prerequisites
- **Node.js** (v18+)
- **Rust** (for Tauri)
- **Python 3.x** (for automation scripts)
- **Ollama** (for local LLM)

### Step 1: Install Ollama
```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download from https://ollama.ai/download

# Pull Llama3 model
ollama pull llama3

# Start Ollama server
ollama serve
```

### Step 2: Install Python Dependencies
```bash
pip install playwright
playwright install chromium
```

### Step 3: Clone & Install
```bash
git clone https://github.com/goldDgokul/personaliz-ai-assistant.git
cd personaliz-ai-assistant

npm install
```

### Step 4: Run Development Build
```bash
npm run tauri-dev
```

### Step 5: Build Production
```bash
npm run tauri-build
```

---

## 🎮 Usage

### First Launch - Onboarding
1. **Welcome Screen** - Introduction
2. **OS Detection** - Automatic system check
3. **Ollama Setup** - Guides you through local AI setup
4. **API Keys (Optional)** - Add OpenAI/Claude keys if desired
5. **Ready!** - Start creating agents

### Creating an Agent

**Via Chat:**
```
You: "Create an agent to post trending topics on LinkedIn daily"
```

**Via Wizard:**
1. Click "Create Agent" button
2. **Step 1:** Name & Role
3. **Step 2:** Goal definition
4. **Step 3:** Select tools (LinkedIn, Twitter, etc.)
5. **Step 4:** Set schedule (Once, Hourly, Daily, Weekly)
6. Review & Create

### Running an Agent

**Sandbox Mode (Safe Testing):**
1. Toggle "Sandbox Mode" ON in Settings
2. Click "Run Agent" ▶️
3. Watch simulated execution in Logs
4. No actual actions performed

**Production Mode (Live Execution):**
1. Toggle "Sandbox Mode" OFF in Settings
2. Click "Run Agent" ▶️
3. Agent generates content
4. **Approval Modal appears** 👀
5. Review, edit if needed
6. Click "Approve & Execute" ✅
7. LinkedIn post published 🚀

---

## 🎯 Demo Agents

### Demo 1: LinkedIn Trending Agent

**What it does:**
- Searches for trending OpenClaw topics
- Generates a LinkedIn post
- Waits for user approval
- Posts via browser automation
- Runs on schedule (daily)

**How to demo:**
```
1. Create agent: "Trending LinkedIn Agent"
2. Role: "Content Creator"
3. Goal: "Post trending OpenClaw topics on LinkedIn daily"
4. Tools: LinkedIn, Web Search
5. Schedule: Daily
6. Run agent → Approve content → See live post
```

### Demo 2: Hashtag Comment Agent

**What it does:**
- Every 1 hour: searches LinkedIn for #openclaw
- Comments with promotional message
- Invites users to try the desktop app

**How to demo:**
```
1. Create agent: "Hashtag Promoter"
2. Role: "Community Engagement"
3. Goal: "Comment on #openclaw posts with app promotion"
4. Tools: LinkedIn
5. Schedule: Hourly
6. Run agent → Comments posted automatically
```

---

## ⚙️ How It Works

### Conversational OpenClaw Setup
**Traditional Way (CLI):**
```bash
openclaw init
openclaw config --channel linkedin
openclaw agent create --role "..."
```

**Personaliz Way (Chat):**
```
User: "Setup OpenClaw"
App: [runs commands silently in background]
     ✅ Detected macOS
     ✅ Checking dependencies...
     ✅ OpenClaw installed
     ✅ LinkedIn channel connected
```

### Agent Execution Flow
```
1. User clicks "Run Agent"
   │
   ├─ [Sandbox Mode]
   │   └─ Simulate actions → Show preview → Log results
   │
   └─ [Production Mode]
       └─ Generate content
           └─ Show Approval Modal
               ├─ User cancels → Stop
               ├─ User edits → Update content
               └─ User approves
                   └─ Execute Python script
                       └─ Browser automation (Playwright)
                           └─ LinkedIn post published ✅
```

### Scheduling (Not yet implemented)
```python
# Future: Background scheduler
schedule.every().day.at("09:00").do(run_agent)
schedule.every().hour.do(check_hashtag_agent)
```

### Sandbox Mode Logic
```typescript
if (sandboxMode) {
    // Simulate execution
    log('🔍 [SANDBOX] Searching...')
    log('✍️ [SANDBOX] Generating...')
    log('👀 [SANDBOX] Preview: ...')
    log('✅ [SANDBOX] Complete (no posting)')
} else {
    // Real execution
    generateContent()
    awaitApproval()
    postToLinkedIn()
}
```

---

## 🛠️ Development

### Project Structure
```
personaliz-ai-assistant/
├── src/                        # React frontend
│   ├── App.tsx                 # Main application
│   ├── App.css                 # Styles
│   ├── components/
│   │   ├── AgentCreationModal.tsx
│   │   ├── ApprovalModal.tsx   # Human approval flow
│   │   └── Onboarding.tsx
│   └── services/
│       ├── ollamaService.ts    # Local LLM
│       └── openClawService.ts  # OpenClaw wrapper
│
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   └── main.rs            # Tauri commands
│   ├── openclaw_logic.py      # Browser automation
│   └── Cargo.toml
│
├── public/
│   └── agent_engine.py        # Agent execution engine
│
├── README.md                  # This file
└── package.json
```

### Key Files

**`src/App.tsx`** - Main application logic
- Chat interface
- Agent management
- LLM integration
- Approval flow

**`src-tauri/src/main.rs`** - Rust backend
```rust
#[tauri::command]
fn check_ollama_status() -> bool { ... }

#[tauri::command]
fn post_to_linkedin(content: String, sandbox: bool) -> Result<String, String> { ... }

#[tauri::command]
fn execute_agent(...) -> Result<String, String> { ... }
```

**`public/agent_engine.py`** - Python automation
```python
class AgentEngine:
    def run_linkedin_trending_agent(self):
        topics = self.search_trending_topics()
        posts = self.generate_linkedin_posts(topics)
        self.request_approval(posts[0])
        self.post_to_linkedin_browser(posts[0])
```

### Adding a New Tauri Command
```rust
// src-tauri/src/main.rs
#[tauri::command]
fn my_new_command(param: String) -> Result<String, String> {
    Ok(format!("Received: {}", param))
}

// In main()
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        my_new_command  // Add here
    ])
```

```typescript
// src/App.tsx
import { invoke } from '@tauri-apps/api/core';

const result = await invoke<string>('my_new_command', { param: 'value' });
```

---

## 🧪 Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Desktop Framework** | Tauri | Cross-platform desktop app |
| **Frontend** | React + TypeScript | UI components |
| **Backend** | Rust | System integration |
| **Local LLM** | Llama3 (Ollama) | Offline AI chat |
| **External LLM** | OpenAI / Anthropic | Optional cloud AI |
| **Automation** | Python + Playwright | Browser control |
| **OpenClaw** | CLI wrapper | Automation framework |
| **Storage** | localStorage | Agent configs & logs |
| **Styling** | CSS (Custom) | Dark theme |

---

## 📝 Configuration

### LLM Settings
**Location:** Settings → LLM Settings

```typescript
// LocalStorage keys
localStorage.setItem('llm_api_key', 'sk-...')      // OpenAI/Claude key
localStorage.setItem('llm_model', 'gpt-4')         // Model selection
localStorage.setItem('setup_completed', 'true')    // Onboarding status
```

### Sandbox Mode
**Location:** Settings → Sandbox Mode

```typescript
// Toggle
const [sandboxMode, setSandboxMode] = useState(true)

// Behavior
if (sandboxMode) {
    // Safe simulation
} else {
    // Real execution + approval
}
```

---

## 🎥 Demo Video

**Recording Checklist:**
1. ✅ Show onboarding flow
2. ✅ Ollama connection check
3. ✅ Create agent via chat
4. ✅ Run in sandbox mode
5. ✅ Switch to production
6. ✅ Show approval modal
7. ✅ Edit content
8. ✅ Approve & post
9. ✅ Show live LinkedIn post
10. ✅ Check activity logs

---

## 🚀 Roadmap

### ✅ Completed
- [x] Tauri desktop app
- [x] Local Llama3 integration
- [x] External API switching
- [x] Chat interface
- [x] Agent creation wizard
- [x] Sandbox mode
- [x] Approval flow
- [x] LinkedIn automation
- [x] Activity logging

### 🚧 In Progress
- [ ] Real OpenClaw CLI integration
- [ ] Background scheduler (cron jobs)
- [ ] Event handlers (polling)

### 📋 Planned
- [ ] Twitter automation
- [ ] Email automation
- [ ] Slack integration
- [ ] Multi-agent coordination
- [ ] Analytics dashboard

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

## 🙏 Acknowledgments

- **OpenClaw** - Open-source automation framework
- **Ollama** - Local LLM runtime
- **Tauri** - Desktop app framework
- **Playwright** - Browser automation

---

## 📧 Contact

**Submission for:** Personaliz.ai Coding Task  
**Developer:** Gokul  
**Email:** santosh@personaliz.ai

---

**Built with ❤️ using Tauri + React + Llama3**
