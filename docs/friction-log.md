# Friction log

Real problems encountered during development, honestly documented. No fabricated entries.

---

**Date:** 2026-09-21
**Component:** MCP TypeScript SDK — session isolation
**Problem:** Naive first-cut of the server used a single `McpServer` + `StreamableHTTPServerTransport` shared across sessions.
**Expected behavior:** Each session isolated.
**Actual behavior:** SDK ≥1.26.0 mitigates the cross-client leak (CVE-2026-25536) but only if the server code follows the per-session pattern.
**Error:** Would have manifested as intermittent response-crossing between concurrent clients, not caught until real users.
**What was attempted:** Searched npm and the SDK repo before writing a line of server code.
**Root cause:** CVE-2026-25536 — sharing a `StreamableHTTPServerTransport` across sessions leaks JSON-RPC IDs and their bodies to the wrong client.
**Solution:** Rebuilt `services/mcp-server/src/index.ts` around a `Map<sessionId, {transport}>`. Every `initialize` request mints a fresh `McpServer` + transport pair. Documented in `docs/security.md#threat-model-mcp-surface` and `docs/mcp.md#why-per-session-isolation`.
**Documentation reference:** [CVE-2026-25536 advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-345p-7cg4-v4c7), MCP TS SDK examples for `StreamableHTTPServerTransport`.
**Potential improvement:** Add stale-session reaping (done — 60 min TTL); add an integration test that fires concurrent client requests to demonstrate isolation.

---

