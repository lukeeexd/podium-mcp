import { describe, expect, it } from 'vitest';
import { fail, ok, run } from '../../src/tools/result.js';
import { PodiumError } from '../../src/podium/errors.js';

describe('result helpers', () => {
  it('ok returns summary text, JSON text and structuredContent', () => {
    const r = ok({ a: 1 }, 'Summary');
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.content).toHaveLength(1);
    const text = (r.content[0] as { text: string }).text;
    expect(text.startsWith('Summary\n')).toBe(true);
    expect(text).toContain('"a": 1');
  });

  it('ok wraps non-object data in { result }', () => {
    expect(ok([1, 2], 'x').structuredContent).toEqual({ result: [1, 2] });
    expect(ok('s', 'x').structuredContent).toEqual({ result: 's' });
  });

  it('fail sets isError', () => {
    const r = fail('bad');
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe('bad');
  });

  it('run converts PodiumError into an isError result', async () => {
    const r = await run('never', async () => {
      throw new PodiumError({ status: 404, method: 'GET', path: '/api/x', body: 'missing' });
    });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/GET \/api\/x/);
    expect((r.content[0] as { text: string }).text).toMatch(/404/);
  });

  it('run converts other errors into an isError result', async () => {
    const r = await run('never', async () => {
      throw new Error('boom');
    });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/boom/);
  });

  it('run supports a summary function receiving the data', async () => {
    const r = await run((d) => `got ${(d as { n: number }).n}`, async () => ({ n: 3 }));
    expect((r.content[0] as { text: string }).text.startsWith('got 3\n')).toBe(true);
  });
});
