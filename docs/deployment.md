# AWS deployment

This document describes the intended AWS deployment path. It has **not been executed** from the hackathon dev environment (no AWS CLI, no credentials there). Every step here is one you should confirm against current AWS documentation before running — AgentCore Runtime's onboarding UI evolves.

## Prerequisites

- An AWS account.
- IAM permissions to create roles, deploy to AgentCore Runtime, invoke Bedrock, and write DynamoDB and CloudWatch Logs.
- The AWS CLI v2 installed and configured (`aws configure sso` or IAM role assumption).
- Docker installed locally.
- A Bedrock model enabled in your region (verify in the Bedrock console).

## 1. Build the container

```bash
docker build \
  -f services/mcp-server/Dockerfile \
  -t lifeops/mcp-server:0.1.0 \
  .
```

The image starts a Node process listening on `0.0.0.0:8000` at `/mcp` — the AgentCore Runtime convention.

## 2. Local smoke against the container (recommended before AWS)

```bash
docker run --rm -p 8000:8000 lifeops/mcp-server:0.1.0
# in another terminal:
curl http://localhost:8000/healthz
```

## 3. Push to ECR

```bash
AWS_REGION=us-east-1
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws ecr create-repository --repository-name lifeops/mcp-server --region $AWS_REGION || true
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
docker tag lifeops/mcp-server:0.1.0 $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/lifeops/mcp-server:0.1.0
docker push $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/lifeops/mcp-server:0.1.0
```

## 4. Create the IAM execution role

Trust policy — allow AgentCore Runtime to assume the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Permissions policy — see `docs/aws.md#aws-iam--access-control-required` for the full JSON.

## 5. Deploy to AgentCore Runtime

Exact CLI commands and UI names change; use the current Bedrock AgentCore documentation. The general shape:

1. Create an AgentCore Runtime "agent runtime" resource referencing the ECR image URI, the IAM role, and the environment variables below.
2. Set container port to `8000` and endpoint path to `/mcp`.
3. Wait for it to be in the `READY` state.
4. Grab the invocation endpoint — an `https://runtime.bedrock-agentcore.<region>.amazonaws.com/...` URL.

Environment variables to set on the runtime:

```
NODE_ENV=production
HOST=0.0.0.0
PORT=8000
MCP_PATH=/mcp
DEMO_MODE=true                # switch to false when real users onboard
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=<a model you enabled>
DATABASE_URL=file:/app/services/mcp-server/data/lifeops.db
LOG_LEVEL=info
ALLOWED_ORIGINS=<comma-separated list of production origins>
LIFEOPS_API_KEY=<from Secrets Manager, if using demo auth; prefer OAuth in prod>
```

## 6. Verify

```bash
# Health check
curl https://<runtime-endpoint>/healthz

# MCP initialize (session negotiation — the SDK does this automatically for real clients)
curl -sN -X POST https://<runtime-endpoint>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'
```

## 7. Connect Alexa+

Follow the current Alexa+ MCP onboarding flow to register the endpoint URL. See `docs/alexa-plus.md`.

## 8. Watch the logs

```bash
aws logs tail /aws/bedrock-agentcore/lifeops --follow --region $AWS_REGION
```

Every request has a `requestId`, `sessionId`, `rpcMethod`, and duration.

## 9. Cleanup

Because the runtime has a per-hour cost, delete it when the demo period ends:

1. Delete the AgentCore Runtime resource in the console (or via CLI).
2. `aws ecr delete-repository --repository-name lifeops/mcp-server --force --region $AWS_REGION`
3. Delete the IAM role.
4. (Optional) delete the DynamoDB table if you migrated to it.

## Infrastructure as code

For a real production deployment, wrap the above in CloudFormation or CDK. This repo does not ship IaC because AgentCore's CloudFormation resources are still evolving and any IaC we shipped today would rapidly drift from the console flow.
