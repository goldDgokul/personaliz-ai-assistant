import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import AgentCreationModal from './components/AgentCreationModal';
import Onboarding from './components/Onboarding';
import './App.css';

interface Agent {
  id: string;
  name: string;
  role: string;
  goal: string;
  tools: string[];
  schedule: string;
  status: 'idle' | 'running' | 'completed';
}

interface LogEntry {
  timestamp: string;
  agentId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [sandboxMode, setSandboxMode] = useState(true);
  const [ollamaStatus, setOllamaStatus] = useState('disconnected');
  const [useExternalLLM, setUseExternalLLM] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check if onboarding needed
  useEffect(() => {
    const setupDone = localStorage.getItem('setup_completed');
    if (!setupDone) {
      setIsOnboarding(true);
    } else {
      checkOllamaConnection();
      checkExternalLLM();
    }
  }, []);

  const checkExternalLLM = () => {
    const apiKey = localStorage.getItem('llm_api_key');
    setUseExternalLLM(!!apiKey);
  };

  const checkOllamaConnection = async () => {
    try {
      // Try Tauri command first
      try {
        const status = await invoke<boolean>('check_ollama_status');
        if (status) {
          setOllamaStatus('connected');
          addLog('system', 'success', '✅ Connected to Ollama');
          return;
        }
      } catch (e) {
        console.log('Tauri invoke not available');
      }

      // Fallback to fetch
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        setOllamaStatus('connected');
        addLog('system', 'success', '✅ Connected to Ollama via HTTP');
      } else {
        setOllamaStatus('disconnected');
      }
    } catch (error) {
      setOllamaStatus('disconnected');
      console.log('Ollama connection failed:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage = inputValue;
    setInputValue('');
    setIsLoading(true);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    addLog('chat', 'info', `User: ${userMessage}`);

    try {
      // Check if user has external LLM API key
      const externalKey = localStorage.getItem('llm_api_key');
      const llmModel = localStorage.getItem('llm_model') || 'gpt-4';

      let response: string;

      if (externalKey && externalKey.trim()) {
        // Use external API
        response = await callExternalLLM(userMessage, externalKey, llmModel);
        setUseExternalLLM(true);
        addLog('chat', 'info', `Using external LLM: ${llmModel}`);
      } else {
        // Use local Ollama
        response = await callLocalLLM(userMessage);
        setUseExternalLLM(false);
        addLog('chat', 'info', 'Using local llama3 model');
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
      addLog('chat', 'success', `Assistant responded`);

      // Check if user wants to create an agent
      const lowerMessage = userMessage.toLowerCase();
      if (
        lowerMessage.includes('create agent') ||
        lowerMessage.includes('create a agent') ||
        lowerMessage.includes('new agent') ||
        lowerMessage.includes('linkedin') ||
        lowerMessage.includes('twitter') ||
        lowerMessage.includes('trending')
      ) {
        setTimeout(() => setShowAgentModal(true), 500);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error calling LLM:', error);
      addLog('chat', 'error', `LLM Error: ${errorMsg}`);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorMsg}. Make sure Ollama is running on localhost:11434.`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const callLocalLLM = async (message: string): Promise<string> => {
    try {
      const systemPrompt = `You are Personaliz, a helpful desktop assistant that helps users automate tasks with OpenClaw.
You are friendly, conversational, and guide users step by step.
You help users:
1. Create automation agents for LinkedIn, Twitter, Email, and more
2. Set up OpenClaw on their computer
3. Schedule recurring tasks
4. Test agents in sandbox mode before running them
5. Understand automation concepts

When users ask to create agents, suggest what role/goal/tools they might need.
Always be encouraging and explain things in simple terms.
Keep responses concise (2-3 sentences max).`;

      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            { role: 'user', content: message }
          ],
          stream: false,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      return data.message?.content || 'Sorry, I could not generate a response. Make sure Ollama is running.';
    } catch (error) {
      throw new Error(`Local LLM Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const callExternalLLM = async (
    message: string,
    apiKey: string,
    model: string
  ): Promise<string> => {
    try {
      const systemPrompt = `You are Personaliz, a helpful desktop assistant that helps users automate tasks with OpenClaw.
You are friendly, conversational, and guide users step by step. Keep responses concise.`;

      // Support for different API providers
      if (model.includes('gpt') || model.includes('openai')) {
        return await callOpenAI(message, apiKey, systemPrompt, model);
      } else if (model.includes('claude')) {
        return await callClaude(message, apiKey, systemPrompt, model);
      } else {
        // Default to OpenAI format
        return await callOpenAI(message, apiKey, systemPrompt, model);
      }
    } catch (error) {
      throw new Error(`External LLM Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const callOpenAI = async (
    message: string,
    apiKey: string,
    systemPrompt: string,
    model: string
  ): Promise<string> => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
  };

  const callClaude = async (
    message: string,
    apiKey: string,
    systemPrompt: string,
    model: string
  ): Promise<string> => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-3-sonnet-20240229',
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: message }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Claude API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || 'Sorry, I could not generate a response.';
  };

  const addLog = (agentId: string, level: 'info' | 'success' | 'warning' | 'error', message: string) => {
    const logEntry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      agentId,
      level,
      message
    };
    setLogs(prev => [logEntry, ...prev].slice(0, 100)); // Keep last 100 logs
  };

  const createAgent = (agentData: any) => {
    const newAgent: Agent = {
      id: `agent_${Date.now()}`,
      name: agentData.name,
      role: agentData.role,
      goal: agentData.goal,
      tools: agentData.tools || [],
      schedule: agentData.schedule || 'Daily',
      status: 'idle'
    };

    setAgents(prev => [...prev, newAgent]);
    addLog(newAgent.id, 'success', `Agent "${newAgent.name}" created successfully`);

    // Add message to chat
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Created agent "${newAgent.name}"!\n\nRole: ${newAgent.role}\nGoal: ${newAgent.goal}\nTools: ${newAgent.tools.join(', ') || 'None'}\nSchedule: ${newAgent.schedule}\n\nYou can now run this agent from the Agents tab, or ask me to modify it!`
    }]);

    setShowAgentModal(false);
  };

  const runAgent = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const modeText = sandboxMode ? '[SANDBOX MODE]' : '[PRODUCTION]';
    addLog(agentId, 'info', `🚀 Running agent ${modeText}...`);

    // Update agent status
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'running' } : a));

