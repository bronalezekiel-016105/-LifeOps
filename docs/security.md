# Security

## Principles

- **No secrets in Git.** `.gitignore` blocks all `.env` variants except `.env.example`, all `*.key`, `*.pem`, and `credentials`. If you accidentally commit a secret, treat it as compromised: rotate immediately.
- **Env-driven configuration.** Every credential and toggle is read from the environment at boot, validated with Zod, and refused if malformed.
- **Least privilege in AWS.** No long-lived AWS credentials. In deployed environments, the container reads from an IAM role. See `docs/aws.md` for the least-privilege policy.
- **Log redaction.** Pino redacts `authorization`, `cookie`, `x-lifeops-api-key`, and any field named `accessKeyId`, `secretAccessKey`, `sessionToken`, `token`, `password`, or `apiKey`.
- **No stack traces to users.** The web BFF returns `{ error: message }`. The MCP server returns JSON-RPC error bodies. Stack traces stay server-side.

## Threat model (MCP surface)

- **Cross-client data leak.** Mitigated by per-session `McpServer` + `StreamableHTTPServerTransport` instances (CVE-2026-25536 pattern). Required by SDK ≥1.26.0.
- **DNS rebinding on `/mcp`.** Mitigated by CORS allowlist and the SDK's own `Origin` header check.
- **Session hijacking.** Session IDs are 128-bit random UUIDs. In production, layer OAuth 2.0 on top and treat the `Mcp-Session-Id` as short-lived per-client state.
- **Replay of destructive tool calls.** `create_reminder` refuses times more than 24 hours in the past. `complete_task` is idempotent. Consequential tools are annotated `destructiveHint: false / readOnlyHint: false / idempotentHint: true` where accurate — Alexa+ uses these hints when deciding whether to require confirmation.
- **Rate limiting.** Not implemented in this iteration. Documented as a follow-up. Options:
  - AgentCore Runtime request quotas at the platform layer.
  - `express-rate-limit` per-IP + per-session inside the Node process.
  - API Gateway if you front the runtime with one.

## Authentication

### Demo mode (default)

- Optional `X-LifeOps-Api-Key` header — if `LIFEOPS_API_KEY` env var is set, every non-health request must present it. Off by default so `npm run dev` works out of the box.
- All requests act on `demo-user` unless the client overrides via the tool argument.
- **This is not production-grade.** The docs say so; the UI shows the `Demo Mode` chip.

### Production mode (documented, not implemented in this submission)

Replace the API-key guard with an OAuth 2.0 resource server:

1. Client (Alexa+ or web) obtains a bearer token from your identity provider (Cognito / Auth0 / Amazon-issued).
2. LifeOps validates the JWT — signature, `aud`, `iss`, `exp`.
3. `userId` is derived from the token's `sub`.
4. Tools receive that `userId`; the client cannot lie about who they are.

Sketch of the middleware:

```ts
app.use('/mcp', async (req, res, next) => {
  const token = req.header('Authorization')?.replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'missing bearer' });
  try {
    const claims = await verifyJwt(token, JWKS_URL, { audience: AUDIENCE });
    (req as any).userId = claims.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid bearer' });
  }
});
```

Tool handlers then read `req.userId` instead of trusting `arguments.userId`.

## Data at rest

- **Local:** SQLite file in `services/mcp-server/data/`. Ignored by Git.
- **Cloud:** Recommended DynamoDB with encryption at rest (default) and point-in-time recovery.

## Data in transit

- Local: plain HTTP is fine (`localhost`).
- Production: HTTPS everywhere. AgentCore Runtime terminates TLS at the platform edge. If you self-host outside AgentCore, put an ALB or API Gateway in front with an ACM certificate.

## Dependency security

Run `npm audit` before every release. `@modelcontextprotocol/sdk` must be `>=1.26.0` — the version we pin (`^1.30.0`) is above this floor and includes the CVE-2026-25536 fix.
