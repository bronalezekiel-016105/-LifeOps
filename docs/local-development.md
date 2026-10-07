# Local development

## Requirements

- Node.js ≥ 20
- npm ≥ 10
- No Docker required for dev — the server runs directly on Node.

## First-time setup

```bash
git clone <this repo>
cd lifeops-amazon-hackathon
npm install --workspaces --include-workspace-root

# Copy example envs
cp .env.example .env
cp services/mcp-server/.env.example services/mcp-server/.env
cp apps/web/.env.example apps/web/.env

# Seed the demo data
npm run seed
```

## Run everything

```bash
npm run dev
```

That starts:

| Process | URL | What it is |
|---|---|---|
| MCP server | http://localhost:8000/mcp | The real MCP endpoint — this is what Alexa+ talks to |
| BFF | http://localhost:5174/api/* | Express server that speaks MCP for the SPA |
| Vite dev server | http://localhost:5173 | The React SPA |

Open http://localhost:5173.

## Run pieces individually

```bash
npm run dev:mcp     # just the MCP server
npm run dev:web     # BFF + Vite
```

## Reset the demo

```bash
npm run demo:reset
```

Wipes the `demo-user` data and re-seeds. Non-demo users are untouched.

## Tests

```bash
npm test            # unit + MCP integration (9 + 6)
npm run test:mcp    # just MCP protocol integration
node tests/e2e.ts   # full pipeline: SPA→BFF→MCP→tools→DB
```

The MCP integration test spawns the real server, connects via the official MCP client SDK over Streamable HTTP, and verifies the two acceptance scenarios from the spec (`Plan my afternoon`, reminder anchored to an event).

## Build

```bash
npm run build   # compiles the MCP server to dist/ and the SPA to apps/web/dist/
npm start       # runs the compiled MCP server on port 8000
```

## Typical inner loop

1. Change a tool in `services/mcp-server/src/tools/`.
2. tsx watch picks it up; the MCP server hot-restarts.
3. Refresh the SPA — the BFF's cached MCP client reconnects on its next call.

## Enabling Amazon Bedrock

Set the following in `services/mcp-server/.env`:

```
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=<a model you've enabled in the Bedrock console>
# For local development only — production should use an IAM role.
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Restart the MCP server. `curl http://localhost:8000/healthz` should now show `"bedrock":"configured"`. When you run `Plan my afternoon` the plan's `generatedBy` will be `bedrock` and the summary will be rewritten in natural language. Turn it back off by clearing `BEDROCK_MODEL_ID` — the deterministic fallback takes over transparently.

## Common issues

| Symptom | Fix |
|---|---|
| `EADDRINUSE :::8000` | Something else is on 8000. `PORT=8001 npm run dev:mcp`. |
| SPA says "Reconnecting…" | Check the BFF is running on 5174; check the MCP server is running on 8000. `curl http://localhost:8000/healthz`. |
| Bedrock says "temporarily unavailable" | Model ID isn't enabled in your region, or credentials expired. LifeOps falls back automatically; check `services/mcp-server` logs for the actual error. |
| `better-sqlite3` build fails on `npm install` | You're on Node < 20 or an unusual libc. Use Node 20 LTS or 22 on glibc-based Linux/macOS. |
