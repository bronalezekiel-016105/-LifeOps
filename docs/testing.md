# Testing strategy

LifeOps ships three layers of tests. Every layer is meaningful.

## 1. Unit tests — `services/mcp-server/tests/planner.test.ts`

Tests the deterministic planning engine in isolation. No network, no processes.

| # | Test |
|---|---|
| 1 | `computeFreeIntervals` returns the whole window when there are no events |
| 2 | `computeFreeIntervals` splits the window around an event |
| 3 | `computeFreeIntervals` ignores gaps shorter than 15 minutes |
| 4 | `detectConflicts` detects overlapping events |
| 5 | `detectConflicts` ignores back-to-back events |
| 6 | `buildDeterministicPlan` places high-priority tasks first |
| 7 | `buildDeterministicPlan` front-loads overdue tasks above high-priority-today |
| 8 | `buildDeterministicPlan` reports unplaced tasks in warnings |
| 9 | `buildDeterministicPlan` marks output as `deterministic` when Bedrock is off |

## 2. MCP integration tests — `services/mcp-server/tests/mcp-integration.test.ts`

Spawns the real MCP server, connects via the official `@modelcontextprotocol/sdk` client over Streamable HTTP, and exercises the tool surface end-to-end.

| # | Test |
|---|---|
| 1 | Exposes all 7 tools via `tools/list` |
| 2 | Reports server name and version |
| 3 | **Acceptance §32.1:** "Plan my afternoon" — retrieves tasks + schedule, produces structured plan with blocks and summary |
| 4 | **Acceptance §32.2:** Reminder anchored to an event — schedule fetched, meeting located, reminder created 30 min before |
| 5 | `complete_task` on a nonexistent task returns `isError: true` |
| 6 | `create_reminder` more than 24h in the past returns `isError: true` |

## 3. End-to-end pipeline test — `tests/e2e.ts`

Boots MCP server AND the web BFF, then exercises the REST endpoints that the SPA uses. This proves the whole stack: SPA → BFF → MCP → tools → DB.

| # | Assertion |
|---|---|
| 1–6 | `GET /api/today` returns tasks, schedule, insights, summary, and a 4-item activity feed |
| 7–11 | `POST /api/ask "Plan my afternoon"` orchestrates `get_tasks + get_schedule + get_productivity_insights + generate_daily_plan` and returns a populated plan |
| 12–14 | `POST /api/ask "Remind me to submit the proposal 30 minutes before my meeting"` locates the meeting and creates a reminder with the correct title |
| 15–16 | `POST /api/ask "Summarize my day"` returns a day summary |

## 4. Smoke test — `services/mcp-server/tests/smoke.mjs`

24-assertion runbook that can be run manually against a fresh checkout. Useful for reviewers.

## Running everything

From the repo root:

```bash
npm test                                   # 15 tests: unit + MCP integration
node tests/e2e.ts                          # end-to-end pipeline (16 assertions)
node services/mcp-server/tests/smoke.mjs   # optional 24-assertion smoke
```

## What isn't tested (honestly)

- **Real Bedrock invocations.** The deterministic fallback path is verified; the Bedrock happy path is not tested in CI because it needs AWS credentials. The Bedrock module has its own error handling and 10-second timeout.
- **Real Alexa+ handshake.** Requires an Amazon-issued OAuth registration and public HTTPS endpoint.
- **Docker image build.** Dockerfile is written but not built in the hackathon dev environment.
- **AgentCore Runtime deployment.** Documented in `docs/deployment.md`; not executed.

Each of these is called out in `docs/friction-log.md` as well.
