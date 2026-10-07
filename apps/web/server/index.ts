/**
 * LifeOps web BFF (backend-for-frontend).
 *
 * The web dashboard is a plain SPA. Browsers cannot straightforwardly hold
 * long-lived Streamable HTTP MCP sessions, so this small Express server:
 *
 *   1. Maintains an MCP client connection to the LifeOps MCP server.
 *   2. Exposes narrow REST endpoints to the SPA.
 *   3. Records every tool call it makes to the MCP server and returns it in
 *      each response body — the "Activity" pane in the UI shows this feed so
 *      the user can see WHICH tools got orchestrated for their request.
 *
 * This BFF is not the Alexa+ path. Alexa+ hits the MCP server directly at
 * /mcp. The BFF exists purely to power the web demo. The docs make this clear.
 */
import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.env.BFF_PORT ?? 5174);
const MCP_BASE_URL = process.env.MCP_BASE_URL ?? 'http://localhost:8000';
const MCP_PATH = process.env.MCP_PATH ?? '/mcp';
const MCP_URL = `${MCP_BASE_URL}${MCP_PATH}`;
const API_KEY = process.env.LIFEOPS_API_KEY ?? '';
const DEMO_USER = process.env.DEMO_USER_ID ?? 'demo-user';

// ---------- MCP client (lazy, cached, self-healing) ----------

interface MCPHandle {
  client: Client;
  transport: StreamableHTTPClientTransport;
}
let clientPromise: Promise<MCPHandle> | null = null;

async function getMcpClient(): Promise<MCPHandle> {
  if (clientPromise) {
    try {
      return await clientPromise;
    } catch {
      clientPromise = null; // rebuild on next call
    }
  }
  clientPromise = (async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: API_KEY ? { headers: { 'X-LifeOps-Api-Key': API_KEY } } : undefined,
    });
    const client = new Client(
      { name: 'lifeops-web-bff', version: '0.1.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
    // eslint-disable-next-line no-console
    console.log(`[bff] connected to MCP at ${MCP_URL}`);
    return { client, transport };
  })();
  return clientPromise;
}

// ---------- Activity feed helper ----------

interface ActivityEntry {
  tool: string;
  ok: boolean;
  ms: number;
  message: string;
}

async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  activity: ActivityEntry[]
): Promise<T> {
  const started = Date.now();
  try {
    const { client } = await getMcpClient();
    const res = await client.callTool({ name, arguments: args });
    const ms = Date.now() - started;
    if (res.isError) {
      const errMsg = (res.structuredContent as { error?: string })?.error ?? 'tool error';
      activity.push({ tool: name, ok: false, ms, message: errMsg });
      throw new Error(errMsg);
    }
    activity.push({ tool: name, ok: true, ms, message: humanize(name) });
    return res.structuredContent as T;
  } catch (err) {
    // Reset connection so the next request will reconnect.
    clientPromise = null;
    if (activity[activity.length - 1]?.tool !== name) {
      activity.push({
        tool: name,
        ok: false,
        ms: Date.now() - started,
        message: (err as Error).message,
      });
    }
    throw err;
  }
}

function humanize(toolName: string): string {
  switch (toolName) {
    case 'get_tasks':
      return "Retrieved today's tasks";
    case 'get_schedule':
      return 'Checked calendar';
    case 'get_productivity_insights':
      return 'Analyzed available time and conflicts';
    case 'generate_daily_plan':
      return 'Generated a plan';
    case 'summarize_day':
      return 'Summarized the day';
    case 'create_reminder':
      return 'Created reminder';
    case 'complete_task':
      return 'Marked task complete';
    default:
      return `Called ${toolName}`;
  }
}

// ---------- Orchestrator: natural-language → tool sequence ----------

/**
 * Very small intent classifier. Deterministic — no LLM. Chooses which tools
 * to call based on regex hints. Real production systems would route this
 * through the model, but for a demo we want predictable, explainable tool
 * choices so the user can see the agentic flow.
 */
