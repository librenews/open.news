import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

export interface LLMService {
  complete(messages: LLMMessage[], options?: { maxTokens?: number }): Promise<LLMResponse>;
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

class AnthropicLLM implements LLMService {
  private client = new Anthropic({ apiKey: config.LLM_API_KEY });

  async complete(messages: LLMMessage[], options: { maxTokens?: number } = {}): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const response = await this.client.messages.create({
      model: config.LLM_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      system: systemMsg,
      messages: userMessages,
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      provider: 'anthropic',
      model: config.LLM_MODEL,
    };
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

class OpenAILLM implements LLMService {
  private client = new OpenAI({ apiKey: config.LLM_API_KEY });

  async complete(messages: LLMMessage[], options: { maxTokens?: number } = {}): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: config.LLM_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const choice = response.choices[0];
    return {
      text: choice?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      provider: 'openai',
      model: config.LLM_MODEL,
    };
  }
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

class OllamaLLM implements LLMService {
  async complete(messages: LLMMessage[], options: { maxTokens?: number } = {}): Promise<LLMResponse> {
    const response = await fetch(`${config.LLM_OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: { num_predict: options.maxTokens ?? 1024 },
      }),
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);

    const data = await response.json() as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: data.message.content,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      provider: 'ollama',
      model: config.LLM_MODEL,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createLLM(): LLMService {
  switch (config.LLM_PROVIDER) {
    case 'anthropic': return new AnthropicLLM();
    case 'openai':    return new OpenAILLM();
    case 'ollama':    return new OllamaLLM();
    default: throw new Error(`Unknown LLM provider: ${config.LLM_PROVIDER}`);
  }
}

export const llm = createLLM();
