# Alexa+ integration

LifeOps is designed to connect to Alexa+ as a self-hosted MCP server. The MCP endpoint we ship is the endpoint Alexa+ talks to — no separate skill code, no Lambda glue in between.

## What Alexa+ requires

At the time of this submission (September 2026), Alexa+ accepts self-hosted MCP servers that satisfy:

- **MCP specification `2025-11-25` or later.** LifeOps advertises this version.
- **Streamable HTTP transport.** No old HTTP+SSE fallback needed; we don't ship it.
- **A publicly reachable HTTPS endpoint.** For a hackathon submission this typically means an AgentCore Runtime deployment or a Cloudflare/Ngrok tunnel to your machine during the demo.
- **A defensible authentication story.** LifeOps supports OAuth 2.0 in production (see below) and an optional `X-LifeOps-Api-Key` header for demos.
- **Well-described tools.** Every LifeOps tool has a human-readable `description`, `title`, and JSON Schema `inputSchema` derived from Zod, plus the standard MCP `annotations` for read-only/idempotent hints. This is exactly what Alexa+ reads to decide which tools to invoke.

Consult the current [Alexa+ documentation](https://www.developer.amazon.com/docs/alexaplus/) before submission — the on-ramp UI and OAuth requirements change frequently.

## What we validate ourselves

- `MCP-Protocol-Version` header handling — done by the SDK, verified by our integration tests.
- Session id lifecycle (`Mcp-Session-Id`) — verified.
- Tool discovery via `tools/list` — verified (`tests/mcp-integration.test.ts`).
- Tool invocation via `tools/call` — verified with 7-out-of-7 tools passing.
- Error paths (bad args, missing entities, past reminder times) — verified.

## What we cannot validate in the hackathon dev environment

- The actual Alexa+ handshake requires a registered application, a public HTTPS endpoint, and OAuth 2.0 client credentials that only Amazon can issue. We document the shape and expected flow below but cannot execute it from this environment.

Marked honestly in `docs/friction-log.md`.

## Recommended production onboarding flow

1. **Deploy the container to AgentCore Runtime.** See `docs/deployment.md`. You get an HTTPS URL of the form `https://runtime.bedrock-agentcore.<region>.amazonaws.com/runtimes/<id>/invocations`.
2. **Add OAuth 2.0.** For a real Alexa+ skill, users must be able to log in. Replace the demo `X-LifeOps-Api-Key` guard with an OAuth resource server that validates a bearer JWT and extracts `sub` as the `userId`. Cognito, Auth0, or Amazon-issued tokens all work. Update `services/mcp-server/src/index.ts::requireApiKey` accordingly.
3. **Register the MCP server with Alexa+** using the current Alexa+ developer console (URL and steps change; check documentation).
4. **Provide clear tool descriptions.** The descriptions LifeOps ships (`services/mcp-server/src/server.ts`) are written to be legible to an AI agent — for example:
   > "Retrieve pending and completed tasks for a user for a specified date and optional filters. Filters by status and priority are supported."
   Avoid vague descriptions; Alexa+ uses these to pick tools.
5. **Test with an Alexa+ device.** Prompts like "Ask LifeOps to plan my afternoon" or "Have LifeOps remind me to submit the proposal 30 minutes before my meeting" should work.

## Demo tool call shapes

For reference, these are the tool calls Alexa+ would make for the two acceptance scenarios:

**"Plan my afternoon."**

```json
[
  {"name": "get_tasks",       "arguments": {"userId": "<sub>"}},
  {"name": "get_schedule",    "arguments": {"userId": "<sub>"}},
  {"name": "generate_daily_plan", "arguments": {"userId": "<sub>", "userRequest": "Plan my afternoon."}}
]
```

**"Remind me to submit the proposal 30 minutes before my 4pm meeting."**

```json
[
  {"name": "get_schedule",   "arguments": {"userId": "<sub>"}},
  {"name": "create_reminder", "arguments": {
    "userId": "<sub>",
    "title": "Submit proposal",
    "reminderTime": "2026-09-21T15:30:00Z",
    "relatedEventId": "evt-…"
  }}
]
```

Alexa+ decides the ordering and reminder time from the tool schemas plus the model's own reasoning. LifeOps validates every parameter server-side — the model never gets to invent event IDs or reminder times that fall outside the sanity window.
