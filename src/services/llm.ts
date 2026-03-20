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
  stream(
    messages: LLMMessage[],
    options?: { maxTokens?: number }
  ): AsyncGenerator<{ token: string } | { done: true; usage: { input: number; output: number } }>;
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

  async *stream(
    messages: LLMMessage[],
    options: { maxTokens?: number } = {}
  ): AsyncGenerator<{ token: string } | { done: true; usage: { input: number; output: number } }> {
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const stream = this.client.messages.stream({
      model: config.LLM_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      system: systemMsg,
      messages: userMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { token: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    yield { done: true, usage: { input: final.usage.input_tokens, output: final.usage.output_tokens } };
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

  async *stream(
    messages: LLMMessage[],
    options: { maxTokens?: number } = {}
  ): AsyncGenerator<{ token: string } | { done: true; usage: { input: number; output: number } }> {
    const stream = await this.client.chat.completions.create({
      model: config.LLM_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { token: delta };
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    yield { done: true, usage: { input: inputTokens, output: outputTokens } };
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

  async *stream(
    messages: LLMMessage[],
    options: { maxTokens?: number } = {}
  ): AsyncGenerator<{ token: string } | { done: true; usage: { input: number; output: number } }> {
    // Ollama: use streaming NDJSON endpoint
    const response = await fetch(`${config.LLM_OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: { num_predict: options.maxTokens ?? 1024 },
      }),
    });

    if (!response.ok || !response.body) throw new Error(`Ollama error: ${response.statusText}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
      for (const line of lines) {
        const data = JSON.parse(line) as {
          message?: { content: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        if (data.message?.content) yield { token: data.message.content };
        if (data.done) {
          inputTokens = data.prompt_eval_count ?? 0;
          outputTokens = data.eval_count ?? 0;
        }
      }
    }

    yield { done: true, usage: { input: inputTokens, output: outputTokens } };
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

