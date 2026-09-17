import { z } from 'zod';

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const intFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().positive());

const envSchema = z.object({
  PODIUM_URL: z
    .string({ error: 'PODIUM_URL is required (base URL of your Podium instance)' })
    .url({ error: 'PODIUM_URL must be a valid URL, e.g. http://<podium-host>:<port>' })
    .transform((v) => v.replace(/\/+$/, '')),
  PODIUM_TOKEN: z.string().optional(),
  PODIUM_TIMEOUT_MS: intFromEnv(30000),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_PORT: intFromEnv(8080),
  MCP_AUTH_TOKEN: z.string().optional(),
  PODIUM_MCP_ENABLE_DESTRUCTIVE: boolFromEnv,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface Config {
  podiumUrl: string;
  podiumToken?: string;
  podiumTimeoutMs: number;
  transport: 'http' | 'stdio';
  port: number;
  mcpAuthToken?: string;
  enableDestructive: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function emptyToUndefined(v: string | undefined): string | undefined {
  return v === undefined || v === '' ? undefined : v;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const cfg: Config = {
    podiumUrl: e.PODIUM_URL,
    podiumTimeoutMs: e.PODIUM_TIMEOUT_MS,
    transport: e.MCP_TRANSPORT,
    port: e.MCP_PORT,
    enableDestructive: e.PODIUM_MCP_ENABLE_DESTRUCTIVE,
    logLevel: e.LOG_LEVEL,
  };
  const podiumToken = emptyToUndefined(e.PODIUM_TOKEN);
  if (podiumToken !== undefined) cfg.podiumToken = podiumToken;
  const mcpAuthToken = emptyToUndefined(e.MCP_AUTH_TOKEN);
  if (mcpAuthToken !== undefined) cfg.mcpAuthToken = mcpAuthToken;
  return cfg;
}
