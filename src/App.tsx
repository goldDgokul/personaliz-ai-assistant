import React, { useState, useEffect, useRef } from 'react';
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
  const [localModel, setLocalModel] = useState('phi3');

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
      setLocalModel(localStorage.getItem('local_model') || 'phi3');
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
    const model = localStorage.getItem('local_model') || 'phi3';
    const systemPrompt = `You are Personaliz, a helpful desktop assistant that helps users automate tasks with OpenClaw.
You are friendly, conversational, and guide users step by step.
Keep responses concise (2-3 sentences max).`;

    try {
      // Try Tauri command first (passes model name)
      const reply = await invoke<string>('send_message_to_llm', {
        message,
        history: messages.map(m => ({ role: m.role, content: m.content })),
        model,
      });
      return reply;
    } catch (_) {
      // Fallback to direct HTTP
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
    const systemPrompt = `You are Personaliz, a helpful desktop assistant for OpenClaw automation. Keep responses concise.`;
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
      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
      const data = await response.json();
      return data.content?.[0]?.text || 'No response.';
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
    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response.';
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    const userMessage = inputValue;
    setInputValue('');
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
      } else {
        response = await callLocalLLM(userMessage);
        setUseExternalLLM(false);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);

      const lower = userMessage.toLowerCase();
      if (
        lower.includes('create agent') || lower.includes('new agent') ||
        lower.includes('linkedin') || lower.includes('trending')
      ) {
        setTimeout(() => setShowAgentModal(true), 500);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog('chat', 'error', `LLM Error: ${msg}`);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${msg}. Make sure Ollama is running (ollama serve) or check your API key in Settings.`,
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
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Created agent "${newAgent.name}"!\n\nRole: ${newAgent.role}\nGoal: ${newAgent.goal}\nSchedule: ${newAgent.schedule}\n\nHead to the Agents tab to run it!`,
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
  // Run agent
  // -------------------------------------------------------------------------

  const runAgent = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const modeText = sandboxMode ? '[SANDBOX]' : '[PRODUCTION]';
    addLog(agentId, 'info', `🚀 Running ${agent.name} ${modeText}…`);
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'running' } : a));

    try {
      if (agent.agentType === 'hashtag') {
        await runHashtagAgent(agent);
        return;
      }

      // Trending / custom agent – generate content then optionally show approval
      addLog(agentId, 'info', '🔍 Searching trending topics…');
      await delay(800);
      addLog(agentId, 'info', '✍️ Generating LinkedIn post…');
      await delay(800);

      const generatedContent = buildTrendingPost();

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
        content: `✅ **${agent.name}** finished in sandbox mode!\n\nGenerated:\n"${generatedContent.slice(0, 150)}…"\n\nDisable Sandbox mode in Settings to post for real.`,
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
        setLocalModel(localStorage.getItem('local_model') || 'phi3');
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
              <button onClick={handleSendMessage} className="send-btn" disabled={isLoading || !inputValue.trim()}>
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
                {agents.map(agent => (
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
                    </div>
                    <div className="agent-actions">
                      <button
                        className="run-btn"
                        onClick={() => runAgent(agent.id)}
                        disabled={agent.status === 'running'}
                      >
                        {agent.status === 'running' ? '⏳ Running…' : '▶️ Run Agent'}
                      </button>
                      <button className="delete-btn" onClick={() => deleteAgent(agent.id)}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Run History */}
            {runHistory.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h3 style={{ marginBottom: '12px' }}>📋 Run History</h3>
                <div className="logs-list">
                  {runHistory.slice(0, 20).map(r => (
                    <div key={r.id} className={`log-entry ${r.status === 'success' ? 'success' : r.status === 'running' ? 'info' : 'error'}`}>
                      <span className="log-time">{r.startedAt.slice(0, 19).replace('T', ' ')}</span>
                      <span className={`log-level ${r.status}`}>[{r.status.toUpperCase()}]</span>
                      <span className="log-message">Agent {r.agentId.slice(-8)} – {r.result?.slice(0, 80) || 'No result'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                  <option value="phi3">phi3 (Phi-3 Mini – recommended)</option>
                  <option value="phi3:medium">phi3:medium</option>
                  <option value="llama3">llama3 (Llama 3 8B)</option>
                  <option value="llama3:8b">llama3:8b</option>
                  <option value="mistral">mistral</option>
                </select>
                <p className="setting-description">
                  Used when no external API key is set. Pull with: <code>ollama pull {localModel}</code>
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
                <label>API Key (OpenAI / Anthropic)</label>
                <input
                  type="password"
                  placeholder="sk-… (OpenAI) or sk-ant-… (Anthropic)"
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
                  <option value="gpt-4">GPT-4 (OpenAI)</option>
                  <option value="gpt-4o">GPT-4o (OpenAI)</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
                  <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Anthropic)</option>
                  <option value="claude-3-opus-20240229">Claude 3 Opus (Anthropic)</option>
                </select>
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
        onApprove={handleApprove}
        onEdit={setPendingContent}
        onCancel={handleCancel}
      />
    </div>
  );
}

export default App;
