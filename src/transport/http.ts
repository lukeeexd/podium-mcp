import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { log } from '../log.js';

/** Sessions untouched for this long are closed by the sweeper. */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
/** How often the sweeper looks for idle sessions. */
export const SESSION_SWEEP_INTERVAL_MS = 60_000;
/** Hard cap on concurrent sessions; new initialize requests are refused above it. */
export const MAX_SESSIONS = 100;

export interface HttpDeps {
  buildServer: () => McpServer;
  authToken?: string;
  /** Idle timeout before a session is swept. Defaults to DEFAULT_SESSION_TTL_MS. */
  sessionTtlMs?: number;
}

/** The Express app, plus a hook so the idle sweep can be triggered deterministically in tests. */
export type HttpApp = express.Express & { sweepSessions: (now?: number) => void };

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

function safeEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on length mismatch, and the length itself is not a secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const presented = /^bearer\s+(.+)$/i.exec(req.header('authorization') ?? '')?.[1];
    if (presented !== undefined && safeEqual(presented, token)) {
      next();
      return;
    }
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  };
}

export function createHttpApp(deps: HttpDeps): HttpApp {
  const app = express() as HttpApp;
  app.disable('x-powered-by');

  // Registered before any auth so health checks never need a token.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Auth runs before body parsing so unauthenticated bodies are never parsed.
  if (deps.authToken) app.use('/mcp', bearerAuth(deps.authToken));
  app.use('/mcp', express.json({ limit: '4mb' }));

  const ttlMs = deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessions = new Map<string, Session>();

  function closeSession(id: string, session: Session, reason: string): void {
    sessions.delete(id);
    log.debug('session closed', { id, reason });
    void session.transport.close().catch((e: unknown) => {
      log.debug('session close failed', e instanceof Error ? e.message : e);
    });
  }

  // The SDK only fires onsessionclosed/onclose on an explicit DELETE /mcp; a client that
  // drops its socket leaves the session behind, so idle sessions must be swept explicitly.
  app.sweepSessions = (now = Date.now()): void => {
    for (const [id, session] of sessions) {
      if (now - session.lastSeen > ttlMs) closeSession(id, session, 'idle');
    }
  };

  const sweeper = setInterval(() => {
    app.sweepSessions();
  }, SESSION_SWEEP_INTERVAL_MS);
  sweeper.unref();

  app.all('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) existing.lastSeen = Date.now();
    let transport = existing?.transport;

    if (!transport) {
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null });
        return;
      }
      app.sweepSessions();
      if (sessions.size >= MAX_SESSIONS) {
        log.warn(`refusing new session: ${MAX_SESSIONS} sessions already open`);
        res.status(503).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Server busy: too many sessions' }, id: null });
        return;
      }
      // DNS-rebinding protection stays off: it needs per-deployment allowedHosts. No CORS
      // headers are set, so a browser cannot reach /mcp cross-origin; bearer auth is the
      // intended protection for non-browser clients.
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport: created, lastSeen: Date.now() });
          log.debug('session started', { id });
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
          log.debug('session closed', { id, reason: 'client delete' });
        },
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
      };
      created.onerror = (e) => log.debug('transport error', e instanceof Error ? e.message : e);
      // The Node transport exposes `onclose` as an accessor typed `(() => void) | undefined`,
      // which `exactOptionalPropertyTypes` rejects against Transport's optional `onclose?`.
      // The shapes are otherwise identical, so cast at the boundary.
      await deps.buildServer().connect(created as Transport);
      transport = created;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      log.warn('MCP request failed', e instanceof Error ? e.message : e);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    } finally {
      const id = transport.sessionId;
      const session = id ? sessions.get(id) : undefined;
      if (session) session.lastSeen = Date.now();
    }
  });

  return app;
}

export function startHttp(deps: HttpDeps & { port: number }): Promise<Server> {
  const app = createHttpApp(deps);
  return new Promise((resolve) => {
    const server = app.listen(deps.port, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : deps.port;
      log.info(`podium-mcp listening on http://0.0.0.0:${port}/mcp (auth ${deps.authToken ? 'enabled' : 'disabled'})`);
      if (!deps.authToken) {
        log.warn('/mcp is unauthenticated: anyone who can reach this port can drive Podium. Set MCP_AUTH_TOKEN unless the port is bound to localhost only.');
      }
      resolve(server);
    });
  });
}