    try {
      // Call Tauri backend
      const result = await invoke<string>('execute_agent', {
        agentId,
        agentName: agent.name,
        role: agent.role,
        goal: agent.goal,
        tools: agent.tools,
        sandbox: sandboxMode
      });

      addLog(agentId, 'success', `✅ Agent completed: ${result}`);

      // Add to chat
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Agent "${agent.name}" execution completed!\n\nResult: ${result}\n\nCheck the Logs tab for full execution details.`
      }]);

      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'completed' } : a));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(agentId, 'error', `❌ Agent failed: ${errorMsg}`);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Agent execution failed: ${errorMsg}\n\nCheck the Logs tab for more details.`
      }]);

      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'idle' } : a));
    }
  };

  const deleteAgent = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    setAgents(prev => prev.filter(a => a.id !== agentId));
    addLog(agentId, 'info', `Agent "${agent?.name}" deleted`);
  };

  if (isOnboarding) {
    return <Onboarding onComplete={() => {
      localStorage.setItem('setup_completed', 'true');
      setIsOnboarding(false);
      checkOllamaConnection();
      checkExternalLLM();
    }} />;
  }

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="logo">🤖 Personaliz</div>
        <nav className="nav-tabs">
          <button
            className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            💬 Chat
          </button>
          <button
            className={`nav-btn ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            🤖 Agents ({agents.length})
          </button>
          <button
            className={`nav-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            📊 Logs
          </button>
          <button
            className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-badge" title={`Ollama: ${ollamaStatus}`}>
            <span className={`status-dot ${ollamaStatus === 'connected' ? 'connected' : 'disconnected'}`}></span>
            {ollamaStatus === 'connected' ? 'Llama3 Ready' : 'Offline Mode'}
          </div>
          {useExternalLLM && (
            <div className="status-badge" title="Using external API">
              🔑 API Model Active
            </div>
          )}
        </div>
      </div>

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
                    <li>"Setup OpenClaw"</li>
                    <li>"Create a trending topics agent"</li>
                    <li>"What is sandbox mode?"</li>
                  </ul>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.role}`}>
                    <div className="message-avatar">
                      {msg.role === 'user' ? '👤' : '🤖'}
                    </div>
                    <div className="message-content">{msg.content}</div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="message assistant">
                  <div className="message-avatar">🤖</div>
                  <div className="message-content loading">
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                  </div>
                </div>
              )}
            </div>
            <div className="chat-input-area">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                placeholder="Type a message or command..."
                className="chat-input"
                disabled={isLoading}
              />
              <button
                onClick={handleSendMessage}
                className="send-btn"
                disabled={isLoading || !inputValue.trim()}
              >
                {isLoading ? '...' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <div className="agents-container">
            <div className="agents-header">
              <h2>Your Agents</h2>
              <button className="create-agent-btn" onClick={() => setShowAgentModal(true)}>
                + Create Agent
              </button>
            </div>

            {agents.length === 0 ? (
              <div className="empty-state">
                <p>No agents yet. Create one to get started!</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Tip: Try saying "Create an agent" in the chat!
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
                    </div>
                    <div className="agent-actions">
                      <button className="run-btn" onClick={() => runAgent(agent.id)}>
                        ▶️ Run Agent
                      </button>
                      <button className="delete-btn" onClick={() => deleteAgent(agent.id)}>
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="logs-container">
            <h2>Activity Logs</h2>
            {logs.length === 0 ? (
              <p>No logs yet.</p>
            ) : (
              <div className="logs-list">
                {logs.map((log, idx) => (
                  <div key={idx} className={`log-entry ${log.level}`}>
                    <span className="log-time">{log.timestamp}</span>
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

            <div className="settings-section">
              <h3>Sandbox Mode</h3>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={sandboxMode}
                  onChange={(e) => {
                    setSandboxMode(e.target.checked);
                    addLog('system', 'info', `Sandbox mode ${e.target.checked ? 'enabled' : 'disabled'}`);
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
              <p className="setting-description">
                {sandboxMode
                  ? '✅ Sandbox enabled - agents will simulate actions without real execution'
                  : '⚠️ Production mode - agents will take real actions'}
              </p>
            </div>

            <div className="settings-section">
              <h3>LLM Settings</h3>
              <div className="llm-status">
                <p><strong>Current Mode:</strong> {useExternalLLM ? '🔑 External API' : '🏠 Local Model'}</p>
                <p><strong>Model:</strong> {useExternalLLM ? localStorage.getItem('llm_model') || 'GPT-4' : 'Llama3 (Ollama)'}</p>
              </div>

              <div className="api-key-input">
                <label>LLM API Key (Optional)</label>
                <input
                  type="password"
                  placeholder="sk-... (OpenAI) or claude-... (Anthropic)"
                  defaultValue={localStorage.getItem('llm_api_key') || ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      localStorage.setItem('llm_api_key', e.target.value);
                      setUseExternalLLM(true);
                      addLog('system', 'success', 'API key saved. Using external LLM.');
                    } else {
                      localStorage.removeItem('llm_api_key');
                      setUseExternalLLM(false);
                      addLog('system', 'info', 'API key removed. Using local Llama3.');
                    }
                  }}
                />
                <p className="setting-description">Leave empty to use local Llama3 model</p>
              </div>

              <div className="api-key-input">
                <label>LLM Model</label>
                <select
                  defaultValue={localStorage.getItem('llm_model') || 'gpt-4'}
                  onChange={(e) => {
                    localStorage.setItem('llm_model', e.target.value);
                    addLog('system', 'info', `Model switched to ${e.target.value}`);
                  }}
                >
                  <option value="gpt-4">GPT-4 (OpenAI)</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
                  <option value="claude-3-sonnet-20240229">Claude 3 Sonnet (Anthropic)</option>
                  <option value="claude-3-opus-20240229">Claude 3 Opus (Anthropic)</option>
                </select>
                <p className="setting-description">Only applies when using external API</p>
              </div>
            </div>

            <div className="settings-section">
              <h3>Ollama Connection</h3>
              <button onClick={checkOllamaConnection} className="check-btn">
                🔄 Check Connection
              </button>
              <p className={`connection-status ${ollamaStatus}`}>
                {ollamaStatus === 'connected'
                  ? '✅ Connected to Ollama on localhost:11434'
                  : '❌ Ollama not found. Make sure it\'s running. (ollama serve)'}
              </p>
              <p className="setting-description">
                Ollama needed for local Llama3 model. Download: https://ollama.ai
              </p>
            </div>

            <div className="settings-section">
              <h3>About</h3>
              <p className="setting-description">
                Personaliz v0.1.0<br/>
                Desktop Assistant for OpenClaw Automation<br/>
                Built with React + Tauri
              </p>
            </div>

            <div className="settings-section">
              <h3>Reset</h3>
              <button
                onClick={() => {
                  if (confirm('Clear all data and restart onboarding? This cannot be undone.')) {
                    localStorage.clear();
                    setAgents([]);
                    setLogs([]);
                    setMessages([]);
                    setIsOnboarding(true);
                    addLog('system', 'warning', 'App reset complete.');
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

      {/* AGENT CREATION MODAL */}
      {showAgentModal && (
        <AgentCreationModal
          onClose={() => setShowAgentModal(false)}
          onCreate={createAgent}
        />
      )}
    </div>
  );
}

export default App;