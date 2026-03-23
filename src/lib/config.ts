import { z } from 'zod';

const schema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // AT Protocol
  BSKY_BOT_DID: z.string().optional(),
  BSKY_BOT_PASSWORD: z.string().optional(),
  BSKY_OAUTH_CLIENT_ID: z.string().url(),
  ATPROTO_PDS_URL: z.string().url().default('https://bsky.social'),

  // Jetstream
  JETSTREAM_URL: z.string().url().default('wss://jetstream2.us-east.bsky.network/subscribe'),

  // LLM
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-3-5-haiku-20241022'),
  LLM_LIGHT_MODEL: z.string().optional(),
  LLM_OLLAMA_URL: z.string().url().default('http://localhost:11434'),

  // Search
  BRAVE_API_KEY: z.string().optional(),

  // Web
  PORT: z.coerce.number().default(3000),
  SESSION_SECRET: z.string().min(16),
  BASE_URL: z.string().url(),

  // Operational
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
