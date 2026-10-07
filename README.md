# LifeOps — Ambient AI Assistant

> **One natural-language request → multi-tool orchestration → real action.**

Submission to the **Amazon Developer Hackathon 2026**.
Primary track: **Alexa+**. Mini challenge: **AWS Builder**.

LifeOps is a self-hosted MCP server (protocol `2025-11-25`, Streamable HTTP) plus a polished web dashboard that lets a user say things like _"Plan my afternoon"_ or _"Remind me to submit the proposal 30 minutes before my meeting"_ and have the assistant coordinate tasks, calendar, reminders, and Amazon Bedrock to actually get things done.

---

## Problem

Modern life is fragmented across too many tools. A chatbot that lists your tasks doesn't solve that — the user still has to reconcile everything. LifeOps demonstrates the agentic alternative: understand intent, gather context by calling multiple tools, reason across the results, and take action.

Full write-up: [`docs/problem.md`](docs/problem.md).

## Solution

- A single MCP endpoint (`POST /mcp`) that speaks the current protocol and exposes 7 useful tools.
- A deterministic planning engine that always produces a valid, actionable plan — reliability first.
- Amazon Bedrock (Converse API) enriches the summary in natural language. If Bedrock is unavailable, the demo does not break.
- A web dashboard that shows the actual tool orchestration in an Activity pane — no exposed chain-of-thought, just what got called.

## Key features

- **Natural-language commands** — "Plan my afternoon", "Remind me about X before my meeting", "Summarize my day".
- **Multi-step tool orchestration** visible to the user.
- **Reliable planner** — always produces a plan, with or without AI.
- **Amazon Bedrock integration** — safe, narrow use of the Converse API for the summary rewrite. Deterministic fallback.
- **Demo Mode** — clearly indicated in the UI. No real notifications sent, no destructive actions without confirmation.
- **Real MCP server** — `@modelcontextprotocol/sdk@^1.30.0`, Streamable HTTP, per-session isolation (CVE-2026-25536 safe), protocol `2025-11-25`, all 7 tools tested via the official client SDK.

## Architecture

```
Alexa+  ─┐
         ├─▶  Streamable HTTP  ─▶  LifeOps MCP server  ─▶  Tool registry ─┬─▶  Planner (deterministic)
Web UI ──┘                                                                ├─▶  Amazon Bedrock (enriched summary)
                                                                          └─▶  SQLite / DynamoDB
```

Full diagrams, session lifecycle, and data flow: [`docs/architecture.md`](docs/architecture.md).

## Tech stack

| Layer | Choice |
|---|---|
| MCP server | Node.js 20+, TypeScript strict, `@modelcontextprotocol/sdk@^1.30.0`, Express, Zod, pino |
| Transport | Streamable HTTP (MCP protocol `2025-11-25`) |
| Storage (local) | SQLite via `better-sqlite3` |
| Storage (cloud) | DynamoDB (documented, same `DatabaseService` interface) |
| AI | Amazon Bedrock Converse API — `@aws-sdk/client-bedrock-runtime` |
| Web SPA | Vite + React 18 + Tailwind CSS |
| Web BFF | Express + MCP TypeScript client |
| Testing | Vitest (unit + MCP integration) + Node smoke + Node E2E |
| Container | Multi-stage Docker (`node:22-slim`, non-root, tini, healthcheck) |

## MCP tools

| Tool | Purpose | Read-only |
|---|---|:-:|
| `get_tasks` | Retrieve tasks by user/date/status/priority. | ✓ |
| `get_schedule` | Retrieve calendar events by date or time range. | ✓ |
| `get_productivity_insights` | Overdue tasks, calendar conflicts, free periods, overload flag. | ✓ |
| `summarize_day` | Concise day summary. | ✓ |
| `generate_daily_plan` | Structured plan for the day, optionally enriched by Bedrock. | ✓ |
| `create_reminder` | Create a reminder. Validates the time is not >24h in the past. | |
| `complete_task` | Mark a task complete. Idempotent. | |

Full JSON Schemas: `services/mcp-server/src/tools/*.ts`. Description of each and the annotations Alexa+ reads: [`docs/mcp.md`](docs/mcp.md).

## Agentic workflow

Every user request creates an **activity feed** — an ordered `{tool, ok, ms, message}` list showing what the orchestrator did. Example for "Plan my afternoon":

