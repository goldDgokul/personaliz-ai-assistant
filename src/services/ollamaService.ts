// src/services/ollamaService.ts
// Drop-in service for Ollama integration in your Personaliz.ai app

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

class OllamaService {
  private baseUrl = 'http://localhost:11434';
  private model = 'llama3:8b';
  private conversationHistory: ChatMessage[] = [];

  private systemPrompt: ChatMessage = {
    role: 'system',
    content: `You are Personaliz Desktop Assistant, a helpful AI that guides non-technical users through OpenClaw automation setup.

Your personality:
- Friendly and encouraging
- Patient with beginners
- Clear and concise
- Action-oriented

Keep responses under 3 sentences when possible. Use emojis sparingly (1-2 per message).`
  };

  constructor() {
    this.conversationHistory.push(this.systemPrompt);
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async sendMessage(userMessage: string): Promise<string> {
    try {
      // Add user message to history
      const userMsg: ChatMessage = {
        role: 'user',
        content: userMessage
      };

      this.conversationHistory.push(userMsg);

      // Call Ollama API
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: this.conversationHistory,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data: OllamaResponse = await response.json();
      const assistantMessage = data.message.content;

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      return assistantMessage;

    } catch (error) {
      console.error('Ollama error:', error);

      // Check if Ollama is running
      const isHealthy = await this.checkHealth();
      if (!isHealthy) {
        return '⚠️ Cannot connect to Ollama. Make sure it\'s running with: ollama serve';
      }

      return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  clearHistory() {
    this.conversationHistory = [this.systemPrompt];
  }

  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json();
      return data.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  setModel(modelName: string) {
    this.model = modelName;
  }

  getModel(): string {
    return this.model;
  }
}

// Export singleton instance
export const ollamaService = new OllamaService();