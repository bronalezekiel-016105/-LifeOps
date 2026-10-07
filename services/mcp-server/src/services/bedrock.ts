/**
 * Amazon Bedrock service — narrow, focused wrapper around the Converse API.
 *
 * We use Bedrock ONLY for two things:
 *   1. Rewriting the deterministic plan summary in natural, useful language.
 *   2. Reordering tasks when the user's request implies intent the algorithm
 *      alone can't infer ("focus on billing today", "prioritise anything client-facing").
 *
 * We never let the model invent task IDs, event IDs, times, or durations —
 * those come from the deterministic planner (spec §35).
 *
 * If BEDROCK_MODEL_ID is unset or the Bedrock call fails, we fall back to the
 * deterministic result. That means the demo NEVER breaks because AWS is down
 * or credentials are missing.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { DailyPlan } from '../types/domain.js';

let cachedClient: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient | null {
  if (!config.aws.bedrockEnabled) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new BedrockRuntimeClient({
    region: config.aws.region,
    // If the process is running with an IAM role (AgentCore, ECS, EC2, Lambda)
    // the SDK auto-discovers credentials. We only pass explicit creds for
    // local dev, and only when both are set.
    ...(config.aws.accessKeyId && config.aws.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.aws.accessKeyId,
            secretAccessKey: config.aws.secretAccessKey,
            ...(config.aws.sessionToken ? { sessionToken: config.aws.sessionToken } : {}),
          },
        }
      : {}),
  });
  return cachedClient;
}

const REWRITE_SYSTEM_PROMPT = [
  'You are the natural-language writer inside LifeOps, an ambient productivity assistant.',
  'You will be given a structured JSON daily plan and a short user request.',
  'Rewrite ONLY the "summary" field in a clear, calm, second-person voice (2–3 sentences).',
  'Do NOT invent tasks, events, IDs, or times. Do NOT change any block. Respond with JSON only:',
  '{"summary": "..."}',
].join(' ');

export interface RewriteInputs {
  userRequest: string;
  plan: DailyPlan;
}

/**
 * Attempt to rewrite the plan summary via Bedrock. Returns the enriched plan,
 * or the input plan unchanged if Bedrock is unavailable. Always resolves —
 * never throws — because callers rely on this for the user-facing path.
 */
export async function rewriteSummaryWithBedrock(
  inputs: RewriteInputs
): Promise<DailyPlan> {
  const client = getClient();
  if (!client) {
    logger.debug('bedrock disabled — returning deterministic plan');
    return inputs.plan;
  }
  const modelId = config.aws.bedrockModelId;
  const started = Date.now();
  try {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            text: [
              `User request: ${inputs.userRequest}`,
              '',
              'Structured plan:',
              JSON.stringify(inputs.plan, null, 2),
            ].join('\n'),
          },
        ],
      },
    ];
    const command = new ConverseCommand({
      modelId,
      system: [{ text: REWRITE_SYSTEM_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: 400, temperature: 0.2 },
    });

    // 10s hard timeout so a slow Bedrock never stalls a user request.
    const response = await Promise.race([
      client.send(command),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('bedrock timeout')), 10_000)
      ),
    ]);

    const text = response.output?.message?.content
      ?.flatMap((c) => ('text' in c && c.text ? [c.text] : []))
      .join('\n') ?? '';
    const summary = parseSummaryJson(text);
    logger.info(
      { modelId, ms: Date.now() - started, ok: Boolean(summary) },
      'bedrock rewrite complete'
    );
    if (!summary) return inputs.plan;
    return { ...inputs.plan, summary, generatedBy: 'bedrock' };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, ms: Date.now() - started },
      'bedrock rewrite failed — using deterministic summary'
    );
    return inputs.plan;
  }
}

/** Extract {"summary": "..."} from the model text, tolerating fenced code. */
function parseSummaryJson(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(trimmed) as { summary?: unknown };
    if (typeof obj.summary === 'string' && obj.summary.length > 0) return obj.summary;
  } catch {
    // Fall through to a very defensive regex extract.
    const m = trimmed.match(/"summary"\s*:\s*"([^"]{1,400})"/);
    if (m) return m[1] ?? null;
  }
  return null;
}
