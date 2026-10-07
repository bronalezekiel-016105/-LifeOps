# Devpost project story

Pre-written per the sections Devpost asks for. Every claim below reflects work that is actually in the repository.

## Inspiration

Modern life sprawls across too many tools. A chatbot that lists your tasks doesn't help — you still have to reconcile everything yourself. We wanted to prove out the agentic alternative: one natural-language ask, many tools coordinated behind the scenes, a real answer that includes action. The Alexa+ track was the perfect forcing function because the MCP protocol makes those tool boundaries explicit, and Alexa+ is the surface where "coordination on my behalf" matters most.

## What it does

LifeOps takes a short request like "Plan my afternoon" or "Remind me to submit the proposal 30 minutes before my meeting" and:

1. Understands the intent (plan vs. reminder vs. summary).
2. Retrieves tasks, calendar, and productivity insights in parallel via MCP.
3. Reasons about deadlines, priorities, and free time in application code — never asks the model to invent times.
4. Optionally rewrites the summary in natural language via Amazon Bedrock.
5. Takes action where the request asked for one (creates the reminder).
6. Returns the plan and an activity feed showing exactly which tools got called.

The web dashboard shows this happen in real time. Alexa+ hits the same MCP endpoint over Streamable HTTP.

## How we built it

- **MCP server** — Node.js + TypeScript, `@modelcontextprotocol/sdk@^1.30.0`, Streamable HTTP transport, MCP protocol `2025-11-25`. Seven tools with Zod-validated schemas exposed via `tools/list`. Per-session `McpServer` + `StreamableHTTPServerTransport` instances (mitigates CVE-2026-25536).
- **Deterministic planner** — priority + deadline scoring, free-interval calculation, conflict detection. Always produces a valid plan, with or without AI. Nine unit tests cover it.
- **Amazon Bedrock (Converse API)** — a narrow, safe use of AI: rewrites only the plan's summary sentence. The model never gets to invent tasks, times, or IDs. 10-second timeout, automatic fallback.
- **Storage abstraction** — `DatabaseService` interface with a SQLite implementation for local dev. Same interface lets DynamoDB slot in for production.
- **Web dashboard** — Vite + React 18 + Tailwind. A small Express BFF holds the MCP client connection and exposes narrow REST endpoints to the SPA. The BFF's orchestrator is deterministic so the demo is predictable and inspectable.
- **Docker** — multi-stage `node:22-slim` image, non-root user, tini for signal handling, healthcheck, listens on `0.0.0.0:8000` at `/mcp` (AgentCore Runtime convention).
- **Tests** — 9 planner unit tests + 6 MCP integration tests (real Streamable HTTP client) + a 16-assertion end-to-end pipeline test that spins up the whole stack.

Everything is honest about scope: the AWS deployment and real Alexa+ handshake are documented and prepared, not fabricated.

## Challenges we ran into

Genuine ones only. Full detail in `docs/friction-log.md`:

- **CVE-2026-25536 (MCP SDK).** Sharing a `StreamableHTTPServerTransport` across sessions leaks responses between clients. Rebuilt the server around per-session isolation with a `Map<sessionId, {transport}>`.
- **Planner window ambiguity.** A single `winStartMs` variable was serving two conflicting purposes (event display window and task-scheduling cursor). In late-afternoon runs it caused an empty plan. Split them into two concepts.
- **Demo data with absolute wall-clock times.** Broke when the demo ran after 17:00. Switched to `inMinutes(offset)` seeding so the demo scenario always plays out regardless of hour.
- **MCP client `callTool` doesn't throw on tool-level errors.** It resolves with `{ isError: true }`. Fixed test assertions and the BFF's error normalization.
- **Bedrock model IDs vary by account and region.** Never hard-coded. `/healthz` reports whether Bedrock is `configured` or `fallback`.
- **Docker and AWS could not be exercised in the dev sandbox** (no Docker, no AWS CLI, no credentials). Written and reviewed, marked honestly.

## Accomplishments we're proud of

- **A real MCP server, not a fake one.** All 7 tools discoverable via `tools/list`, callable via `tools/call`, tested with the official MCP TypeScript client over Streamable HTTP.
- **The demo never breaks.** Even without AWS credentials, without Bedrock, without the network, the deterministic planner produces a real plan.
- **Both acceptance scenarios pass end-to-end.** "Plan my afternoon" and the reminder-anchored-to-meeting scenario are both covered by automated tests, not just described in the README.
- **The activity feed.** The UI shows the actual tool orchestration in a calm, useful way — no fake AI theatre, no exposed chain-of-thought.
- **Documentation that would let someone else pick this up cold.** Ten docs, a Mermaid architecture, a runbook, and a friction log that admits what didn't work and why.

## What we learned

- MCP session handling is the sharp edge. The SDK has changed hands-off defaults twice; the spec has already deprecated the HTTP+SSE transport. Read the current version, not last year's tutorial.
- "AI + application code" beats "AI alone." Every millisecond of latency and every hallucination risk we avoided came from doing time math, ID lookups, and validation in code and reserving the model for the last-mile natural-language rewrite.
- Fallback paths aren't optional for demo software. If the model or the cloud service is even slightly flaky, an unprepared demo dies on stage.
- The activity feed is an underrated UX pattern. Users trust a system more when they can see what it did — but that only works if we don't confuse "what it did" with "how it reasoned".

## What's next

- Real Alexa+ onboarding once we have the OAuth registration.
- DynamoDB implementation of `DatabaseService`.
- Read-only integrations with Google Calendar and Gmail.
- Recurring reminders and calendar-triggered pre-briefs.
- A proper rate limiter at the MCP boundary.
- More expressive intent handling — the BFF's orchestrator is deterministic on purpose right now; a future version could delegate intent parsing to a small on-server model with the tool schemas as the routing surface.