async function orchestrate(userId: string, prompt: string, activity: ActivityEntry[]) {
  const p = prompt.toLowerCase().trim();

  // "Summarize my day" / "recap"
  if (/(summar|recap|wrap[\s-]?up|how.*day)/i.test(p)) {
    const summary = await callTool('summarize_day', { userId }, activity);
    return { kind: 'summary', summary } as const;
  }

  // "Remind me ..." — schedule a reminder anchored to the next event.
  if (/^remind|reminder/i.test(p)) {
    const schedule = await callTool<{ events: Array<{ id: string; title: string; startAt: string }> }>(
      'get_schedule',
      { userId },
      activity
    );
    const upcoming = schedule.events.find((e) => Date.parse(e.startAt) > Date.now());
    if (!upcoming) {
      return {
        kind: 'error',
        message: 'No upcoming events found to anchor the reminder against.',
      } as const;
    }
    const minutesBefore = parseMinutesBefore(prompt) ?? 30;
    const remindAt = new Date(Date.parse(upcoming.startAt) - minutesBefore * 60_000).toISOString();
    const title = extractReminderTitle(prompt) ?? `Prepare for ${upcoming.title}`;
    const created = await callTool(
      'create_reminder',
      {
        userId,
        title,
        reminderTime: remindAt,
        relatedEventId: upcoming.id,
      },
      activity
    );
    return { kind: 'reminder', reminder: created, anchoredTo: upcoming } as const;
  }

  // Default: "Plan my afternoon" / "what should I get done" / anything else.
  // Reads tasks + schedule + insights, then generates a plan.
  const [tasks, schedule, insights] = await Promise.all([
    callTool('get_tasks', { userId }, activity),
    callTool('get_schedule', { userId }, activity),
    callTool('get_productivity_insights', { userId }, activity),
  ]);
  const plan = await callTool(
    'generate_daily_plan',
    { userId, userRequest: prompt },
    activity
  );
  return { kind: 'plan', plan, tasks, schedule, insights } as const;
}

function parseMinutesBefore(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*(?:min(?:ute)?s?|m)\s*before/i);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

function extractReminderTitle(text: string): string | null {
  const m = text.match(/remind me (?:to |about )?(.*?)(?: (?:before|at) |$)/i);
  let title = m?.[1]?.trim();
  if (!title) return null;
  // Strip trailing "N minute(s)" / "N min" / "N m" that belongs to the timing
  // clause, not the reminder title.
  title = title.replace(/\s+\d{1,3}\s*(?:min(?:ute)?s?|m)$/i, '').trim();
  return title.length > 0 ? title : null;
}

// ---------- Express app ----------

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

function asyncHandler<T>(
  fn: (req: Request, res: Response) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mcp: MCP_URL });
});

// Today snapshot — tasks + schedule + reminders + insights, all in one call.
app.get(
  '/api/today',
  asyncHandler(async (req, res) => {
    const userId = (req.query.userId as string) || DEMO_USER;
    const activity: ActivityEntry[] = [];
    const [tasks, schedule, insights, summary] = await Promise.all([
      callTool('get_tasks', { userId }, activity),
      callTool('get_schedule', { userId }, activity),
      callTool('get_productivity_insights', { userId }, activity),
      callTool('summarize_day', { userId }, activity),
    ]);
    res.json({ userId, tasks, schedule, insights, summary, activity });
  })
);

// Ask endpoint — natural-language command, returns the orchestration result + activity.
app.post(
  '/api/ask',
  asyncHandler(async (req, res) => {
    const userId = (req.body?.userId as string) || DEMO_USER;
    const prompt = String(req.body?.prompt ?? '').slice(0, 500);
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    const activity: ActivityEntry[] = [];
    const result = await orchestrate(userId, prompt, activity);
    res.json({ prompt, result, activity });
  })
);

// Direct task completion for the UI's "Mark done" button.
app.post(
  '/api/tasks/:taskId/complete',
  asyncHandler(async (req, res) => {
    const userId = (req.body?.userId as string) || DEMO_USER;
    const activity: ActivityEntry[] = [];
    const result = await callTool(
      'complete_task',
      { userId, taskId: req.params.taskId },
      activity
    );
    res.json({ result, activity });
  })
);

// Global error handler — never leaks stack traces (spec §22).
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error('[bff] error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[bff] listening on http://localhost:${PORT}  →  MCP ${MCP_URL}`);
});
