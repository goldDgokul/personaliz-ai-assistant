import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import '../styles/Onboarding.css';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);

  // Step 2 – Ollama
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [localModel, setLocalModel] = useState('phi3');

  // Step 3 – OpenClaw
  const [openClawInstalled, setOpenClawInstalled] = useState<boolean | null>(null);
  const [installingOpenClaw, setInstallingOpenClaw] = useState(false);
  const [openClawLog, setOpenClawLog] = useState('');

  // Step 4 – API keys
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');

  // -----------------------------------------------------------------------
  // Step 2 helpers – Ollama
  // -----------------------------------------------------------------------

  const checkOllama = async () => {
    setCheckingOllama(true);
    try {
      // Try Tauri command
      try {
        const ok = await invoke<boolean>('check_ollama_status');
        setOllamaConnected(ok);
        if (ok) {
          localStorage.setItem('local_model', localModel);
          setCheckingOllama(false);
          return;
        }
      } catch (_) {
        // fall back to fetch
      }
      const response = await fetch('http://localhost:11434/api/tags');
      setOllamaConnected(response.ok);
    } catch {
      setOllamaConnected(false);
    }
    setCheckingOllama(false);
  };

  // -----------------------------------------------------------------------
  // Step 3 helpers – OpenClaw
  // -----------------------------------------------------------------------

  const checkOpenClaw = async () => {
    try {
      const installed = await invoke<boolean>('check_openclaw_installed');
      setOpenClawInstalled(installed);
      if (installed) setOpenClawLog('✅ OpenClaw is already installed!');
    } catch {
      setOpenClawInstalled(false);
    }
  };

  const doInstallOpenClaw = async () => {
    setInstallingOpenClaw(true);
    setOpenClawLog('⏳ Running npm install -g openclaw …');
    try {
      const result = await invoke<string>('install_openclaw');
      setOpenClawLog(`✅ Done!\n${result}`);
      setOpenClawInstalled(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenClawLog(`❌ Install failed:\n${msg}\n\nMake sure Node.js is installed: https://nodejs.org`);
      setOpenClawInstalled(false);
    }
    setInstallingOpenClaw(false);
  };

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  const handleNext = () => setStep(s => Math.min(s + 1, 5));
  const handleSkip = () => setStep(s => Math.min(s + 1, 5));

  const handleComplete = () => {
    // Persist entered API keys under separate storage keys
    if (openaiKey.trim()) {
      localStorage.setItem('openai_api_key', openaiKey.trim());
      // Use OpenAI as the active key when both are provided
      localStorage.setItem('llm_api_key', openaiKey.trim());
      localStorage.setItem('llm_model', 'gpt-4');
    }
    if (anthropicKey.trim()) {
      localStorage.setItem('anthropic_api_key', anthropicKey.trim());
      // Only set as active key if no OpenAI key was entered
      if (!openaiKey.trim()) {
        localStorage.setItem('llm_api_key', anthropicKey.trim());
        localStorage.setItem('llm_model', 'claude-3-5-sonnet-20241022');
      }
    }
    if (localModel) localStorage.setItem('local_model', localModel);
    onComplete();
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="onboarding-container">
      <div className="onboarding-content">

        {/* STEP 1: Welcome */}
        {step === 1 && (
          <div className="onboarding-step">
            <div className="step-icon">👋</div>
            <h1>Welcome to Personaliz Assistant</h1>
            <p>Let's set up your desktop automation experience!</p>
            <div className="features-list">
              {[
                ['✓', 'Chat-based agent creation', 'Create automation agents just by chatting'],
                ['✓', 'Local AI – no API key needed', 'Run Phi-3 Mini or Llama3 locally with Ollama'],
                ['✓', 'Browser automation', 'Post to LinkedIn, comment on hashtags, and more'],
                ['✓', 'Scheduled agents', 'Run agents hourly, daily, weekly – fully automated'],
              ].map(([icon, title, desc]) => (
                <div className="feature" key={title}>
                  <span className="feature-icon">{icon}</span>
                  <div><h3>{title}</h3><p>{desc}</p></div>
                </div>
              ))}
            </div>
            <button className="btn-primary" onClick={handleNext}>Let's Go! →</button>
          </div>
        )}

        {/* STEP 2: Ollama Setup */}
        {step === 2 && (
          <div className="onboarding-step">
            <div className="step-icon">🧠</div>
            <h1>Set Up Local AI (Ollama)</h1>
            <p>Ollama runs AI models locally – no API key or internet required.</p>

            <div className="setup-instructions">
              <h3>Installation:</h3>
              <ol>
                <li>Download Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">ollama.ai</a></li>
                <li>Install and launch it</li>
                <li>
                  Pull a small model (pick one):<br/>
                  <code>ollama pull phi3</code> &nbsp;← recommended (3 GB, fast)<br/>
                  <code>ollama pull llama3</code> &nbsp;← larger (4.7 GB)
                </li>
                <li>Ollama starts automatically after install</li>
              </ol>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                Local model name:
              </label>
              <select
                value={localModel}
                onChange={e => { setLocalModel(e.target.value); localStorage.setItem('local_model', e.target.value); }}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #444', background: '#1e1e1e', color: '#fff' }}
              >
                <option value="phi3">phi3 (Phi-3 Mini – recommended)</option>
                <option value="phi3:medium">phi3:medium</option>
                <option value="llama3">llama3 (Llama 3 8B)</option>
                <option value="llama3:8b">llama3:8b</option>
                <option value="mistral">mistral</option>
              </select>
            </div>

            <button
              className={`btn-primary ${checkingOllama ? 'loading' : ''}`}
              onClick={checkOllama}
              disabled={checkingOllama}
            >
              {checkingOllama ? '🔄 Checking…' : '✓ Check Connection'}
            </button>

            {ollamaConnected && (
              <div className="success-message">✅ Ollama is running on localhost:11434!</div>
            )}

            {ollamaConnected ? (
              <button className="btn-primary" onClick={handleNext}>Continue →</button>
            ) : (
              <button className="btn-secondary" onClick={handleSkip}>Skip for now</button>
            )}
          </div>
        )}

        {/* STEP 3: OpenClaw Setup */}
        {step === 3 && (
          <div className="onboarding-step">
            <div className="step-icon">⚙️</div>
            <h1>Set Up OpenClaw</h1>
            <p>OpenClaw is the automation framework that powers your agents.</p>

            <p style={{ fontSize: '14px', color: '#aaa', marginBottom: '12px' }}>
              Requires <strong>Node.js</strong> (v18+). The installer will run{' '}
              <code>npm install -g openclaw</code> for you.
            </p>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
              <button className="btn-primary" onClick={checkOpenClaw} disabled={installingOpenClaw}>
                🔍 Check
              </button>
              {openClawInstalled === false && (
                <button className="btn-primary" onClick={doInstallOpenClaw} disabled={installingOpenClaw}>
                  {installingOpenClaw ? '⏳ Installing…' : '⬇️ Install OpenClaw'}
                </button>
              )}
            </div>

            {openClawLog && (
              <pre style={{
                background: '#111', color: '#0f0', padding: '10px',
                borderRadius: '6px', fontSize: '12px', whiteSpace: 'pre-wrap',
                maxHeight: '150px', overflowY: 'auto', marginBottom: '12px'
              }}>
                {openClawLog}
              </pre>
            )}

            {openClawInstalled && (
              <button className="btn-primary" onClick={handleNext}>Continue →</button>
            )}
            <button className="btn-secondary" onClick={handleSkip}>Skip for now</button>
          </div>
        )}

        {/* STEP 4: API Keys (Optional) */}
        {step === 4 && (
          <div className="onboarding-step">
            <div className="step-icon">🔑</div>
            <h1>Optional: Add External API Key</h1>
            <p>
              Personaliz works <strong>offline</strong> with local Ollama. Add an API key only if
              you want cloud models (GPT-4, Claude).
            </p>
            <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px' }}>
              💡 If no key is set, the app uses your local Ollama model automatically.
            </p>

            <div className="api-info">
              <div className="api-option">
                <h3>OpenAI (GPT-4)</h3>
                <p>Get from: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com</a></p>
                <input
                  type="password"
                  placeholder="sk-…"
                  value={openaiKey}
                  onChange={e => setOpenaiKey(e.target.value)}
                />
              </div>
              <div className="api-option">
                <h3>Anthropic (Claude)</h3>
                <p>Get from: <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a></p>
                <input
                  type="password"
                  placeholder="sk-ant-…"
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                />
              </div>
            </div>

            <button className="btn-primary" onClick={handleNext}>All Set! →</button>
            <button className="btn-secondary" onClick={handleSkip}>Skip APIs</button>
          </div>
        )}

        {/* STEP 5: Complete */}
        {step === 5 && (
          <div className="onboarding-step">
            <div className="step-icon">🎉</div>
            <h1>You're All Set!</h1>
            <p>Your Personaliz Assistant is ready to go</p>

            <div className="quick-tips">
              <h3>Quick Tips:</h3>
              <ul>
                <li>📝 Chat with the assistant to create agents</li>
                <li>🤖 Go to <strong>Agents</strong> tab → click <em>Add Demo Agents</em> to create the LinkedIn & hashtag agents instantly</li>
                <li>📊 Check <strong>Logs</strong> for execution details and run history</li>
                <li>⚙️ Customise settings anytime (sandbox mode, model, API keys)</li>
              </ul>
            </div>

            <button className="btn-primary" onClick={handleComplete}>
              Start Using Personaliz →
            </button>
          </div>
        )}
      </div>

      {/* Step indicator */}
      <div className="step-progress">
        {[1, 2, 3, 4, 5].map(s => (
          <div
            key={s}
            className={`progress-dot ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};

export default Onboarding;
