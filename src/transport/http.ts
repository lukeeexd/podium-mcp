import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { log } from '../log.js';

export interface HttpDeps {
  buildServer: () => McpServer;
  authToken?: string;
}

function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    if (header === `Bearer ${token}`) {
      next();
      return;
    }
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  };
}

export function createHttpApp(deps: HttpDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  if (deps.authToken) app.use('/mcp', bearerAuth(deps.authToken));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.all('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null });
        return;
      }
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, created);
          log.debug('session started', { id });
        },
        onsessionclosed: (id) => {
          transports.delete(id);
          log.debug('session closed', { id });
        },
      });
      created.onclose = () => {
        if (created.sessionId) transports.delete(created.sessionId);
      };
      // The Node transport exposes `onclose` as an accessor typed `(() => void) | undefined`,
      // which `exactOptionalPropertyTypes` rejects against Transport's optional `onclose?`.
      // The shapes are otherwise identical, so cast at the boundary.
      await deps.buildServer().connect(created as Transport);
      transport = created;
    }

    await transport.handleRequest(req, res, req.body);
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
      resolve(server);
    });
  });
}
