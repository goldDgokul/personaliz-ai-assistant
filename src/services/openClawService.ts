// src/services/openClawService.ts
import { invoke } from '@tauri-apps/api/core';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  role: string;
  goal: string;
  schedule: 'hourly' | 'daily' | 'weekly' | 'custom';
  cronExpression?: string;
  tools: string[];
  actions: string[];
  status: 'active' | 'paused' | 'draft';
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
}

export interface AgentLog {
  id: string;
  agentId: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  details?: any;
}

class OpenClawService {
  private agents: AgentConfig[] = [];
  private logs: AgentLog[] = [];

  // Check if OpenClaw is installed
  async checkInstalled(): Promise<boolean> {
    try {
      const result = await invoke<boolean>('check_openclaw_installed');
      return result;
    } catch (error) {
      console.error('Error checking OpenClaw:', error);
      return false;
    }
  }

  // Install OpenClaw
  async install(): Promise<string> {
    try {
      this.addLog('system', 'info', 'Starting OpenClaw installation...');
      const result = await invoke<string>('install_openclaw');
      this.addLog('system', 'success', 'OpenClaw installed successfully');
      return result;
    } catch (error) {
      this.addLog('system', 'error', `Installation failed: ${error}`);
      throw error;
    }
  }

  // Create a new agent
  createAgent(config: Omit<AgentConfig, 'id' | 'createdAt' | 'status'>): AgentConfig {
    const agent: AgentConfig = {
      ...config,
      id: `agent_${Date.now()}`,
      status: 'draft',
      createdAt: new Date(),
    };

    this.agents.push(agent);
    this.addLog(agent.id, 'info', `Agent created: ${agent.name}`);
    
    // Save to localStorage
    this.saveAgents();
    
    return agent;
  }

  // Get all agents
  getAgents(): AgentConfig[] {
    return [...this.agents];
  }

  // Get agent by ID
  getAgent(id: string): AgentConfig | undefined {
    return this.agents.find(a => a.id === id);
  }

  // Update agent
  updateAgent(id: string, updates: Partial<AgentConfig>): AgentConfig | null {
    const index = this.agents.findIndex(a => a.id === id);
    if (index === -1) return null;

    this.agents[index] = { ...this.agents[index], ...updates };
    this.saveAgents();
    this.addLog(id, 'info', 'Agent updated');
    
    return this.agents[index];
  }

  // Delete agent
  deleteAgent(id: string): boolean {
    const index = this.agents.findIndex(a => a.id === id);
    if (index === -1) return false;

    const agent = this.agents[index];
    this.agents.splice(index, 1);
    this.saveAgents();
    this.addLog(id, 'info', `Agent deleted: ${agent.name}`);
    
    return true;
  }

  // Run agent (sandbox or real)
  async runAgent(agentId: string, sandbox: boolean = true): Promise<void> {
    const agent = this.getAgent(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    this.addLog(agentId, 'info', `Running agent in ${sandbox ? 'sandbox' : 'live'} mode`);

    try {
      if (sandbox) {
        // Simulate execution
        await this.simulateExecution(agent);
      } else {
        // Real execution
        await this.executeAgent(agent);
      }

      // Update last run time
      this.updateAgent(agentId, { 
        lastRun: new Date(),
        nextRun: this.calculateNextRun(agent.schedule)
      });

      this.addLog(agentId, 'success', 'Agent executed successfully');
    } catch (error) {
      this.addLog(agentId, 'error', `Execution failed: ${error}`);
      throw error;
    }
  }

  // Simulate execution (sandbox mode)
  private async simulateExecution(agent: AgentConfig): Promise<void> {
    this.addLog(agent.id, 'info', '🔍 Simulating: Searching for trending topics...');
    await this.delay(1000);
    
    this.addLog(agent.id, 'info', '✍️ Simulating: Generating content...');
    await this.delay(1000);
    
    this.addLog(agent.id, 'info', '👀 Simulating: Preview generated (sandbox - no actual posting)');
    await this.delay(500);
    
    this.addLog(agent.id, 'success', '✅ Sandbox execution completed');
  }

  // Execute agent for real
  private async executeAgent(agent: AgentConfig): Promise<void> {
    this.addLog(agent.id, 'info', 'Executing agent actions...');
    
    for (const action of agent.actions) {
      this.addLog(agent.id, 'info', `Running: ${action}`);
      await this.delay(1000);
      // Here you would call actual OpenClaw CLI commands
      // await invoke('run_openclaw_command', { command: action });
    }
  }

  // Calculate next run time based on schedule
  private calculateNextRun(schedule: string): Date {
    const now = new Date();
    switch (schedule) {
      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  // Add log entry
  private addLog(agentId: string, level: AgentLog['level'], message: string, details?: any): void {
    const log: AgentLog = {
      id: `log_${Date.now()}`,
      agentId,
      timestamp: new Date(),
      level,
      message,
      details
    };

    this.logs.push(log);
    this.saveLogs();
    
    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  // Get logs for an agent or all logs
  getLogs(agentId?: string): AgentLog[] {
    if (agentId) {
      return this.logs.filter(log => log.agentId === agentId);
    }
    return [...this.logs];
  }

  // Clear logs
  clearLogs(): void {
    this.logs = [];
    this.saveLogs();
  }

  // Save agents to localStorage
  private saveAgents(): void {
    try {
      localStorage.setItem('openclaw_agents', JSON.stringify(this.agents));
    } catch (error) {
      console.error('Error saving agents:', error);
    }
  }

  // Load agents from localStorage
  loadAgents(): void {
    try {
      const saved = localStorage.getItem('openclaw_agents');
      if (saved) {
        this.agents = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  }

  // Save logs to localStorage
  private saveLogs(): void {
    try {
      localStorage.setItem('openclaw_logs', JSON.stringify(this.logs));
    } catch (error) {
      console.error('Error saving logs:', error);
    }
  }

  // Load logs from localStorage
  loadLogs(): void {
    try {
      const saved = localStorage.getItem('openclaw_logs');
      if (saved) {
        this.logs = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading logs:', error);
    }
  }

  // Helper: delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const openClawService = new OpenClawService();
