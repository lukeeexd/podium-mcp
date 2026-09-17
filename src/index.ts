#!/usr/bin/env node
import { loadConfig } from './config.js';
import { log } from './log.js';
import { PodiumClient } from './podium/client.js';
import { buildServer } from './server.js';
import { startHttp } from './transport/http.js';
import { startStdio } from './transport/stdio.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  log.setLevel(config.logLevel);

  const clientOpts: ConstructorParameters<typeof PodiumClient>[0] = {
    baseUrl: config.podiumUrl,
    timeoutMs: config.podiumTimeoutMs,
  };
  if (config.podiumToken) clientOpts.token = config.podiumToken;
  const client = new PodiumClient(clientOpts);

  log.info(`Podium target: ${config.podiumUrl}; destructive tools ${config.enableDestructive ? 'ENABLED' : 'disabled'}`);

  if (config.transport === 'stdio') {
    await startStdio(buildServer(client, config));
    return;
  }

  const deps: Parameters<typeof startHttp>[0] = { buildServer: () => buildServer(client, config), port: config.port };
  if (config.mcpAuthToken) deps.authToken = config.mcpAuthToken;
  const server = await startHttp(deps);

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('fatal', e instanceof Error ? e.message : e);
  process.exit(1);
});
