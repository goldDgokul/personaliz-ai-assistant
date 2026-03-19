import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import '../styles/AgentCreationModal.css';

interface AgentCreationModalProps {
  onClose: () => void;
  onCreate: (agentData: any) => void;
}

const AgentCreationModal: React.FC<AgentCreationModalProps> = ({ onClose, onCreate }) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    goal: '',
    tools: [] as string[],
    schedule: 'Daily',
    cronExpression: '',
  });
  const [cronError, setCronError] = useState('');
  const [cronNextRun, setCronNextRun] = useState('');

  const tools = ['LinkedIn', 'Twitter', 'Email', 'Browser', 'Web Search', 'Database', 'API', 'Slack'];
  const schedules = ['Once', 'Hourly', 'Daily', 'Weekly', 'Custom (cron)'];

  const handleNext = () => {
    if (step < 4) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleCreate = () => {
    if (formData.name && formData.role && formData.goal) {
      if (formData.schedule === 'Custom (cron)' && !formData.cronExpression.trim()) {
        alert('Please enter a cron expression or select a predefined schedule.');
        return;
      }
      onCreate(formData);
    } else {
      alert('Please fill in all required fields');
    }
  };

  const toggleTool = (tool: string) => {
    setFormData(prev => ({
      ...prev,
      tools: prev.tools.includes(tool)
        ? prev.tools.filter(t => t !== tool)
        : [...prev.tools, tool],
    }));
  };

  const validateCron = async (expr: string) => {
    if (!expr.trim()) {
      setCronError('');
      setCronNextRun('');
      return;
    }
    try {
      const next = await invoke<string>('validate_cron_expression', { cron: expr });
      setCronError('');
      setCronNextRun(`Next run: ${new Date(next).toLocaleString()}`);
    } catch (err) {
      setCronError(String(err));
      setCronNextRun('');
    }
  };

  const effectiveSchedule =
    formData.schedule === 'Custom (cron)' && formData.cronExpression
      ? formData.cronExpression
      : formData.schedule;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Agent</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* STEP 1: Basic Info */}
          {step === 1 && (
            <div className="step">
              <h3>Step 1: Agent Name & Role</h3>
              <div className="form-group">
                <label>Agent Name *</label>
                <input
                  type="text"
                  placeholder="e.g., LinkedIn Daily Poster"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <input
                  type="text"
                  placeholder="e.g., Content Creator, Marketing Specialist"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* STEP 2: Goal */}
          {step === 2 && (
            <div className="step">
              <h3>Step 2: Agent Goal</h3>
              <div className="form-group">
                <label>What should the agent do? *</label>
                <textarea
                  placeholder="e.g., Post trending topics on LinkedIn every morning"
                  rows={4}
                  value={formData.goal}
                  onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* STEP 3: Tools */}
          {step === 3 && (
            <div className="step">
              <h3>Step 3: Select Tools</h3>
              <p className="step-description">Choose the tools this agent will use</p>
              <div className="tools-grid">
                {tools.map(tool => (
                  <label key={tool} className="tool-checkbox">
                    <input
                      type="checkbox"
                      checked={formData.tools.includes(tool)}
                      onChange={() => toggleTool(tool)}
                    />
                    <span className="checkmark"></span>
                    {tool}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: Schedule */}
          {step === 4 && (
            <div className="step">
              <h3>Step 4: Schedule & Review</h3>
              <div className="form-group">
                <label>Schedule Frequency</label>
                <select
                  value={formData.schedule}
                  onChange={(e) => {
                    setFormData({ ...formData, schedule: e.target.value });
                    setCronError('');
                    setCronNextRun('');
                  }}
                >
                  {schedules.map(sched => (
                    <option key={sched} value={sched}>{sched}</option>
                  ))}
                </select>
              </div>

              {formData.schedule === 'Custom (cron)' && (
                <div className="form-group">
                  <label>
                    Cron Expression
                    <span style={{ fontWeight: 400, fontSize: '12px', marginLeft: '8px', color: 'var(--text-secondary)' }}>
                      (minute hour day month weekday)
                    </span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 0 9 * * 1-5  →  9 AM weekdays"
                    value={formData.cronExpression}
                    onChange={(e) => {
                      setFormData({ ...formData, cronExpression: e.target.value });
                      validateCron(e.target.value);
                    }}
                    style={{ fontFamily: 'monospace' }}
                  />
                  {cronError && (
                    <p style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>
                      ⚠️ {cronError}
                    </p>
                  )}
                  {cronNextRun && (
                    <p style={{ color: 'var(--success)', fontSize: '12px', marginTop: '4px' }}>
                      ✅ {cronNextRun}
                    </p>
                  )}
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Common examples: <code>0 9 * * *</code> (9 AM daily) · <code>0 9 * * 1-5</code> (weekdays) · <code>*/30 * * * *</code> (every 30 min)
                  </p>
                </div>
              )}

              <div className="review-section">
                <h4>Review Your Agent:</h4>
                <div className="review-item"><strong>Name:</strong> {formData.name}</div>
                <div className="review-item"><strong>Role:</strong> {formData.role}</div>
                <div className="review-item"><strong>Goal:</strong> {formData.goal}</div>
                <div className="review-item"><strong>Tools:</strong> {formData.tools.join(', ') || 'None'}</div>
                <div className="review-item">
                  <strong>Schedule:</strong> {effectiveSchedule}
                  {cronNextRun && (
                    <span style={{ color: 'var(--success)', marginLeft: '8px', fontSize: '12px' }}>
                      ({cronNextRun})
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleBack} disabled={step === 1}>
            ← Back
          </button>
          <div className="step-indicator">Step {step} of 4</div>
          {step === 4 ? (
            <button className="btn-primary" onClick={handleCreate}>
              ✓ Create Agent
            </button>
          ) : (
            <button className="btn-primary" onClick={handleNext}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentCreationModal;
