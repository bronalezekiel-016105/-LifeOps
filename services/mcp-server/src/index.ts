/**
 * LifeOps MCP server — HTTP entry point.
 *
 * Exposes:
 *   - GET  /healthz        health check for AgentCore / ALB
 *   - GET  /               server card (name, version, MCP endpoint)
 *   - POST /mcp            MCP over Streamable HTTP (initialize + calls)
 *   - GET  /mcp            MCP server→client SSE stream (per session)
 *   - DELETE /mcp          explicit session termination
 *
 * Security posture (spec §23):
 *   - Helmet default headers
 *   - CORS allowlist from config
 *   - Origin validation for MCP requests (mitigates DNS-rebinding)
 *   - Optional shared secret via X-LifeOps-Api-Key
 *   - Per-session McpServer + StreamableHTTPServerTransport (CVE-2026-25536)
 */
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { createMcpServer } from './server.js';
import { database } from './services/database.js';

// -----------------------------------------------------------------------------
// Session registry — one transport per Mcp-Session-Id.
// -----------------------------------------------------------------------------

interface Session {
  transport: StreamableHTTPServerTransport;
  createdAt: number;
}
const sessions = new Map<string, Session>();

function reapStaleSessions(maxAgeMs = 60 * 60_000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) {
      s.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}
setInterval(reapStaleSessions, 10 * 60_000).unref();

// -----------------------------------------------------------------------------
// Ensure demo user exists so first-run experiences work.
// -----------------------------------------------------------------------------

database.ensureUser('demo-user', 'Demo User');

// -----------------------------------------------------------------------------
// Express app.
// -----------------------------------------------------------------------------

const app = express();

// Trust the first proxy hop when deployed behind ALB/AgentCore.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(
  cors({
    origin(origin, callback) {
      // No-origin requests (curl, server-to-server) are permitted.
      if (!origin) return callback(null, true);
      if (config.server.allowedOrigins.includes('*')) return callback(null, true);
      if (config.server.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed`));
    },
    exposedHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Mcp-Session-Id',
      'MCP-Protocol-Version',
      'X-LifeOps-Api-Key',
      'X-LifeOps-User',
      'Authorization',
    ],
  })
);

// -----------------------------------------------------------------------------
// Public endpoints.
// -----------------------------------------------------------------------------

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: config.mcp.serverName,
    version: config.mcp.serverVersion,
    mcpProtocolVersion: config.mcp.protocolVersion,
    demoMode: config.demoMode,
    bedrock: config.aws.bedrockEnabled ? 'configured' : 'fallback',
    sessions: sessions.size,
  });
});

app.get('/', (_req, res) => {
  res.json({
    name: config.mcp.serverName,
    version: config.mcp.serverVersion,
    description: 'LifeOps MCP server — Ambient AI productivity assistant.',
    mcpEndpoint: config.server.mcpPath,
    transport: 'streamable-http',
    protocolVersion: config.mcp.protocolVersion,
    documentation: 'https://github.com/your-org/lifeops-amazon-hackathon',
  });
});

// -----------------------------------------------------------------------------
// Auth guard — optional shared secret.
// -----------------------------------------------------------------------------

function requireApiKey(req: Request, res: Response): boolean {
  if (!config.server.apiKey) return true;
  const provided = req.header('X-LifeOps-Api-Key');
  if (provided && provided === config.server.apiKey) return true;
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized: missing or invalid X-LifeOps-Api-Key.' },
    id: null,
  });
  return false;
}

// -----------------------------------------------------------------------------
// MCP endpoint — POST /mcp
// Handles initialize AND subsequent JSON-RPC calls.
// -----------------------------------------------------------------------------

app.post(config.server.mcpPath, async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const sessionId = req.header('Mcp-Session-Id');
  const requestId = randomUUID().slice(0, 8);
  const rpcMethod = typeof req.body?.method === 'string' ? req.body.method : 'unknown';

  const started = Date.now();
  logger.info({ requestId, sessionId, rpcMethod }, 'mcp POST');

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessions.has(sessionId)) {
      transport = sessions.get(sessionId)!.transport;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Fresh initialization — mint a session, own McpServer, own transport.
      const server = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          sessions.set(newId, { transport, createdAt: Date.now() });
          logger.info({ requestId, sessionId: newId }, 'session initialized');
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          logger.info({ sessionId: transport.sessionId }, 'session closed');
        }
      };
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Bad request: no Mcp-Session-Id and body is not an initialize request.',
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
    logger.info(
      { requestId, rpcMethod, ms: Date.now() - started, status: res.statusCode },
      'mcp POST done'
    );
  } catch (err) {
    logger.error(
      { requestId, err: (err as Error).message, stack: (err as Error).stack },
      'mcp POST failed'
    );
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

/** Shared handler for the SSE (GET) and termination (DELETE) verbs. */
async function handleSessionRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.header('Mcp-Session-Id');
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send('Invalid or missing Mcp-Session-Id');
    return;
  }
  await sessions.get(sessionId)!.transport.handleRequest(req, res);
}

app.get(config.server.mcpPath, async (req, res) => {
  if (!requireApiKey(req, res)) return;
  await handleSessionRequest(req, res);
});

app.delete(config.server.mcpPath, async (req, res) => {
  if (!requireApiKey(req, res)) return;
  await handleSessionRequest(req, res);
});

// -----------------------------------------------------------------------------
// Boot.
// -----------------------------------------------------------------------------

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(
    {
      host: config.server.host,
      port: config.server.port,
      mcpPath: config.server.mcpPath,
      protocolVersion: config.mcp.protocolVersion,
      demoMode: config.demoMode,
      bedrock: config.aws.bedrockEnabled,
    },
    'LifeOps MCP server listening'
  );
});

// -----------------------------------------------------------------------------
// Graceful shutdown.
// -----------------------------------------------------------------------------

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    for (const [id, s] of sessions) {
      s.transport.close().catch(() => {});
      sessions.delete(id);
    }
    database.close();
    process.exit(0);
  });
  // Force-exit if graceful takes too long.
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log truly unexpected errors, but don't crash the process on a single bad tool call.
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandledRejection');
});
