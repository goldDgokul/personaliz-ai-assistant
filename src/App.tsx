import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import AgentCreationModal from './components/AgentCreationModal';
import { ApprovalModal } from './components/ApprovalModal';
import Onboarding from './components/Onboarding';
import './App.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agent {
  id: string;
  name: string;
  role: string;
  goal: string;
  tools: string[];
  schedule: string;
  status: 'idle' | 'running' | 'completed' | 'awaiting-approval';
  agentType?: 'trending' | 'hashtag' | 'custom';
}

/** Shape returned by the `db_list_agents` Tauri command */
interface DbAgentRow {
  id: string;
  name: string;
  role: string;
  goal: string;
  tools: string;
  status: string;
  created_at: string;
}

interface LogEntry {
  timestamp: string;
  agentId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface RunHistoryEntry {
  id: number;
  agentId: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  result?: string;
}

interface HeartbeatRow {
  id: string;
  agent_id: string;
  interval_min: number;
  enabled: boolean;
  last_check: string | null;
  created_at: string;
}

interface HeartbeatRunRow {
  id: number;
  agent_id: string;
  checked_at: string;
  status: string;
  message: string | null;
}

interface LlmUsageRow {
  id: number;
  provider: string;
  model: string;
  context: string;
  timestamp: string;
}

interface ApprovalRow {
  id: number;
  agent_id: string;
  content_preview: string;
  outcome: string;
  decided_at: string;
  notes: string | null;
}

interface EventTriggerRow {
  id: string;
  agent_id: string;
  trigger_type: string;
  target_url: string;
  keyword: string | null;
  check_interval_min: number;
  enabled: boolean;
  last_checked: string | null;
  created_at: string;
}

interface EventHistoryRow {
  id: number;
  trigger_id: string;
  agent_id: string;
  fired_at: string;
  matched_content: string | null;
  status: string;
}

interface OpenClawRunRow {
  id: number;
  agent_id: string;
  config_path: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [sandboxMode, setSandboxMode] = useState(true);
  const [ollamaStatus, setOllamaStatus] = useState('disconnected');
  const [useExternalLLM, setUseExternalLLM] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localModel, setLocalModel] = useState('llama3');
  const [heartbeats, setHeartbeats] = useState<HeartbeatRow[]>([]);
  const [heartbeatRuns, setHeartbeatRuns] = useState<HeartbeatRunRow[]>([]);
  const [llmUsage, setLlmUsage] = useState<LlmUsageRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [pendingAgentConfigPreview, setPendingAgentConfigPreview] = useState<{
    name: string; role: string; goal: string; tools: string[]; schedule: string; sandbox: boolean;
  } | null>(null);
  const [eventTriggers, setEventTriggers] = useState<EventTriggerRow[]>([]);
  const [eventHistory, setEventHistory] = useState<EventHistoryRow[]>([]);
  const [openClawRuns, setOpenClawRuns] = useState<OpenClawRunRow[]>([]);

  // Event trigger creation form state
  const [showEventTriggerForm, setShowEventTriggerForm] = useState(false);
  const [newTriggerAgentId, setNewTriggerAgentId] = useState('');
  const [newTriggerType, setNewTriggerType] = useState('keyword_found');
  const [newTriggerUrl, setNewTriggerUrl] = useState('');
  const [newTriggerKeyword, setNewTriggerKeyword] = useState('');
  const [newTriggerInterval, setNewTriggerInterval] = useState(60);

  // Floating mini-chat overlay (visible on any tab)
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const [floatingInput, setFloatingInput] = useState('');
  const floatingMessagesEndRef = useRef<HTMLDivElement>(null);

  // Floating assistant icon state (legacy toggle, kept for backward compat)
  const [isChatOpen, setIsChatOpen] = useState(true);

