# MCP implementation

LifeOps ships a real self-hosted MCP server that satisfies the Alexa+ track requirements.

## Contract

| | |
|---|---|
| **Protocol version** | `2025-11-25` |
| **Transport** | Streamable HTTP |
| **Endpoint** | `POST /mcp`, `GET /mcp` (SSE), `DELETE /mcp` (session terminate) |
| **Default port** | `8000` (matches AgentCore Runtime convention) |
| **Default host** | `0.0.0.0` when containerized |
| **Session management** | `Mcp-Session-Id` header, per-session isolation |
| **SDK** | `@modelcontextprotocol/sdk@^1.30.0` (≥1.26.0 for CVE-2026-25536 fix) |
| **Schema validation** | Zod, exposed as JSON Schema in `tools/list` |

## Tool catalog

All 7 tools carry MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so agents can reason about which are safe to call speculatively.

| Tool | Read-only | Idempotent | Purpose |
|---|:-:|:-:|---|
| `get_tasks` | ✓ | ✓ | Retrieve pending/completed tasks with filters. |
| `get_schedule` | ✓ | ✓ | Retrieve calendar events by date/time range. |
| `get_productivity_insights` | ✓ | ✓ | Overdue tasks, calendar conflicts, free periods, overload flag. |
| `summarize_day` | ✓ | ✓ | Concise day summary. |
| `generate_daily_plan` | ✓ |  | Compose a structured plan; optionally enrich summary via Bedrock. |
| `create_reminder` |  |  | Create a reminder. |
| `complete_task` |  | ✓ | Mark a task complete. Idempotent when already complete. |

Full input/output schemas are visible via `tools/list` and match the Zod schemas in `services/mcp-server/src/tools/`.

## Session lifecycle

1. Client POSTs `{method: "initialize"}` **without** an `Mcp-Session-Id`. The server allocates a fresh `McpServer` + `StreamableHTTPServerTransport`, connects them, and returns the assigned session id in the response header.
2. All subsequent client requests carry `Mcp-Session-Id: <id>`.
3. Client MAY GET `/mcp` with the session id to hold open an SSE stream for server-initiated notifications.
4. Client MAY DELETE `/mcp` with the session id to terminate.
5. Stale sessions are reaped after 60 minutes of inactivity.

## Why per-session isolation

CVE-2026-25536 (fixed in SDK 1.26.0) — sharing one `StreamableHTTPServerTransport` across sessions leaked responses between clients. LifeOps mints a new transport and a new `McpServer` for every session. See `services/mcp-server/src/index.ts::handleRequest`.

## Errors

- **Bad params (Zod)** — returned as `{ isError: true, content: [...], structuredContent: {error, details} }`. Not a JSON-RPC error, per current SDK convention.
- **Missing task / missing event** — same tool-error shape.
- **Reminders more than 24 hours in the past** — same shape.
- **Unknown tool** — SDK-level JSON-RPC error `-32601` (Method not found).
- **Bad initialize / bad session** — HTTP 400 with a JSON-RPC error body.

## Testing

- `tests/planner.test.ts` — 9 planner unit tests
- `tests/mcp-integration.test.ts` — 6 integration tests, actually connect via the official MCP TS client over Streamable HTTP, cover both spec §32 acceptance scenarios
- `tests/smoke.mjs` — 24-assertion smoke run

Run: `npm test` (from repo root or `services/mcp-server`).
