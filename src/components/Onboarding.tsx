import React, { useState } from 'react';
import '../styles/Onboarding.css';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [checkingOllama, setCheckingOllama] = useState(false);

  const checkOllama = async () => {
    setCheckingOllama(true);
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      setOllamaConnected(response.ok);
    } catch (error) {
      setOllamaConnected(false);
    }
    setCheckingOllama(false);
  };

  const handleNext = () => {
    if (step < 5) {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    setStep(step + 1);
  };

  const handleComplete = () => {
    onComplete();
  };

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
              <div className="feature">
                <span className="feature-icon">✓</span>
                <div>
                  <h3>Chat-based agent creation</h3>
                  <p>Create automation agents just by chatting</p>
                </div>
              </div>
              <div className="feature">
                <span className="feature-icon">✓</span>
                <div>
                  <h3>Local AI (no API key needed)</h3>
                  <p>Run Llama3 locally with Ollama</p>
                </div>
              </div>
              <div className="feature">
                <span className="feature-icon">✓</span>
                <div>
                  <h3>Browser automation</h3>
                  <p>Automate LinkedIn, Twitter, and more</p>
                </div>
              </div>
              <div className="feature">
                <span className="feature-icon">✓</span>
                <div>
                  <h3>Scheduled agents</h3>
                  <p>Run agents on a schedule daily, weekly, etc.</p>
                </div>
              </div>
            </div>

            <button className="btn-primary" onClick={handleNext}>
              Let's Go! →
            </button>
          </div>
        )}

        {/* STEP 2: Ollama Setup */}
        {step === 2 && (
          <div className="onboarding-step">
            <div className="step-icon">🧠</div>
            <h1>Set Up Ollama</h1>
            <p>Ollama provides local AI models without needing API keys</p>

            <div className="setup-instructions">
              <h3>Installation Steps:</h3>
              <ol>
                <li>Download Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">ollama.ai</a></li>
                <li>Install and open Ollama</li>
                <li>Pull the Llama3 model: <code>ollama pull llama3</code></li>
                <li>Run: <code>ollama serve</code></li>
              </ol>
            </div>

            <button
              className={`btn-primary ${checkingOllama ? 'loading' : ''}`}
              onClick={checkOllama}
              disabled={checkingOllama}
            >
              {checkingOllama ? '🔄 Checking...' : '✓ Check Connection'}
            </button>

            {ollamaConnected && (
              <div className="success-message">
                ✅ Ollama is running on localhost:11434!
              </div>
            )}

            {!ollamaConnected && checkingOllama === false && (
              <div className="info-message">
                ⚠️ Ollama not detected. Make sure to run "ollama serve" in a terminal.
              </div>
            )}

            {/* CONDITIONAL BUTTON - Shows "Continue" if connected, "Skip" if not */}
            {ollamaConnected ? (
              <button className="btn-primary" onClick={handleNext}>
                Continue →
              </button>
            ) : (
              <button className="btn-secondary" onClick={handleSkip}>
                Skip for now
              </button>
            )}
          </div>
        )}

        {/* STEP 3: OpenClaw Setup */}
        {step === 3 && (
          <div className="onboarding-step">
            <div className="step-icon">⚙️</div>
            <h1>Set Up OpenClaw</h1>
            <p>OpenClaw is the automation framework for your agents</p>

            <div className="setup-instructions">
              <h3>Installation:</h3>
              <ol>
                <li>Clone OpenClaw repository</li>
                <li>Follow its setup guide</li>
                <li>Configure your credentials</li>
              </ol>
              <p style={{marginTop: '20px', fontSize: '14px', color: '#999'}}>
                You can configure this later in Settings
              </p>
            </div>

            <button className="btn-primary" onClick={handleNext}>
              Continue →
            </button>
            <button className="btn-secondary" onClick={handleSkip}>
              Skip for now
            </button>
          </div>
        )}

        {/* STEP 4: API Keys (Optional) */}
        {step === 4 && (
          <div className="onboarding-step">
            <div className="step-icon">🔑</div>
            <h1>Optional: Add API Keys</h1>
            <p>Use external AI models (GPT-4, Claude) instead of local Llama3</p>

            <div className="api-info">
              <div className="api-option">
                <h3>OpenAI API</h3>
                <p>Get from: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com</a></p>
                <input type="password" placeholder="sk-..." />
              </div>
              <div className="api-option">
                <h3>Anthropic API (Claude)</h3>
                <p>Get from: <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a></p>
                <input type="password" placeholder="sk-ant-..." />
              </div>
            </div>

            <p style={{marginTop: '20px', fontSize: '13px', color: '#999'}}>
              💡 You can add these later in Settings. Local Llama3 works great for free!
            </p>

            <button className="btn-primary" onClick={handleNext}>
              All Set! →
            </button>
            <button className="btn-secondary" onClick={handleSkip}>
              Skip APIs
            </button>
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
                <li>🤖 Go to Agents tab to manage your agents</li>
                <li>📊 Check Logs for execution details</li>
                <li>⚙️ Customize settings anytime</li>
              </ul>
            </div>

            <button className="btn-primary" onClick={handleComplete}>
              Start Using Personaliz →
            </button>
          </div>
        )}
      </div>

      {/* Step Indicator */}
      <div className="step-progress">
        {[1, 2, 3, 4, 5].map(s => (
          <div key={s} className={`progress-dot ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`} />
        ))}
      </div>
    </div>
  );
};

export default Onboarding;