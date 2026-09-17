import { describe, expect, it } from 'vitest';
import { connect, mockClient } from './helpers.js';

describe('buildServer', () => {
  it('connects and lists tools', async () => {
    const mcp = await connect(mockClient());
    const { tools } = await mcp.listTools();
    expect(Array.isArray(tools)).toBe(true);
    await mcp.close();
  });
});
