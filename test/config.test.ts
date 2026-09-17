import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('requires PODIUM_URL', () => {
    expect(() => loadConfig({})).toThrow(/PODIUM_URL/);
  });

  it('applies defaults', () => {
    const cfg = loadConfig({ PODIUM_URL: 'http://podium.example:3000' });
    expect(cfg).toEqual({
      podiumUrl: 'http://podium.example:3000',
      podiumTimeoutMs: 30000,
      transport: 'http',
      port: 8080,
      enableDestructive: false,
      logLevel: 'info',
    });
  });

  it('strips a trailing slash from PODIUM_URL', () => {
    const cfg = loadConfig({ PODIUM_URL: 'http://podium.example:3000/' });
    expect(cfg.podiumUrl).toBe('http://podium.example:3000');
  });

  it('rejects a non-URL PODIUM_URL', () => {
    expect(() => loadConfig({ PODIUM_URL: 'not a url' })).toThrow(/PODIUM_URL/);
  });

  it('parses every optional variable', () => {
    const cfg = loadConfig({
      PODIUM_URL: 'http://podium.example:3000',
      PODIUM_TOKEN: 'abc',
      PODIUM_TIMEOUT_MS: '5000',
      MCP_TRANSPORT: 'stdio',
      MCP_PORT: '9000',
      MCP_AUTH_TOKEN: 'secret',
      PODIUM_MCP_ENABLE_DESTRUCTIVE: 'true',
      LOG_LEVEL: 'debug',
    });
    expect(cfg.podiumToken).toBe('abc');
    expect(cfg.podiumTimeoutMs).toBe(5000);
    expect(cfg.transport).toBe('stdio');
    expect(cfg.port).toBe(9000);
    expect(cfg.mcpAuthToken).toBe('secret');
    expect(cfg.enableDestructive).toBe(true);
    expect(cfg.logLevel).toBe('debug');
  });

  it('treats only "true" and "1" as enabling destructive tools', () => {
    const base = { PODIUM_URL: 'http://podium.example:3000' };
    expect(loadConfig({ ...base, PODIUM_MCP_ENABLE_DESTRUCTIVE: '1' }).enableDestructive).toBe(true);
    expect(loadConfig({ ...base, PODIUM_MCP_ENABLE_DESTRUCTIVE: 'yes' }).enableDestructive).toBe(false);
    expect(loadConfig({ ...base, PODIUM_MCP_ENABLE_DESTRUCTIVE: '' }).enableDestructive).toBe(false);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadConfig({ PODIUM_URL: 'http://podium.example:3000', MCP_TRANSPORT: 'sse' })).toThrow(/MCP_TRANSPORT/);
  });
});
