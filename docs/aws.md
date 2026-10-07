# AWS integration

LifeOps qualifies for the AWS Builder mini challenge by using AWS services with real, non-decorative purposes.

## Services and their roles

### Amazon Bedrock — natural-language rewrite (used)

**Where:** `services/mcp-server/src/services/bedrock.ts`
**Why:** The deterministic planner produces a structured plan but a mechanical summary (`"Planned 4 tasks around 3 events."`). Bedrock's Converse API rewrites the summary into a calm, useful sentence tuned to the user's exact request. This is the smallest, safest use of a model — no invented facts, no invented IDs.
**Model:** Configured via `BEDROCK_MODEL_ID`. We do not hard-code a model ID because model availability varies by region and account. Verify a current model in the Bedrock console before setting the env var.
**Fallback:** If `BEDROCK_MODEL_ID` is unset, the Bedrock SDK isn't reachable, or the call times out (10 s hard cap), the deterministic summary is returned. The demo never breaks.
**Guardrails:** The model receives only the structured plan and the user's phrasing. Its response must be JSON matching `{"summary": "..."}` and is parsed defensively.

### Amazon Bedrock AgentCore Runtime — the MCP hosting target (documented)

**Why AgentCore:** It's the AWS-native runtime for MCP servers. The container just needs to listen on `0.0.0.0:8000` at `/mcp` — which is exactly what we do.
**Status:** Deployment steps are in `docs/deployment.md`. Not deployed from this environment because the sandbox has no AWS CLI or credentials.

### Amazon DynamoDB — production storage (documented, swappable)

**Why:** The `DatabaseService` interface in `services/mcp-server/src/services/database.ts` is the abstraction. For local dev we use SQLite. For AWS production, a `DynamoDBService` implementing the same interface would use single-table design:

| PK | SK | Fields |
|---|---|---|
| `USER#<id>` | `META` | displayName, timezone |
| `USER#<id>` | `TASK#<id>` | title, priority, status, dueDate, estimatedMinutes |
| `USER#<id>` | `EVENT#<id>#<startAt>` | title, location, endAt |
| `USER#<id>` | `REMINDER#<remindAt>#<id>` | title, notes, status, related refs |

GSIs on `status` and `dueDate` for the task queries the tool layer performs.
**Status:** Not implemented in this submission — SQLite ships and works. Documented so the path is clear.

### Amazon CloudWatch Logs — structured logging (compatible)

**Why:** Our pino logger outputs structured JSON with correlation IDs (request id, session id) and secret redaction. In AWS these lines are ingested directly into CloudWatch Logs Insights and are queryable.
**Status:** Locally we pretty-print for humans. In `NODE_ENV=production` the format is JSON — which is what CloudWatch expects. No code change needed.

### AWS Secrets Manager — optional (documented)

**Why:** The `LIFEOPS_API_KEY` and any future OAuth client secrets would live in Secrets Manager. The container's IAM role would grant `secretsmanager:GetSecretValue` on specific ARNs.
**Status:** Documented; not wired in this iteration.

### AWS IAM — access control (required)

**Why:** No long-lived credentials. The container reads from an IAM role. Least-privilege policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "arn:aws:bedrock:*::foundation-model/<model-id>"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem","dynamodb:GetItem","dynamodb:Query","dynamodb:UpdateItem","dynamodb:DeleteItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account>:table/lifeops"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream","logs:PutLogEvents"],
      "Resource": "arn:aws:logs:<region>:<account>:log-group:/aws/bedrock-agentcore/lifeops:*"
    }
  ]
}
```

Replace `<region>`, `<account>`, and `<model-id>` before use.

## What we deliberately did not include

- **Amazon S3** — no static assets that require object storage. Adding it just to check a box would violate the "no decorative services" rule in spec §17.
- **AWS Lambda** — the MCP server is stateful (session ids); Lambda is a poor fit. AgentCore Runtime is the right home.
- **Amazon RDS** — a SQL database would be over-provisioning for the demo. DynamoDB or SQLite is right-sized.

## Cost expectations for a demo

Nothing runs continuously except the container. Rough estimate for a demo/hackathon deployment for a week:

- **AgentCore Runtime container** — usage-based; expect a few dollars per week of demo traffic.
- **Bedrock Converse invocations** — cents per demo run at Claude 3.5 Sonnet rates.
- **DynamoDB** — well within free-tier limits for demo traffic.
- **CloudWatch Logs** — free tier covers the demo.

Always confirm with the current AWS pricing calculator before deploying, and delete the runtime when the demo period ends.