  // Approval modal
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingContent, setPendingContent] = useState('');
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  useEffect(() => {
    const setupDone = localStorage.getItem('setup_completed');
    if (!setupDone) {
      setIsOnboarding(true);
    } else {
      checkOllamaConnection();
      checkExternalLLM();
      setLocalModel(localStorage.getItem('local_model') || 'llama3');
      loadPersistedData();
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  const loadPersistedData = async () => {
    try {
      const dbAgents = await invoke<DbAgentRow[]>('db_list_agents');
      if (dbAgents.length > 0) {
        const mapped: Agent[] = dbAgents.map(a => ({
          id: a.id,
          name: a.name,
          role: a.role,
          goal: a.goal,
          tools: a.tools ? a.tools.split(',').filter(Boolean) : [],
          schedule: 'Daily',
          status: (a.status as Agent['status']) || 'idle',
          agentType: detectAgentType(a.name, a.goal),
        }));
        setAgents(mapped);
      }
    } catch (_) {
      // DB not available (dev mode without Tauri)
    }

    try {
      const dbLogs = await invoke<any[]>('db_get_logs', { limit: 200 });
      const mapped: LogEntry[] = dbLogs.map(l => ({
        timestamp: l.timestamp,
        agentId: l.agent_id,
        level: l.level as LogEntry['level'],
        message: l.message,
      }));
      setLogs(mapped);
    } catch (_) {}

    try {
      const hist = await invoke<any[]>('db_get_run_history', { limit: 100 });
      const mapped: RunHistoryEntry[] = hist.map(r => ({
        id: r.id,
        agentId: r.agent_id,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        status: r.status,
        result: r.result,
      }));
      setRunHistory(mapped);
    } catch (_) {}

    try {
      const hbs = await invoke<HeartbeatRow[]>('db_list_heartbeats');
      setHeartbeats(hbs);
    } catch (_) {}

    try {
      const hbRuns = await invoke<HeartbeatRunRow[]>('db_get_heartbeat_runs', { limit: 50 });
      setHeartbeatRuns(hbRuns);
    } catch (_) {}

    try {
      const usage = await invoke<LlmUsageRow[]>('db_get_llm_usage', { limit: 50 });
      setLlmUsage(usage);
    } catch (_) {}

    try {
      const approvs = await invoke<ApprovalRow[]>('db_list_approvals', { limit: 100 });
      setApprovals(approvs);
    } catch (_) {}

    try {
      const triggers = await invoke<EventTriggerRow[]>('db_list_event_triggers');
      setEventTriggers(triggers);
    } catch (_) {}

    try {
      const evtHist = await invoke<EventHistoryRow[]>('db_get_event_history', { limit: 50 });
      setEventHistory(evtHist);
    } catch (_) {}

    try {
      const oclRuns = await invoke<OpenClawRunRow[]>('db_get_openclaw_runs', { limit: 50 });
      setOpenClawRuns(oclRuns);
    } catch (_) {}
  };

  const detectAgentType = (name: string, goal: string): 'trending' | 'hashtag' | 'custom' => {
    const combined = (name + ' ' + goal).toLowerCase();
    if (combined.includes('hashtag') || combined.includes('comment')) return 'hashtag';
    if (combined.includes('trending') || combined.includes('linkedin post')) return 'trending';
    return 'custom';
  };

  const persistAgent = async (agent: Agent) => {
    try {
      await invoke('db_upsert_agent', {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        goal: agent.goal,
        tools: agent.tools.join(','),
        status: agent.status,
      });
    } catch (_) {}
  };

  const persistLog = async (entry: LogEntry) => {
    try {
      await invoke('db_append_log', {
        agentId: entry.agentId,
        level: entry.level,
        message: entry.message,
      });
    } catch (_) {}
  };

  // -------------------------------------------------------------------------
  // LLM
  // -------------------------------------------------------------------------

  const checkExternalLLM = () => {
    const apiKey = localStorage.getItem('llm_api_key');
    setUseExternalLLM(!!apiKey);
  };

  const checkOllamaConnection = async () => {
    try {
      try {
        const status = await invoke<boolean>('check_ollama_status');
        if (status) { setOllamaStatus('connected'); return; }
      } catch (_) {}

      const response = await fetch('http://localhost:11434/api/tags');
      setOllamaStatus(response.ok ? 'connected' : 'disconnected');
    } catch {
      setOllamaStatus('disconnected');
    }
  };

  const callLocalLLM = async (message: string): Promise<string> => {
    const model = localStorage.getItem('local_model') || 'llama3';
    const systemPrompt = `You are Personaliz, a helpful desktop assistant that helps users automate tasks with OpenClaw.
You are friendly, conversational, and guide users step by step.
Keep responses concise (2-3 sentences max).`;

    try {
      // Try Tauri command first (passes model name, logs usage to SQLite)
      const reply = await invoke<string>('send_message_to_llm', {
        message,
        history: messages.map(m => ({ role: m.role, content: m.content })),
        model,
        context: 'chat',
      });
      return reply;
    } catch (_) {
      // Fallback to direct HTTP (dev mode without Tauri)
    }

    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message },
        ],
        stream: false,
        temperature: 0.7,
      }),
    });

    if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
    const data = await response.json();
    return data.message?.content || 'No response from model.';
  };

  const callExternalLLM = async (message: string, apiKey: string, model: string): Promise<string> => {
    try {
      // Route through Tauri backend which logs usage to SQLite
      const reply = await invoke<string>('send_message_to_external_llm', {
        req: {
          message,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          api_key: apiKey,
          model,
          context: 'chat',
        },
      });
      return reply;
    } catch (_) {
      // Fallback to direct HTTP if Tauri is not available (dev mode)
    }

    const systemPrompt = `You are Personaliz, a helpful desktop assistant for OpenClaw automation. Keep responses concise.`;
    const isGoogle = model.startsWith('gemini') || model.startsWith('gemma');
    if (model.includes('claude')) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API error: ${response.status}. Make sure you are using an Anthropic key (sk-ant-…).`);
      const data = await response.json();
      return data.content?.[0]?.text || 'No response.';
    }

    if (isGoogle) {
      // Google Generative Language API (Gemini / Gemma via Google AI Studio)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const contents = [
        ...messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: message }] },
      ];
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
        }),
      });
      if (!response.ok) {
        const hint = response.status === 401 || response.status === 403
          ? ' Make sure you are using a Google AI Studio key (AIzaSy…).'
          : response.status === 400
          ? ' Check that the model name is correct (e.g. gemini-2.0-flash).'
          : '';
        throw new Error(`Google AI API error: ${response.status}.${hint}`);
      }
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
    }

    // OpenAI-compatible
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });
    if (!response.ok) {
      const hint = response.status === 401
        ? ' Make sure you are using an OpenAI key (sk-…). For Google Gemini/Gemma, select a Gemini model and use your Google AI Studio key (AIzaSy…).'
        : '';
      throw new Error(`OpenAI API error: ${response.status}.${hint}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response.';
  };

  const handleSendMessage = async (overrideMessage?: string) => {
    const userMessage = overrideMessage ?? inputValue;
    if (!userMessage.trim()) return;
    if (!overrideMessage) setInputValue('');
    setIsLoading(true);

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    addLog('chat', 'info', `User: ${userMessage}`);

    try {
      const externalKey = localStorage.getItem('llm_api_key');
      const llmModel = localStorage.getItem('llm_model') || 'gpt-4';

      let response: string;
      if (externalKey?.trim()) {
        response = await callExternalLLM(userMessage, externalKey, llmModel);
        setUseExternalLLM(true);
        addLog('chat', 'info', `LLM: external (${llmModel})`);
      } else {
        response = await callLocalLLM(userMessage);
        setUseExternalLLM(false);
        addLog('chat', 'info', `LLM: local Ollama (${localStorage.getItem('local_model') || 'llama3'})`);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);

      const lower = userMessage.toLowerCase();

      // Chat-driven onboarding (issue #20)
      if (lower === 'setup' || lower === '/setup' || lower.includes('help me set up')) {
        // Detect what's available via Tauri commands
        let nodeStat = '…';
        let pythonStat = '…';
        let playwrightStat = '…';
        let openclawStat = '…';
        try { nodeStat = (await invoke<boolean>('check_node_available')) ? '✅ Installed' : '❌ Missing'; } catch (_) { nodeStat = '⚠️ Unknown'; }
        try { pythonStat = (await invoke<boolean>('check_python_available')) ? '✅ Installed' : '❌ Missing'; } catch (_) { pythonStat = '⚠️ Unknown'; }
        try { playwrightStat = (await invoke<boolean>('check_playwright_available')) ? '✅ Installed' : '❌ Missing'; } catch (_) { playwrightStat = '⚠️ Unknown'; }
        try { openclawStat = (await invoke<boolean>('check_openclaw_installed')) ? '✅ Installed' : '❌ Missing'; } catch (_) { openclawStat = '⚠️ Unknown'; }
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🔍 **Dependency Scan**\n\n| Dependency | Status |\n|---|---|\n| Node.js | ${nodeStat} |\n| Python | ${pythonStat} |\n| Playwright | ${playwrightStat} |\n| OpenClaw CLI | ${openclawStat} |\n\n**Next steps:**\n- If Node.js is missing: download from [nodejs.org](https://nodejs.org) and re-open the app\n- OpenClaw missing? Type **"install openclaw"** and I'll run it for you\n- For AI inference locally, run \`ollama pull phi3\` or set an API key in ⚙️ Settings\n- Type **"add demo agents"** to add the pre-built LinkedIn agents\n\nType **"install openclaw"** to install it now!`,
        }]);
        setIsLoading(false);
        return;
      }

      // Install OpenClaw via chat
      if (lower === 'install openclaw' || lower.includes('install openclaw')) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⏳ Running `npm install -g openclaw`… This may take a minute.',
        }]);
        try {
          const result = await invoke<string>('run_openclaw_command', { command: 'install' });
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ OpenClaw installed!\n\n\`\`\`\n${result}\n\`\`\`\n\nYou're ready to go! Type **"add demo agents"** to get started.`,
          }]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `❌ Install failed: ${msg}\n\nTry manually: \`npm install -g openclaw\``,
          }]);
        }
        setIsLoading(false);
        return;
      }

      // Agent creation via chat with config preview (issue #19)
      if (lower.includes('create agent') || lower.includes('new agent') ||
          lower.includes('linkedin') || lower.includes('trending') ||
          lower.includes('make an agent') || lower.includes('build an agent')) {
        // Infer agent name/role/goal/schedule from user message
        const nameHint = lower.includes('hashtag') ? '#openclaw Hashtag Commenter' :
                         lower.includes('linkedin') ? 'LinkedIn Content Agent' :
                         lower.includes('trending') ? 'Trending Poster' : 'Custom Agent';
        const roleHint = lower.includes('comment') ? 'LinkedIn Engagement Specialist' :
                         lower.includes('post') || lower.includes('trending') ? 'LinkedIn Content Creator' :
                         'Automation Agent';
        const goalHint = lower.includes('comment') || lower.includes('hashtag')
          ? 'Search LinkedIn for #openclaw posts and leave a promotional comment.'
          : lower.includes('post') || lower.includes('trending')
          ? 'Find trending OpenClaw topics, generate a LinkedIn post, get approval, then publish.'
          : 'Automate a task based on user instructions.';
        const scheduleHint = lower.includes('hour') ? 'Hourly' :
                             lower.includes('week') ? 'Weekly' : 'Daily';
        const toolsHint = (lower.includes('linkedin') || lower.includes('post') || lower.includes('comment'))
          ? ['LinkedIn', 'Browser'] : [];

        const previewConfig = {
          name: nameHint,
          role: roleHint,
          goal: goalHint,
          tools: toolsHint,
          schedule: scheduleHint,
          sandbox: true,
        };

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🔧 Here's the agent config I'll create based on your request:\n\n\`\`\`json\n${JSON.stringify(previewConfig, null, 2)}\n\`\`\`\n\nType **"confirm"** to deploy this agent, or **"edit agent"** to customise it in the creation wizard.`,
        }]);

        // Store pending config for confirmation
        setPendingAgentConfigPreview(previewConfig);
        setIsLoading(false);
        return;
      }

      // Confirm deployment of NL-generated agent config
      if (lower === 'confirm' || lower === 'yes' || lower === 'deploy') {
        if (pendingAgentConfigPreview) {
          const pending = pendingAgentConfigPreview;
          setPendingAgentConfigPreview(null);
          createAgent(pending);
          setIsLoading(false);
          return;
        }
      }

      // Edit pending agent config in modal
      if (lower === 'edit agent' || lower === 'edit') {
        setPendingAgentConfigPreview(null);
        setTimeout(() => setShowAgentModal(true), 300);
        setIsLoading(false);
        return;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog('chat', 'error', `LLM Error: ${msg}`);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${msg}\n\n**Troubleshooting tips:**\n- Using a **Google key (AIzaSy…)**? Make sure you selected a Gemini or Gemma model in ⚙️ Settings → External Model.\n- Using an **OpenAI key (sk-…)**? Select a GPT model in Settings.\n- Using an **Anthropic key (sk-ant-…)**? Select a Claude model.\n- No key set? Make sure Ollama is running: \`ollama serve\``,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  const addLog = (agentId: string, level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      level,
      message,
    };
    setLogs(prev => [entry, ...prev].slice(0, 200));
    persistLog(entry);
  };

  // -------------------------------------------------------------------------
  // Agents – CRUD
  // -------------------------------------------------------------------------

  const createAgent = (agentData: any) => {
    const newAgent: Agent = {
      id: `agent_${Date.now()}`,
      name: agentData.name,
      role: agentData.role,
      goal: agentData.goal,
      tools: agentData.tools || [],
      schedule: agentData.schedule || 'Daily',
      status: 'idle',
      agentType: detectAgentType(agentData.name, agentData.goal),
    };
    setAgents(prev => [...prev, newAgent]);
    persistAgent(newAgent);
    addLog(newAgent.id, 'success', `Agent "${newAgent.name}" created`);

    // Generate OpenClaw config file (issues #19 + #21)
    const rawCron = agentData.cronExpression?.trim();
    const cronExpr: string | undefined = rawCron || undefined;
    invoke('create_openclaw_config', {
      agentId: newAgent.id,
      agentName: newAgent.name,
      role: newAgent.role,
      goal: newAgent.goal,
      tools: newAgent.tools,
      schedule: cronExpr ?? newAgent.schedule,
      outputDir: null,
    }).then((p) => {
      addLog(newAgent.id, 'info', `OpenClaw config written: ${p}`);
    }).catch(() => {});

    // Schedule in DB (issue #18)
    invoke('db_upsert_schedule', {
      agentId: newAgent.id,
      frequency: newAgent.schedule.toLowerCase(),
      enabled: true,
      cronExpression: cronExpr ?? null,
    }).catch(() => {});

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Created agent "${newAgent.name}"!\n\nRole: ${newAgent.role}\nGoal: ${newAgent.goal}\nSchedule: ${agentData.schedule ?? newAgent.schedule}${cronExpr ? ` (cron: ${cronExpr})` : ''}\n\nHead to the Agents tab to run it!`,
    }]);
    setShowAgentModal(false);
  };

  /** Add the two demo agents instantly */
  const addDemoAgents = async () => {
    const now = Date.now();

    const trendingAgent: Agent = {
      id: `agent_trending_${now}`,
      name: 'LinkedIn Trending Poster',
      role: 'LinkedIn Content Creator',
      goal: 'Find trending OpenClaw topics, generate a LinkedIn post, get approval, then publish.',
      tools: ['LinkedIn', 'Browser'],
      schedule: 'Daily',
      status: 'idle',
      agentType: 'trending',
    };

    const hashtagAgent: Agent = {
      id: `agent_hashtag_${now + 1}`,
      name: '#openclaw Hashtag Commenter',
      role: 'LinkedIn Engagement Bot',
      goal: 'Search LinkedIn for #openclaw posts and leave a promotional comment.',
      tools: ['LinkedIn', 'Browser'],
      schedule: 'Hourly',
      status: 'idle',
      agentType: 'hashtag',
    };

    for (const a of [trendingAgent, hashtagAgent]) {
      setAgents(prev => {
        if (prev.find(x => x.agentType === a.agentType)) return prev;
        return [...prev, a];
      });
      await persistAgent(a);
      addLog(a.id, 'success', `Demo agent "${a.name}" created`);

      // Schedule in DB
      try {
        await invoke('db_upsert_schedule', {
          agentId: a.id,
          frequency: a.schedule.toLowerCase(),
          enabled: true,
          cronExpression: null,
        });
      } catch (_) {}
    }

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Two demo agents created!\n\n• **LinkedIn Trending Poster** (daily) – generates & posts trending content\n• **#openclaw Hashtag Commenter** (hourly) – comments on #openclaw posts\n\nRun them from the Agents tab. Enable Production mode in Settings to post for real (approval required).`,
    }]);
    setActiveTab('agents');
  };

  const deleteAgent = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    setAgents(prev => prev.filter(a => a.id !== agentId));
    addLog(agentId, 'info', `Agent "${agent?.name}" deleted`);
    try { await invoke('db_delete_agent', { id: agentId }); } catch (_) {}
  };

  // -------------------------------------------------------------------------
  // Event triggers CRUD
  // -------------------------------------------------------------------------

  const createEventTrigger = async () => {
    if (!newTriggerAgentId || !newTriggerUrl) return;
    if (!newTriggerUrl.startsWith('http://')) {
      addLog('system', 'error', 'Event trigger URL must start with http:// (TLS not supported in built-in poller)');
      return;
    }
    try {
      const id = await invoke<string>('db_upsert_event_trigger', {
        agentId: newTriggerAgentId,
        triggerType: newTriggerType,
        targetUrl: newTriggerUrl,
        keyword: newTriggerKeyword || null,
        checkIntervalMin: newTriggerInterval,
        enabled: true,
      });
      const newTrigger: EventTriggerRow = {
        id,
        agent_id: newTriggerAgentId,
        trigger_type: newTriggerType,
        target_url: newTriggerUrl,
        keyword: newTriggerKeyword || null,
        check_interval_min: newTriggerInterval,
        enabled: true,
        last_checked: null,
        created_at: new Date().toISOString(),
      };
      setEventTriggers(prev => [newTrigger, ...prev]);
      const agent = agents.find(a => a.id === newTriggerAgentId);
      addLog(newTriggerAgentId, 'success', `Event trigger created for "${agent?.name}" (${newTriggerType})`);
      setShowEventTriggerForm(false);
      setNewTriggerUrl('');
      setNewTriggerKeyword('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('system', 'error', `Failed to create event trigger: ${msg}`);
    }
  };

  const deleteEventTrigger = async (triggerId: string) => {
    try {
      await invoke('db_delete_event_trigger', { id: triggerId });
      setEventTriggers(prev => prev.filter(t => t.id !== triggerId));
      addLog('system', 'info', 'Event trigger deleted');
    } catch (_) {}
  };

  const refreshOpenClawRuns = async () => {
    try {
      const runs = await invoke<OpenClawRunRow[]>('db_get_openclaw_runs', { limit: 50 });
      setOpenClawRuns(runs);
    } catch (_) {}
  };

  // -------------------------------------------------------------------------
  // Run agent
  // -------------------------------------------------------------------------

  const runAgent = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const modeText = sandboxMode ? '[SANDBOX]' : '[PRODUCTION]';
    addLog(agentId, 'info', `🚀 Running ${agent.name} ${modeText}…`);
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'running' } : a));

    // Record run start
    const runStarted = new Date().toISOString();
    try { await invoke('db_start_run', { agentId, startedAt: runStarted }); } catch (_) {}

    try {
      if (agent.agentType === 'hashtag') {
        await runHashtagAgent(agent);
        return;
      }

      // Trending / custom agent – try OpenClaw first, then fall back to Python
      addLog(agentId, 'info', '🔍 Searching trending topics…');
      await delay(800);
      addLog(agentId, 'info', '✍️ Generating LinkedIn post…');
      await delay(800);

      const generatedContent = buildTrendingPost();

      // Try to run via OpenClaw config if a config file was previously generated
      let openClawResult: any = null;
      try {
        const configPath = await invoke<string>('create_openclaw_config', {
          agentId,
          agentName: agent.name,
          role: agent.role,
          goal: agent.goal,
          tools: agent.tools,
          schedule: agent.schedule,
          outputDir: null,
        });
        addLog(agentId, 'info', `📄 OpenClaw config: ${configPath}`);
        openClawResult = await invoke<any>('run_openclaw_agent', { agentId, configPath });
        addLog(agentId, openClawResult.status === 'success' ? 'success' : 'warning',
          `[OpenClaw] exit=${openClawResult.exit_code ?? '?'} ${(openClawResult.stdout || openClawResult.stderr || '').slice(0, 200)}`);
        // Refresh openclaw runs panel
        await refreshOpenClawRuns();
      } catch (_) {
        // OpenClaw not installed or failed – continue with Python fallback
      }

      if (!sandboxMode) {
        addLog(agentId, 'info', '👀 Awaiting user approval…');
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'awaiting-approval' } : a));
        setPendingContent(generatedContent);
        setPendingAgentId(agentId);
        setShowApprovalModal(true);
        return;
      }

      // Sandbox: simulate
      addLog(agentId, 'info', `[SANDBOX] Preview:\n${generatedContent.slice(0, 120)}…`);
      addLog(agentId, 'success', '✅ Sandbox execution complete (nothing posted)');
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'completed' } : a));
      await invoke('db_update_agent_status', { id: agentId, status: 'completed' }).catch(() => {});

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **${agent.name}** finished in sandbox mode!\n\nGenerated:\n"${generatedContent.slice(0, 150)}…"\n\n${openClawResult ? '🔧 OpenClaw config was executed.\n\n' : ''}Disable Sandbox mode in Settings to post for real.`,
      }]);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(agentId, 'error', `❌ Agent failed: ${msg}`);
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'idle' } : a));
    }
  };

  const runHashtagAgent = async (agent: Agent) => {
    const agentId = agent.id;
    const defaultComment =
      '🎯 Check out Personaliz – it makes OpenClaw automation accessible to everyone, no coding needed! ' +
      'https://github.com/goldDgokul/personaliz-ai-assistant #OpenClaw #Automation';

    addLog(agentId, 'info', '🔍 Searching LinkedIn for #openclaw posts…');
    await delay(600);

    try {
      const result = await invoke<any>('comment_linkedin_hashtag', {
        hashtag: 'openclaw',
        comment: defaultComment,
        sandbox: sandboxMode,
      });

      const commented = result?.comments_posted ?? 0;
      addLog(agentId, 'success', `✅ Commented on ${commented} posts`);
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'completed' } : a));
      await invoke('db_update_agent_status', { id: agentId, status: 'completed' }).catch(() => {});

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **${agent.name}** finished!\n\nCommented on ${commented} #openclaw post(s)${sandboxMode ? ' (sandbox – nothing was posted)' : ''}.`,
      }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(agentId, 'error', `❌ Hashtag agent failed: ${msg}`);
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'idle' } : a));
    }
  };

  // -------------------------------------------------------------------------
  // Approval modal
  // -------------------------------------------------------------------------

  const handleApprove = async () => {
    if (!pendingAgentId || !pendingContent) return;
    const agent = agents.find(a => a.id === pendingAgentId);
    if (!agent) return;

    setShowApprovalModal(false);
    addLog(pendingAgentId, 'success', '✅ Content approved by user');
    setAgents(prev => prev.map(a => a.id === pendingAgentId ? { ...a, status: 'running' } : a));

    // Refresh approvals after the modal records it
    setTimeout(async () => {
      try {
        const approvs = await invoke<ApprovalRow[]>('db_list_approvals', { limit: 100 });
        setApprovals(approvs);
      } catch (_) {}
    }, 300);

    try {
      addLog(pendingAgentId, 'info', '🌐 Launching LinkedIn automation…');
      const result = await invoke<string>('post_to_linkedin', {
        content: pendingContent,
        sandbox: false,
      });

      addLog(pendingAgentId, 'success', `✅ Posted to LinkedIn`);
      setAgents(prev => prev.map(a => a.id === pendingAgentId ? { ...a, status: 'completed' } : a));
      await invoke('db_update_agent_status', { id: pendingAgentId, status: 'completed' }).catch(() => {});

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Posted to LinkedIn!\n\n"${pendingContent.slice(0, 120)}…"\n\nCheck your LinkedIn feed.`,
      }]);
      addLog(pendingAgentId, 'info', result || '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(pendingAgentId, 'error', `❌ LinkedIn posting failed: ${msg}`);
      setAgents(prev => prev.map(a => a.id === pendingAgentId ? { ...a, status: 'idle' } : a));
    } finally {
      setPendingContent('');
      setPendingAgentId(null);
    }
  };

  const handleCancel = () => {
    if (pendingAgentId) {
      addLog(pendingAgentId, 'warning', '⚠️ Cancelled by user');
      setAgents(prev => prev.map(a => a.id === pendingAgentId ? { ...a, status: 'idle' } : a));
    }
    setShowApprovalModal(false);
    setPendingContent('');
    setPendingAgentId(null);
    // Refresh approvals
    setTimeout(async () => {
      try {
        const approvs = await invoke<ApprovalRow[]>('db_list_approvals', { limit: 100 });
        setApprovals(approvs);
      } catch (_) {}
    }, 300);
  };

  // -------------------------------------------------------------------------
  // Heartbeats
  // -------------------------------------------------------------------------

  const enableHeartbeat = async (agentId: string, intervalMin: number = 60) => {
    try {
      const id = await invoke<string>('db_upsert_heartbeat', {
        agentId,
        intervalMin,
        enabled: true,
      });
      const newHb: HeartbeatRow = {
        id,
        agent_id: agentId,
        interval_min: intervalMin,
        enabled: true,
        last_check: null,
        created_at: new Date().toISOString(),
      };
      setHeartbeats(prev => [...prev.filter(h => h.agent_id !== agentId), newHb]);
      const agent = agents.find(a => a.id === agentId);
      addLog(agentId, 'success', `💓 Heartbeat enabled for "${agent?.name}" every ${intervalMin} min`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(agentId, 'error', `❌ Failed to enable heartbeat: ${msg}`);
    }
  };

  const disableHeartbeat = async (heartbeatId: string, agentId: string) => {
    try {
      await invoke('db_delete_heartbeat', { id: heartbeatId });
      setHeartbeats(prev => prev.filter(h => h.id !== heartbeatId));
      const agent = agents.find(a => a.id === agentId);
      addLog(agentId, 'info', `💔 Heartbeat disabled for "${agent?.name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(agentId, 'error', `❌ Failed to disable heartbeat: ${msg}`);
    }
  };

  const refreshHeartbeatRuns = async () => {
    try {
      const runs = await invoke<HeartbeatRunRow[]>('db_get_heartbeat_runs', { limit: 50 });
      setHeartbeatRuns(runs);
    } catch (_) {}
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  const buildTrendingPost = () =>
    `🚀 Just discovered something amazing: How OpenClaw is revolutionising RPA automation

OpenClaw makes automation accessible to everyone – no coding required! 💡

With the new Personaliz Desktop Assistant you can:
✅ Create agents by chatting
✅ Automate LinkedIn posts & comments
✅ Test in sandbox mode before going live
✅ Get human approval before every post

Perfect for non-technical users who want to automate their workflows!

#OpenClaw #Automation #NoCode #RPA #AI`;

  /** Format an ISO 8601 timestamp to 'YYYY-MM-DD HH:MM:SS' for display. */
  const fmtTs = (ts: string) => ts.slice(0, 19).replace('T', ' ');

  // -------------------------------------------------------------------------
  // Onboarding
  // -------------------------------------------------------------------------

  if (isOnboarding) {
    return (
      <Onboarding onComplete={() => {
        localStorage.setItem('setup_completed', 'true');
        setIsOnboarding(false);
        checkOllamaConnection();
        checkExternalLLM();
        setLocalModel(localStorage.getItem('local_model') || 'llama3');
        loadPersistedData();
      }} />
    );
  }

  // -------------------------------------------------------------------------
  // Main UI
  // -------------------------------------------------------------------------

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo">🤖 Personaliz</div>
        <nav className="nav-tabs">
          {[
            { id: 'chat', label: '💬 Chat' },
            { id: 'agents', label: `🤖 Agents (${agents.length})` },
            { id: 'events', label: `⚡ Events (${eventTriggers.length})` },
            { id: 'logs', label: '📊 Logs' },
            { id: 'settings', label: '⚙️ Settings' },
          ].map(tab => (
            <button
              key={tab.id}
              className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-badge" title={`Ollama: ${ollamaStatus}`}>
            <span className={`status-dot ${ollamaStatus === 'connected' ? 'connected' : 'disconnected'}`} />
            {ollamaStatus === 'connected' ? `${localModel} Ready` : 'Offline Mode'}
          </div>
          {useExternalLLM && (
            <div className="status-badge" title="Using external API">🔑 API Active</div>
          )}
          {sandboxMode && (
            <div className="status-badge" title="Sandbox mode – no real actions">🔒 Sandbox</div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="main-content">

        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div className="chat-container">
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <h2>👋 Welcome to Personaliz Assistant</h2>
                  <p>Try saying something like:</p>
                  <ul>
                    <li>"Create an agent to post on LinkedIn daily"</li>
                    <li>"What is OpenClaw?"</li>
                    <li>"Set up my automation agents"</li>
                    <li>"What is sandbox mode?"</li>
                  </ul>
                  <button
                    className="create-agent-btn"
                    style={{ marginTop: '16px' }}
                    onClick={addDemoAgents}
                  >
                    ⚡ Add Demo Agents
                  </button>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.role}`}>
                    <div className="message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
                    <div className="message-content">{msg.content}</div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="message assistant">
                  <div className="message-avatar">🤖</div>
                  <div className="message-content loading">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-area">
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !isLoading && handleSendMessage()}
                placeholder="Type a message or command…"
                className="chat-input"
                disabled={isLoading}
              />
              <button onClick={() => handleSendMessage()} className="send-btn" disabled={isLoading || !inputValue.trim()}>
                {isLoading ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <div className="agents-container">
            <div className="agents-header">
              <h2>Your Agents</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="create-agent-btn" onClick={addDemoAgents}>⚡ Add Demo Agents</button>
                <button className="create-agent-btn" onClick={() => setShowAgentModal(true)}>+ Create Agent</button>
              </div>
            </div>

            {agents.length === 0 ? (
              <div className="empty-state">
                <p>No agents yet.</p>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Click <strong>⚡ Add Demo Agents</strong> to add the two pre-built LinkedIn agents instantly,
                  or create a custom one.
                </p>
              </div>
            ) : (
              <div className="agents-grid">
                {agents.map(agent => {
                  const agentHeartbeat = heartbeats.find(h => h.agent_id === agent.id);
                  return (
                    <div key={agent.id} className="agent-card">
                      <div className="agent-header">
                        <h3>{agent.name}</h3>
                        <span className={`status-badge ${agent.status}`}>{agent.status}</span>
                      </div>
                      <div className="agent-details">
                        <p><strong>Role:</strong> {agent.role}</p>
                        <p><strong>Goal:</strong> {agent.goal}</p>
                        <p><strong>Tools:</strong> {agent.tools.join(', ') || 'None'}</p>
                        <p><strong>Schedule:</strong> {agent.schedule}</p>
                        {agent.agentType && agent.agentType !== 'custom' && (
                          <p><strong>Type:</strong> {agent.agentType === 'trending' ? '📈 Trending Poster' : '💬 Hashtag Commenter'}</p>
                        )}
                        <p>
                          <strong>Heartbeat:</strong>{' '}
                          {agentHeartbeat ? (
                            <span style={{ color: 'var(--success)' }}>
                              💓 Every {agentHeartbeat.interval_min} min
                              {agentHeartbeat.last_check && ` (last: ${fmtTs(agentHeartbeat.last_check)})`}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)' }}>Off</span>
                          )}
                        </p>
                      </div>
                      <div className="agent-actions">
                        <button
                          className="run-btn"
                          onClick={() => runAgent(agent.id)}
                          disabled={agent.status === 'running'}
                        >
                          {agent.status === 'running' ? '⏳ Running…' : '▶️ Run Agent'}
                        </button>
                        {agentHeartbeat ? (
                          <button
                            className="check-btn"
                            title="Disable heartbeat monitoring"
                            onClick={() => disableHeartbeat(agentHeartbeat.id, agent.id)}
                          >
                            💔 Heartbeat
                          </button>
                        ) : (
                          <button
                            className="check-btn"
                            title="Enable heartbeat monitoring (every 60 min)"
                            onClick={() => enableHeartbeat(agent.id, 60)}
                          >
                            💓 Heartbeat
                          </button>
                        )}
                        <button className="delete-btn" onClick={() => deleteAgent(agent.id)}>🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Run History */}
            {runHistory.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h3 style={{ marginBottom: '12px' }}>📋 Run History</h3>
                <div className="logs-list">
                  {runHistory.slice(0, 20).map(r => (
                    <div key={r.id} className={`log-entry ${r.status === 'success' ? 'success' : r.status === 'running' ? 'info' : 'error'}`}>
                      <span className="log-time">{fmtTs(r.startedAt)}</span>
                      <span className={`log-level ${r.status}`}>[{r.status.toUpperCase()}]</span>
                      <span className="log-message">Agent {r.agentId.slice(-8)} – {r.result?.slice(0, 80) || 'No result'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Heartbeat Monitor */}
            <div style={{ marginTop: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <h3>💓 Heartbeat Monitor</h3>
                <button className="check-btn" onClick={refreshHeartbeatRuns}>🔄 Refresh</button>
              </div>
              {heartbeatRuns.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No heartbeat checks recorded yet. Enable heartbeats on agents above to start monitoring.
                </p>
              ) : (
                <div className="logs-list">
                  {heartbeatRuns.slice(0, 30).map(r => (
                    <div key={r.id} className={`log-entry ${r.status === 'ok' ? 'success' : r.status === 'idle' ? 'info' : 'error'}`}>
                      <span className="log-time">{fmtTs(r.checked_at)}</span>
                      <span className={`log-level ${r.status === 'ok' ? 'success' : 'info'}`}>[{r.status.toUpperCase()}]</span>
                      <span className="log-message">Agent {r.agent_id.slice(-8)} – {r.message || 'No message'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* EVENTS TAB */}
        {activeTab === 'events' && (
          <div className="agents-container">
            <div className="agents-header">
              <h2>⚡ Event Triggers</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="create-agent-btn"
                  onClick={() => {
                    if (agents.length > 0) setNewTriggerAgentId(agents[0].id);
                    setShowEventTriggerForm(true);
                  }}
                  disabled={agents.length === 0}
                >
                  + New Trigger
                </button>
              </div>
            </div>

            <p className="setting-description" style={{ marginBottom: '16px' }}>
              Event triggers run an agent automatically when a condition fires – e.g. when a keyword appears
              on a web page, or when a URL's content changes. They are polled every 60 seconds by the background scheduler.
            </p>

            {agents.length === 0 && (
              <div className="empty-state">
                <p>Create at least one agent before adding event triggers.</p>
              </div>
            )}

            {/* New Trigger Form */}
            {showEventTriggerForm && (
              <div className="agent-card" style={{ marginBottom: '24px', border: '1px dashed var(--accent)' }}>
                <h3 style={{ marginBottom: '12px' }}>🔧 New Event Trigger</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Agent to trigger</label>
                    <select
                      value={newTriggerAgentId}
                      onChange={e => setNewTriggerAgentId(e.target.value)}
                      style={{ width: '100%', padding: '6px', marginTop: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px' }}
                    >
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Trigger type</label>
                    <select
                      value={newTriggerType}
                      onChange={e => setNewTriggerType(e.target.value)}
                      style={{ width: '100%', padding: '6px', marginTop: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px' }}
                    >
                      <option value="keyword_found">🔍 Keyword found on page</option>
                      <option value="url_change">🔄 URL content changed</option>
                      <option value="new_post">📰 New post / feed item detected</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Target URL (http:// only — TLS not supported in built-in poller)</label>
                    <input
                      type="url"
                      value={newTriggerUrl}
                      onChange={e => setNewTriggerUrl(e.target.value)}
                      placeholder="http://example.com/feed"
                      style={{ width: '100%', padding: '6px', marginTop: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: newTriggerUrl && !newTriggerUrl.startsWith('http://') ? '1px solid var(--error)' : '1px solid var(--border)', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                    {newTriggerUrl && !newTriggerUrl.startsWith('http://') && (
                      <p style={{ fontSize: '11px', color: 'var(--error)', margin: '4px 0 0' }}>
                        ⚠️ Only http:// URLs are supported. https:// requires TLS support not available in the built-in poller.
                      </p>
                    )}
                  </div>
                  {newTriggerType === 'keyword_found' && (
                    <div>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Keyword</label>
                      <input
                        type="text"
                        value={newTriggerKeyword}
                        onChange={e => setNewTriggerKeyword(e.target.value)}
                        placeholder="e.g. openclaw"
                        style={{ width: '100%', padding: '6px', marginTop: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Check interval (minutes)</label>
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      value={newTriggerInterval}
                      onChange={e => setNewTriggerInterval(Number(e.target.value))}
                      style={{ width: '120px', padding: '6px', marginTop: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="run-btn" onClick={createEventTrigger}>✅ Create Trigger</button>
                    <button className="delete-btn" onClick={() => setShowEventTriggerForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Existing triggers list */}
            {eventTriggers.length === 0 && !showEventTriggerForm ? (
              <div className="empty-state">
                <p>No event triggers yet.</p>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Click <strong>+ New Trigger</strong> to add one. Triggers are polled by the background scheduler.
                </p>
              </div>
            ) : (
              <div className="agents-grid">
                {eventTriggers.map(t => {
                  const agent = agents.find(a => a.id === t.agent_id);
                  return (
                    <div key={t.id} className="agent-card">
                      <div className="agent-header">
                        <h3 style={{ fontSize: '14px' }}>
                          {t.trigger_type === 'keyword_found' ? '🔍' : t.trigger_type === 'url_change' ? '🔄' : '📰'}{' '}
                          {t.trigger_type.replace(/_/g, ' ')}
                        </h3>
                        <span className={`status-badge ${t.enabled ? 'completed' : 'idle'}`}>
                          {t.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                      <div className="agent-details">
                        <p><strong>Agent:</strong> {agent?.name ?? t.agent_id.slice(-8)}</p>
                        <p><strong>URL:</strong> <span style={{ wordBreak: 'break-all', fontSize: '12px' }}>{t.target_url}</span></p>
                        {t.keyword && <p><strong>Keyword:</strong> {t.keyword}</p>}
                        <p><strong>Interval:</strong> every {t.check_interval_min} min</p>
                        {t.last_checked && <p><strong>Last checked:</strong> {fmtTs(t.last_checked)}</p>}
                      </div>
                      <div className="agent-actions">
                        <button className="delete-btn" onClick={() => deleteEventTrigger(t.id)}>🗑️ Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Event history */}
            <div style={{ marginTop: '32px' }}>
              <h3 style={{ marginBottom: '12px' }}>📋 Event History</h3>
              {eventHistory.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No events fired yet. Triggers are polled every 60 seconds when the scheduler runs.
                </p>
              ) : (
                <div className="logs-list">
                  {eventHistory.slice(0, 30).map(e => (
                    <div key={e.id} className={`log-entry ${e.status === 'fired' ? 'success' : 'error'}`}>
                      <span className="log-time">{fmtTs(e.fired_at)}</span>
                      <span className={`log-level ${e.status === 'fired' ? 'success' : 'error'}`}>[{e.status.toUpperCase()}]</span>
                      <span className="log-message">
                        Agent {e.agent_id.slice(-8)} – {e.matched_content?.slice(0, 120) || 'No details'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="logs-container">
            <h2>Activity Logs</h2>
            {logs.length === 0 ? (
              <p>No logs yet. Run an agent to see activity.</p>
            ) : (
              <div className="logs-list">
                {logs.map((log, idx) => (
                  <div key={idx} className={`log-entry ${log.level}`}>
                    <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className={`log-level ${log.level}`}>[{log.level.toUpperCase()}]</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Approvals Audit Log (issue #14) */}
            {approvals.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h3 style={{ marginBottom: '12px' }}>✅ Approval Audit Log</h3>
                <div className="logs-list">
                  {approvals.slice(0, 30).map(a => (
                    <div
                      key={a.id}
                      className={`log-entry ${a.outcome === 'approved' ? 'success' : a.outcome === 'rejected' ? 'error' : 'warning'}`}
                    >
                      <span className="log-time">{fmtTs(a.decided_at)}</span>
                      <span className={`log-level ${a.outcome === 'approved' ? 'success' : a.outcome === 'cancelled' ? 'warning' : 'error'}`}>
                        [{a.outcome.toUpperCase()}]
                      </span>
                      <span className="log-message">
                        Agent {a.agent_id.slice(-8)} – {a.content_preview.slice(0, 80)}
                        {a.notes ? ` (${a.notes})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LLM Usage Log */}
            {llmUsage.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h3 style={{ marginBottom: '12px' }}>🤖 LLM Usage Log</h3>
                <div className="logs-list">
                  {llmUsage.slice(0, 20).map(u => (
                    <div key={u.id} className="log-entry info">
                      <span className="log-time">{fmtTs(u.timestamp)}</span>
                      <span className="log-level info">[LLM]</span>
                      <span className="log-message">
                        {u.provider === 'ollama' ? '🏠' : u.provider === 'llamacpp' ? '⚡' : '🔑'} {u.provider} / {u.model}
                        {u.context && ` (${u.context})`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* OpenClaw Runs Log */}
            <div style={{ marginTop: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <h3>🔧 OpenClaw Runs</h3>
                <button className="check-btn" onClick={refreshOpenClawRuns}>🔄 Refresh</button>
              </div>
              {openClawRuns.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No OpenClaw runs yet. Run an agent to see OpenClaw CLI output here.
                </p>
              ) : (
                <div className="logs-list">
                  {openClawRuns.slice(0, 20).map(r => (
                    <div key={r.id} className={`log-entry ${r.exit_code === 0 ? 'success' : r.exit_code === null ? 'info' : 'error'}`}>
                      <span className="log-time">{fmtTs(r.started_at)}</span>
                      <span className={`log-level ${r.exit_code === 0 ? 'success' : r.exit_code === null ? 'info' : 'error'}`}>
                        [exit:{r.exit_code ?? '?'}]
                      </span>
                      <span className="log-message" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                        Agent {r.agent_id.slice(-8)} | {r.command.slice(0, 60)}
                        {r.stdout && ` › ${r.stdout.slice(0, 100)}`}
                        {r.stderr && !r.stdout && ` ⚠ ${r.stderr.slice(0, 100)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="settings-container">
            <h2>Settings</h2>

            {/* Sandbox Mode */}
            <div className="settings-section">
              <h3>Sandbox Mode</h3>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={sandboxMode}
                  onChange={e => {
                    setSandboxMode(e.target.checked);
                    addLog('system', 'info', `Sandbox mode ${e.target.checked ? 'enabled' : 'disabled'}`);
                  }}
                />
                <span className="toggle-slider" />
              </label>
              <p className="setting-description">
                {sandboxMode
                  ? '✅ Sandbox enabled – agents simulate actions without real execution'
                  : '⚠️ Production mode – agents will take real actions (approval required before posting)'}
              </p>
            </div>

            {/* Local LLM */}
            <div className="settings-section">
              <h3>Local AI Model (Ollama)</h3>
              <div className="api-key-input">
                <label>Model name</label>
                <select
                  value={localModel}
                  onChange={e => {
                    setLocalModel(e.target.value);
                    localStorage.setItem('local_model', e.target.value);
                    addLog('system', 'info', `Local model switched to ${e.target.value}`);
                  }}
                >
                  <option value="llama3">llama3 (Llama 3 8B – default)</option>
                  <option value="llama3:8b">llama3:8b</option>
                  <option value="phi3">phi3 (Phi-3 Mini)</option>
                  <option value="phi3:medium">phi3:medium</option>
                  <option value="mistral">mistral</option>
                  <option value="gemma2:2b">gemma2:2b (Gemma 2 2B – local, free)</option>
                  <option value="gemma2">gemma2 (Gemma 2 9B)</option>
                </select>
                <p className="setting-description">
                  Used offline when no external API key is set. Pull with: <code>ollama pull {localModel}</code>
                </p>
              </div>
              <button onClick={checkOllamaConnection} className="check-btn">🔄 Check Connection</button>
              <p className={`connection-status ${ollamaStatus}`}>
                {ollamaStatus === 'connected'
                  ? `✅ Connected to Ollama on localhost:11434`
                  : '❌ Ollama not found. Run: ollama serve'}
              </p>
            </div>

            {/* External LLM */}
            <div className="settings-section">
              <h3>External LLM (optional)</h3>
              <p className="setting-description">
                <strong>Current mode:</strong>{' '}
                {useExternalLLM ? `🔑 External API (${localStorage.getItem('llm_model') || 'GPT-4'})` : `🏠 Local model (${localModel})`}
              </p>
              <p className="setting-description">
                If an API key is set, the external model is used instead of the local one.
              </p>
              <div className="api-key-input">
                <label>API Key (OpenAI / Anthropic / Google)</label>
                <input
                  type="password"
                  placeholder="sk-… (OpenAI), sk-ant-… (Anthropic), or AIzaSy… (Google)"
                  defaultValue={localStorage.getItem('llm_api_key') || ''}
                  onChange={e => {
                    if (e.target.value) {
                      localStorage.setItem('llm_api_key', e.target.value);
                      setUseExternalLLM(true);
                      addLog('system', 'success', 'API key saved – using external LLM');
                    } else {
                      localStorage.removeItem('llm_api_key');
                      setUseExternalLLM(false);
                      addLog('system', 'info', `API key removed – using local ${localModel}`);
                    }
                  }}
                />
                <p className="setting-description" style={{ marginTop: '4px' }}>
                  🔑 Key format: <strong>sk-…</strong> for OpenAI · <strong>sk-ant-…</strong> for Anthropic · <strong>AIzaSy…</strong> for Google (Gemini/Gemma)
                </p>
              </div>
              <div className="api-key-input">
                <label>External Model</label>
                <select
                  defaultValue={localStorage.getItem('llm_model') || 'gpt-4'}
                  onChange={e => {
                    localStorage.setItem('llm_model', e.target.value);
                    addLog('system', 'info', `External model switched to ${e.target.value}`);
                  }}
                >
                  <optgroup label="OpenAI">
                    <option value="gpt-4">GPT-4 (OpenAI)</option>
                    <option value="gpt-4o">GPT-4o (OpenAI)</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
                  </optgroup>
                  <optgroup label="Anthropic">
                    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Anthropic)</option>
                    <option value="claude-3-opus-20240229">Claude 3 Opus (Anthropic)</option>
                  </optgroup>
                  <optgroup label="Google AI (requires Google AI Studio key: AIzaSy…)">
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash (Google)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Google)</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (Google)</option>
                    <option value="gemma-2-2b-it">Gemma 2 2B – cloud API (Google AI)</option>
                    <option value="gemma-2-9b-it">Gemma 2 9B – cloud API (Google AI)</option>
                  </optgroup>
                </select>
                <p className="setting-description" style={{ marginTop: '4px' }}>
                  💡 <strong>Cloud Gemma</strong> (above) uses your Google AI Studio key. For <strong>local Gemma</strong> (free, no key), go to Local AI Model and run: <code>ollama pull gemma2:2b</code>
                </p>
              </div>
            </div>

            {/* About */}
            <div className="settings-section">
              <h3>About</h3>
              <p className="setting-description">
                Personaliz v0.2.0<br />
                Desktop Assistant for OpenClaw Automation<br />
                React + Tauri + SQLite + Playwright
              </p>
            </div>

            {/* Reset */}
            <div className="settings-section">
              <h3>Reset</h3>
              <button
                onClick={() => {
                  if (confirm('Clear all data and restart onboarding?')) {
                    localStorage.clear();
                    setAgents([]);
                    setLogs([]);
                    setRunHistory([]);
                    setMessages([]);
                    setIsOnboarding(true);
                  }
                }}
                className="reset-btn"
              >
                🔄 Reset App
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAgentModal && (
        <AgentCreationModal onClose={() => setShowAgentModal(false)} onCreate={createAgent} />
      )}
      <ApprovalModal
        isOpen={showApprovalModal}
        content={pendingContent}
        agentId={pendingAgentId ?? undefined}
        onApprove={handleApprove}
        onEdit={setPendingContent}
        onCancel={handleCancel}
      />

      {/* Floating mini-chat overlay (issue #16) – visible on all tabs except chat */}
      {isFloatingChatOpen && (
        <div className="floating-chat-overlay" style={{ zIndex: 10000 }}>
          <div className="floating-chat-header">
            <span>🤖 Quick Chat</span>
            <button onClick={() => setIsFloatingChatOpen(false)} className="floating-close-btn">✕</button>
          </div>
          <div className="floating-chat-messages">
            {messages.slice(-6).map((msg, idx) => (
              <div key={idx} className={`floating-msg ${msg.role}`}>
                <span className="floating-msg-avatar">{msg.role === 'user' ? '👤' : '🤖'}</span>
                <span className="floating-msg-text">{msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}</span>
              </div>
            ))}
            <div ref={floatingMessagesEndRef} />
          </div>
          <div className="floating-chat-input">
            <input
              type="text"
              value={floatingInput}
              onChange={e => setFloatingInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && floatingInput.trim()) {
                  const msg = floatingInput;
                  setFloatingInput('');
                  setIsFloatingChatOpen(false);
                  setActiveTab('chat');
                  handleSendMessage(msg);
                }
              }}
              placeholder="Ask anything…"
            />
            <button
              onClick={() => {
                if (!floatingInput.trim()) return;
                const msg = floatingInput;
                setFloatingInput('');
                setIsFloatingChatOpen(false);
                setActiveTab('chat');
                handleSendMessage(msg);
              }}
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* Floating Assistant Icon – always visible */}
      <button
        className={`floating-assistant-btn ${isChatOpen ? 'open' : ''}`}
        title={isFloatingChatOpen ? 'Close mini chat' : 'Open mini chat'}
        onClick={() => {
          setIsFloatingChatOpen(prev => !prev);
          if (!isFloatingChatOpen) {
            setIsChatOpen(prev => !prev);
          }
        }}
        aria-label="Toggle chat panel"
        style={{ zIndex: 10001 }}
      >
        {isFloatingChatOpen ? '✕' : '🤖'}
      </button>
    </div>
  );
}

export default App;
