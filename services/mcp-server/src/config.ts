/**
 * Central configuration loaded from environment variables.
 * Every value is validated at boot; the process refuses to start on bad config.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEMO_MODE: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('0.0.0.0'),
  MCP_PATH: z.string().default('/mcp'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  LIFEOPS_API_KEY: z.string().default(''),
  DATABASE_URL: z.string().default('file:./data/lifeops.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AWS_REGION: z.string().default('us-east-1'),
  BEDROCK_MODEL_ID: z.string().default(''),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  AWS_SESSION_TOKEN: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  demoMode: env.DEMO_MODE,
  server: {
    port: env.PORT,
    host: env.HOST,
    mcpPath: env.MCP_PATH,
    allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    apiKey: env.LIFEOPS_API_KEY,
  },
  db: {
    // Strip the "file:" prefix if present so better-sqlite3 gets a plain path.
    file: env.DATABASE_URL.replace(/^file:/, ''),
  },
  log: {
    level: env.LOG_LEVEL,
  },
  aws: {
    region: env.AWS_REGION,
    bedrockModelId: env.BEDROCK_MODEL_ID,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    /** Whether Bedrock is fully configured. If false, the planner uses the deterministic fallback. */
    bedrockEnabled: Boolean(env.BEDROCK_MODEL_ID),
  },
  /** MCP protocol version — Alexa+ requires 2025-11-25 or later. */
  mcp: {
    serverName: 'lifeops-mcp',
    serverVersion: '0.1.0',
    /** SDK handles version negotiation; this is the version we advertise as supported. */
    protocolVersion: '2025-11-25',
  },
} as const;

export type AppConfig = typeof config;