**Date:** 2026-09-21
**Component:** better-sqlite3 type export
**Problem:** `tsc --noEmit` failed: `TS4023: Exported variable 'database' has or is using name 'BetterSqlite3.Database' from external module ... but cannot be named.`
**Expected behavior:** Clean typecheck.
**Actual behavior:** TypeScript couldn't emit a declaration file because `db` (a `Database` instance) leaked into the inferred type of `export const database`.
**What was attempted:** Removed `raw` from the export; caused churn downstream.
**Root cause:** The default export of `better-sqlite3` is a class (`Database`) and TypeScript's inference names it via the module path — but that module path isn't publicly importable at the type level in strict mode.
**Solution:** Explicitly imported `type Database as BetterSqliteDatabase` and typed the exported object with a named `DatabaseService` interface. Now `raw` has a nameable type and the declaration emit is clean.
**Documentation reference:** [TypeScript issue #5711](https://github.com/microsoft/TypeScript/issues/5711).
**Potential improvement:** None — the fix is idiomatic. Keeping the interface also makes it easier to swap SQLite for DynamoDB in production.

---

**Date:** 2026-09-21
**Component:** Deterministic planner — planning window shift
**Problem:** In late-afternoon runs, `plan.blocks` came back empty even though the seed had valid events.
**Expected behavior:** Events already on the calendar should always appear in the plan.
**Actual behavior:** The planner shifted `windowStartMs` forward to "now" when planning today, then filtered events against the shifted window, discarding all past-but-still-relevant events. When "now" pushed past `windowEndMs` (e.g. running the demo after 18:00), the gap list was empty and no events appeared.
**Error:** Test failure `plan has blocks` in the initial smoke run.
**What was attempted:** Debug logging → traced to the filter predicate.
**Root cause:** Overloaded meaning of `winStartMs` — one variable trying to serve as "start of the planning window" AND "start of the scheduling cursor". These are different concepts.
**Solution:** Split them. Event display uses the raw window (so scheduled events remain visible). Task scheduling uses the cursor. Added a warning when the cursor is past window end so users see why nothing was placed.
**Documentation reference:** Fix in `services/mcp-server/src/services/planner.ts`.
**Potential improvement:** Also seed events relative to "now" (done — see next entry) so the demo scenario always plays out.

---

**Date:** 2026-09-21
**Component:** Demo seed data — absolute times vs. wall-clock
**Problem:** Spec §13 lists event times as 13:00, 15:00, 16:30. If you run the demo at 17:00 those are all past and the "Plan my afternoon" prompt has nothing to reason about.
**Expected behavior:** Demo should work at any wall-clock hour.
**Actual behavior:** Broke when tested in the afternoon.
**What was attempted:** Considered locking the demo to a fake "now"; rejected — Alexa+ users won't have that luxury.
**Root cause:** Absolute wall-clock times in a demo dataset don't survive being run in real time.
**Solution:** Seed places events at 30 min, 2.5 h, and 4 h from `now()`. The spec's shape is preserved (three events, one is a "Team meeting", one is a "Client call") but the demo works at any hour. Rounded to the nearest quarter-hour so UI times read cleanly.
**Documentation reference:** `services/mcp-server/src/scripts/seed.ts`.
**Potential improvement:** Add a "seed with fixed times" mode for CI, and a "seed with relative times" mode for demo runs.

---

**Date:** 2026-09-21
**Component:** MCP client SDK — bad-args behaviour
**Problem:** Smoke test's assertion `bad args rejected by zod` expected `callTool` to throw when args failed Zod validation. It didn't — the assertion failed.
**Expected behavior:** Throwing on validation error.
**Actual behavior:** SDK returns `{ isError: true, content, structuredContent }` and resolves the promise. Only transport / protocol errors throw.
**What was attempted:** Read the SDK source at `node_modules/@modelcontextprotocol/sdk/client/index.js`.
**Root cause:** Test author (me) assumed throw semantics that only apply to unknown methods, not to tool-level errors.
**Solution:** Rewrote the assertion to accept either shape (throw OR `isError: true`) and made the primary path check `isError`.
**Documentation reference:** MCP SDK client API.
**Potential improvement:** Add a helper in the BFF that normalises both shapes.

---

**Date:** 2026-09-21
**Component:** Reminder title extractor
**Problem:** For "Remind me to submit the proposal 30 minutes before my meeting", the extractor captured `"submit the proposal 30 minutes"` including the timing suffix.
**Expected behavior:** Title should be `"submit the proposal"`.
**Actual behavior:** The regex's non-greedy match extended past the reminder subject.
**What was attempted:** Made the anchor stricter — didn't work because "before" could legitimately appear inside a title.
**Root cause:** Reminder timing modifiers (`N minutes before X`) look like part of the title unless explicitly stripped.
**Solution:** After the initial regex capture, strip a trailing ` \d+ (min|minutes|m)` pattern. Small, deterministic, no LLM needed for this.
**Documentation reference:** `apps/web/server/index.ts::extractReminderTitle`.
**Potential improvement:** A dedicated intent parser could handle more sophisticated phrasings, but the current cost/benefit is fine for the demo.

---

**Date:** 2026-09-21
**Component:** Hackathon dev environment — process supervision
**Problem:** Trying to leave the MCP server running as a background process between shell calls failed — the process was reaped as soon as the shell exited.
**Expected behavior:** `nohup & disown` should detach the child.
**Actual behavior:** Different bash tool invocations run in fresh shells and their process groups get cleaned up between calls.
**Error:** `curl: (7) Failed to connect to localhost port 8000: Connection refused` on the second call.
**What was attempted:** `nohup`, `disown`, output redirection.
**Root cause:** Sandbox process management, not a bug in the app.
**Solution:** Rewrote the integration test as a single Node script (`tests/smoke.mjs`, `tests/e2e.ts`) that spawns the server as a child process it owns for the lifetime of the test. This is the pattern the Vitest integration test also uses, and it's honestly cleaner: no orphan processes, no port conflicts across runs.
**Documentation reference:** N/A — an environment quirk, not a product issue.
**Potential improvement:** Ship a small `scripts/dev-supervisor.ts` that developers can use as a durable local supervisor if they want. Not needed for the submission.

---

**Date:** 2026-09-21
**Component:** Amazon Bedrock model ID
**Problem:** Tempted to hard-code a specific Bedrock model ID for the demo.
**Expected behavior:** Ship a config that works everywhere.
**Actual behavior:** Model IDs and availability vary by region and account. What runs in `us-east-1` this week may not be enabled for a reviewer's account.
**What was attempted:** Considered listing a "known-good" model as the default.
**Root cause:** Bedrock model access is per-account, per-region. Hard-coding creates silent failures.
**Solution:** Left `BEDROCK_MODEL_ID` unset by default and made the code path fall back to the deterministic planner. The `/healthz` endpoint reports whether Bedrock is `configured` or `fallback`. Docs (`docs/aws.md`) tell the operator to verify a model in their Bedrock console before setting the env var.
**Documentation reference:** [Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).
**Potential improvement:** Add a helper CLI (`npm run bedrock:probe`) that lists models available to the current caller. Deferred.

---

**Not in scope for the hackathon window (documented, not attempted):**

- Real Alexa+ handshake — requires Amazon-issued OAuth registration and a public HTTPS endpoint. Documented in `docs/alexa-plus.md`.
- Docker image build & AgentCore deployment — no Docker or AWS CLI in the hackathon dev environment. Written and reviewed, not executed. `docs/deployment.md` is the runbook.