```
✓ Retrieved today's tasks              get_tasks · 3ms
✓ Checked calendar                     get_schedule · 2ms
✓ Analyzed available time and conflicts get_productivity_insights · 2ms
✓ Generated a plan                     generate_daily_plan · 4ms
```

This is what the "Activity" pane in the UI shows. It is deliberately **not** the model's chain-of-thought.

## Amazon Bedrock

Used only to rewrite the plan summary in natural language. Never to invent tasks, times, or IDs. 10-second hard timeout, automatic fallback to the deterministic planner. Set `BEDROCK_MODEL_ID` in `services/mcp-server/.env` to enable; leave empty for the deterministic path. See [`docs/aws.md`](docs/aws.md).

## AWS architecture

See [`docs/aws.md`](docs/aws.md) and [`docs/deployment.md`](docs/deployment.md). Services used with real purposes: Bedrock (AI), AgentCore Runtime (deployment target), DynamoDB (documented storage swap), CloudWatch (structured logs), IAM (execution role). We deliberately did **not** add S3 or Lambda where they'd only be decorative.

## Alexa+ integration

See [`docs/alexa-plus.md`](docs/alexa-plus.md). LifeOps ships everything an Alexa+ onboarding needs on our side: the correct transport, protocol version, tool schemas, and tool descriptions written for an AI agent to consume.

## Local setup

Requires Node ≥20, npm ≥10. No Docker or AWS credentials needed for local dev.

```bash
git clone <this repo> lifeops-amazon-hackathon
cd lifeops-amazon-hackathon
npm install --workspaces --include-workspace-root
cp .env.example .env
cp services/mcp-server/.env.example services/mcp-server/.env
cp apps/web/.env.example apps/web/.env
npm run seed        # loads demo-user, tasks, events
npm run dev         # starts MCP server (8000), BFF (5174), Vite (5173)
```

Open http://localhost:5173.

Full guide: [`docs/local-development.md`](docs/local-development.md).

## Environment variables

Every knob is env-driven. See `.env.example` files in the repo root, `services/mcp-server/`, and `apps/web/`. Never commit real values.

## Running tests

```bash
npm test                   # 15 tests: planner units + MCP integration
node tests/e2e.ts          # full pipeline: SPA→BFF→MCP→tools→DB (16 assertions)
```

Test strategy: [`docs/testing.md`](docs/testing.md).

## Docker

```bash
docker build -f services/mcp-server/Dockerfile -t lifeops/mcp-server:0.1.0 .
docker run --rm -p 8000:8000 lifeops/mcp-server:0.1.0
```

Or `docker compose up`. The image listens on `0.0.0.0:8000` at `/mcp` — the AgentCore Runtime convention.

_Status: written and reviewed against the SDK's compiled ESM output; not built in the hackathon dev environment because no Docker is installed. See `docs/friction-log.md`._

## AWS deployment

Runbook: [`docs/deployment.md`](docs/deployment.md). ECR → AgentCore Runtime → Alexa+.
_Not executed from the hackathon dev environment (no AWS CLI, no credentials). Verified against current AgentCore Runtime documentation._

## Demo

Two demo scenarios, both fully working:

**1. "Plan my afternoon."**

- Retrieves tasks, schedule, and productivity insights in parallel.
- Generates a structured plan with priority-first ordering and 5-minute buffers.
- Reports conflicts and unplaced tasks in a warnings pane.

**2. "Remind me to submit the proposal 30 minutes before my meeting."**

- Retrieves schedule, locates the next upcoming meeting.
- Computes the reminder time in application code (never trusts the model).
- Creates the reminder anchored to the event.
- Displays confirmation with the exact scheduled time.

Both scenarios pass the automated E2E test.

## Screenshots

Placeholder — record from a live `npm run dev` session. The UI has:

- Header with `● Connected` and a `Demo Mode` chip.
- A large AI Command box with example prompts.
- A Plan section with a timeline of colored blocks (events vs. tasks).
- Today panels for Upcoming events and Reminders.
- A Tasks list with priority chips and "Mark done" buttons.
- An Activity pane on the right showing the tool orchestration.
- An At-a-glance panel with pending count, completed count, free minutes, and pending workload.

## Security

