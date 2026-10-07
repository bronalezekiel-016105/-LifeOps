# Architecture

## System overview

LifeOps is a small distributed system with two live processes locally and a defined path to AWS deployment for the hackathon submission.

- **MCP server** — the star of the show. Speaks the Model Context Protocol over Streamable HTTP at `POST /mcp`. Exposes 7 tools. This is the endpoint that Alexa+ (and any other MCP client) connects to.
- **Web app** — a Vite/React SPA plus a small Express backend-for-frontend (BFF) that maintains an MCP client connection and exposes narrow REST endpoints to the SPA. This is the demo surface.

## Component diagram

```mermaid
flowchart LR
    subgraph "User surfaces"
      A[Alexa+ device] -->|Streamable HTTP| MCP
      B[Web browser<br/>Vite SPA] -->|REST /api/*| BFF
      BFF -->|MCP client<br/>Streamable HTTP| MCP
    end

    subgraph "LifeOps MCP server"
      MCP[/POST GET DELETE /mcp<br/>StreamableHTTPServerTransport/]
      MCP --> Tools[Tool registry<br/>7 tools]
      Tools --> Planner[Deterministic planner]
      Tools --> DB[(SQLite / DynamoDB)]
      Planner --> Bedrock{{Amazon Bedrock<br/>Converse API}}
      Planner -->|fallback| Deterministic[Always-works planner]
    end
```

## MCP architecture — session lifecycle

The Streamable HTTP transport is a single URL that handles POST (client → server), GET (server → client SSE stream), and DELETE (session termination). Each session gets its own `McpServer` + `StreamableHTTPServerTransport` instance to avoid CVE-2026-25536 (cross-client data leak when a transport is shared across sessions in SDK `<1.26.0`).

```mermaid
sequenceDiagram
    participant C as MCP Client<br/>(Alexa+ or BFF)
    participant S as LifeOps<br/>/mcp
    participant M as McpServer<br/>(per-session)
    participant DB as SQLite

    C->>S: POST /mcp<br/>{ jsonrpc:"initialize", protocolVersion:"2025-11-25" }
    S->>S: create new McpServer + transport
    S->>M: connect()
    S-->>C: 200 { serverInfo, capabilities }<br/>Mcp-Session-Id: abc-123
    C->>S: POST /mcp (Mcp-Session-Id: abc-123)<br/>{ method:"tools/list" }
    S->>M: route to session's server
    M-->>C: { tools: [7 items] }
    C->>S: POST /mcp<br/>{ method:"tools/call", name:"get_tasks" }
    M->>DB: SELECT * FROM tasks WHERE ...
    DB-->>M: rows
    M-->>C: { content, structuredContent }
    C->>S: DELETE /mcp (Mcp-Session-Id: abc-123)
    S->>M: close()
```

## Agentic workflow

The web BFF is a small deterministic orchestrator. It classifies intent and picks the tool sequence — this keeps the demo predictable and inspectable. Alexa+ replaces this with its own model-driven planner.

```mermaid
flowchart TD
    U["User: Plan my afternoon"] --> I{Intent}
    I -->|plan| P1[get_tasks]
    I -->|plan| P2[get_schedule]
    I -->|plan| P3[get_productivity_insights]
    P1 --> P4[generate_daily_plan]
    P2 --> P4
    P3 --> P4
    P4 --> P5{{Bedrock configured?}}
    P5 -->|yes| P6[Converse API<br/>rewrite summary]
    P5 -->|no| P7[Deterministic summary]
    P6 --> R[Return plan + activity feed]
    P7 --> R

    I -->|reminder| R1[get_schedule]
    R1 --> R2[Locate next event]
    R2 --> R3[Compute reminder time in app code]
    R3 --> R4[create_reminder]
    R4 --> R

    I -->|summary| S1[summarize_day]
    S1 --> R
```

## Data flow

Every user request creates an activity log — an ordered list of `{tool, ok, ms, message}` records — that the UI displays. That's what the "Activity" pane shows. It is NOT the model's chain-of-thought; it's the actual tool orchestration.

## AWS architecture (target)

```mermaid
flowchart LR
    Alexa[Alexa+] -->|Streamable HTTP| AgentCore
    AgentCore[Amazon Bedrock<br/>AgentCore Runtime] --> Container[LifeOps container<br/>0.0.0.0:8000 /mcp]
    Container --> DDB[(DynamoDB<br/>tasks, events, reminders)]
    Container --> Bedrock[Amazon Bedrock<br/>Converse API]
    Container --> CW[CloudWatch Logs<br/>structured JSON]
    IAM[IAM role] -.credentials.-> Container
    Secrets[AWS Secrets Manager<br/>optional API keys] -.-> Container
```

For local development, DynamoDB is replaced with SQLite via the same `DatabaseService` interface. Nothing in the tool layer changes.

## Security boundaries

- **CORS allowlist** — origins in `ALLOWED_ORIGINS`; browser flows can only start where you say.
- **Origin header enforcement** — the transport rejects mismatched Origins (mitigates DNS rebinding).
- **Optional API key** — `X-LifeOps-Api-Key` header. Documented as demo-only; Alexa+ deployments must use OAuth 2.0 (see `docs/alexa-plus.md`).
- **Secrets never in code** — env-driven; Secrets Manager for cloud; IAM role for AWS credentials.
- **Log redaction** — pino redacts `authorization`, `cookie`, `x-lifeops-api-key`, and any field named `accessKeyId`, `secretAccessKey`, `sessionToken`, `token`, `password`, `apiKey`.

## Local development architecture

```mermaid
flowchart LR
    Dev[Developer machine] -->|npm run dev| ProcA[MCP server<br/>tsx watch<br/>:8000]
    Dev -->|npm run dev| ProcB[BFF<br/>tsx watch<br/>:5174]
    Dev -->|npm run dev| ProcC[Vite dev server<br/>:5173]
    ProcC -->|/api/* proxy| ProcB
    ProcB -->|MCP client| ProcA
    ProcA -->|SQLite file| Disk[(data/lifeops.db)]
```

## Production architecture (as documented; not deployed here)

The MCP server container is designed to run behind AgentCore Runtime. Environment configuration:

- `HOST=0.0.0.0`, `PORT=8000`, `MCP_PATH=/mcp` (AgentCore convention)
- IAM role provides Bedrock, DynamoDB, and CloudWatch permissions
- No long-lived AWS credentials; SDK reads from role

The web app can be hosted anywhere (S3+CloudFront, Amplify) — for the hackathon submission the video demo shows it running locally against the same MCP server that Alexa+ would use.