See [`docs/security.md`](docs/security.md). Highlights: per-session MCP transport (CVE-safe), env-driven config, log redaction, no stack traces to users, documented OAuth 2.0 migration path.

## Project structure

```
lifeops-amazon-hackathon/
├── apps/
│   └── web/                            # Vite + React SPA + Express BFF
│       ├── server/index.ts             # BFF: MCP client + REST for the SPA
│       ├── src/                        # React app
│       └── package.json
├── services/
│   └── mcp-server/                     # THE MCP server (Alexa+ endpoint)
│       ├── src/
│       │   ├── config.ts               # Zod-validated env
│       │   ├── index.ts                # Express + Streamable HTTP transport
│       │   ├── server.ts               # McpServer factory + tool registry
│       │   ├── lib/logger.ts           # pino with secret redaction
│       │   ├── types/domain.ts         # Shared domain types
│       │   ├── tools/                  # 7 MCP tools
│       │   ├── services/
│       │   │   ├── bedrock.ts          # Amazon Bedrock (Converse) + fallback
│       │   │   ├── database.ts         # DatabaseService (SQLite; DynamoDB-ready)
│       │   │   └── planner.ts          # Deterministic planning engine
│       │   └── scripts/                # seed + demo:reset
│       ├── tests/                      # Vitest unit + MCP integration
│       ├── Dockerfile                  # multi-stage, non-root, healthcheck
│       └── package.json
├── infrastructure/aws/                 # placeholder for IaC (see docs/deployment.md)
├── docs/                               # 10 docs
├── scripts/
├── tests/e2e.ts                        # SPA→BFF→MCP full-pipeline test
├── .env.example
├── .gitignore
├── .dockerignore
├── LICENSE
├── README.md
├── docker-compose.yml
└── package.json                        # npm workspaces
```

## Troubleshooting

See the tail of [`docs/local-development.md`](docs/local-development.md). Most-common issues: port 8000 in use, BFF not running, `better-sqlite3` build failure on old Node versions.

## Hackathon track

- **Primary track:** Alexa+ (self-hosted MCP server + web demo). Protocol version `2025-11-25`, Streamable HTTP, all tool descriptions and schemas written for agent consumption.
- **Mini challenge:** AWS Builder. Amazon Bedrock is used with a real purpose; AgentCore Runtime is the documented deployment target; DynamoDB migration path is designed into the storage interface; CloudWatch consumes our structured logs unchanged. No decorative services.

## AWS Builder mini challenge

Real uses of AWS, not decoration:

| Service | Usage | Status |
|---|---|---|
| Amazon Bedrock (Converse) | Summary rewrite | Implemented; fallback path tested; real invocation not tested here (no creds) |
| Amazon Bedrock AgentCore Runtime | Deployment target | Documented runbook; not deployed |
| Amazon DynamoDB | Cloud storage; swappable through `DatabaseService` | Documented schema; not deployed |
| Amazon CloudWatch | Structured JSON logs (pino) — CloudWatch-compatible without code changes | Local runs verified |
| AWS IAM | Container's execution role — no long-lived credentials | Least-privilege policy documented |

## License

MIT — see [`LICENSE`](LICENSE).

## Honest status matrix

| Component | Implemented | Tested here |
|---|:-:|:-:|
| MCP server, Streamable HTTP, protocol 2025-11-25 | ✓ | ✓ (real handshake, all 7 tools) |
| Per-session transport isolation (CVE-safe) | ✓ | ✓ |
| All 7 MCP tools with schemas + annotations | ✓ | ✓ |
| Deterministic planner | ✓ | ✓ (9 unit tests) |
| Amazon Bedrock (Converse) integration | ✓ | Fallback ✓; live call not tested (no AWS creds here) |
| SQLite storage | ✓ | ✓ |
| DynamoDB storage | Documented | ✗ |
| Web SPA (React + Vite + Tailwind) | ✓ | ✓ (builds; loads against live BFF) |
| Web BFF orchestrator | ✓ | ✓ (E2E) |
| Two Alexa+ acceptance scenarios | ✓ | ✓ |
| Dockerfile | ✓ | ✗ (no Docker in dev env) |
| AWS deployment | Documented runbook | ✗ |
| Alexa+ live handshake | Documented onboarding | ✗ (requires Amazon-issued OAuth registration) |
