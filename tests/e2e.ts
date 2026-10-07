/**
 * End-to-end demo test.
 *
 * Boots the MCP server AND the BFF, then exercises the two REST endpoints
 * the SPA uses. Verifies that a natural-language "Plan my afternoon" prompt
 * flows all the way through: SPA client → BFF orchestrator → MCP client →
 * MCP server → tool invocations → DB reads → deterministic planner → back
 * up the stack with an activity feed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const MCP_PORT = 8767;
const BFF_PORT = 5175;
const DB = './services/mcp-server/data/lifeops.e2e.db';
const BFF_BASE = `http://127.0.0.1:${BFF_PORT}`;

let failures = 0;
const ok = (n: string) => console.log(`  ✓ ${n}`);
const fail = (n: string, why: unknown) => {
  failures++;
  console.log(`  ✗ ${n}`);
  console.log(`      ${(why as Error)?.stack ?? why}`);
};
const assertTrue = (name: string, cond: unknown, why?: string) =>
  cond ? ok(name) : fail(name, why ?? 'condition false');

const children: ChildProcess[] = [];
function shutdown(code: number): never {
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 300);
  // Unreachable but keeps TS happy.
  return undefined as never;
}
process.on('SIGINT', () => shutdown(1));
process.on('SIGTERM', () => shutdown(1));

async function waitForOk(url: string, maxMs: number, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* keep polling */ }
    await sleep(200);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function main() {
  // Fresh DB
  for (const ext of ['', '-wal', '-shm']) {
    const p = DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }

  console.log('booting MCP server on', MCP_PORT);
  const mcp = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: 'services/mcp-server',
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      HOST: '127.0.0.1',
      DATABASE_URL: 'file:./data/lifeops.e2e.db',
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  mcp.stderr?.on('data', (b: Buffer) => process.stderr.write(`[mcp] ${b}`));
  children.push(mcp);

  await waitForOk(`http://127.0.0.1:${MCP_PORT}/healthz`, 15000, 'mcp');

  console.log('seeding DB');
  await new Promise<void>((resolve, reject) => {
    const seed = spawn('npx', ['tsx', 'src/scripts/seed.ts'], {
      cwd: 'services/mcp-server',
      env: { ...process.env, DATABASE_URL: 'file:./data/lifeops.e2e.db' },
      stdio: 'inherit',
    });
    seed.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`seed exit ${c}`))));
  });

  console.log('booting BFF on', BFF_PORT);
  const bff = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: 'apps/web',
    env: {
      ...process.env,
      BFF_PORT: String(BFF_PORT),
      MCP_BASE_URL: `http://127.0.0.1:${MCP_PORT}`,
      MCP_PATH: '/mcp',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bff.stderr?.on('data', (b: Buffer) => process.stderr.write(`[bff] ${b}`));
  bff.stdout?.on('data', (b: Buffer) => process.stderr.write(`[bff] ${b}`));
  children.push(bff);

  await waitForOk(`${BFF_BASE}/api/health`, 15000, 'bff');
  console.log('\nready\n');

  // ---- /api/today
  {
    const r = await fetch(`${BFF_BASE}/api/today`);
    const j = await r.json();
    assertTrue('GET /api/today 200', r.ok);
    assertTrue('today.tasks present', Array.isArray(j.tasks?.tasks));
    assertTrue('today.schedule present', Array.isArray(j.schedule?.events));
    assertTrue('today.insights present', j.insights?.freePeriods !== undefined);
    assertTrue('today.summary present', typeof j.summary?.summary === 'string');
    assertTrue('today.activity records 4 tool calls', j.activity?.length === 4);
  }

  // ---- POST /api/ask "Plan my afternoon"
  {
    const r = await fetch(`${BFF_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Plan my afternoon' }),
    });
    const j = await r.json();
    assertTrue('ask("Plan my afternoon") 200', r.ok);
    assertTrue('result.kind === "plan"', j.result?.kind === 'plan');
    assertTrue(
      'plan has blocks',
      Array.isArray(j.result?.plan?.plan?.blocks) &&
        j.result.plan.plan.blocks.length > 0
    );
    assertTrue(
      'activity shows orchestration (>=4 tool calls: tasks, schedule, insights, plan)',
      j.activity?.length >= 4
    );
    const tools = new Set((j.activity ?? []).map((a: { tool: string }) => a.tool));
    assertTrue(
      'orchestration includes get_tasks + get_schedule + generate_daily_plan',
      tools.has('get_tasks') && tools.has('get_schedule') && tools.has('generate_daily_plan')
    );
  }

  // ---- POST /api/ask "Remind me ... before my meeting"
  {
    const r = await fetch(`${BFF_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Remind me to submit the proposal 30 minutes before my meeting',
      }),
    });
    const j = await r.json();
    assertTrue('ask(reminder) 200', r.ok);
    assertTrue('result.kind === "reminder"', j.result?.kind === 'reminder');
    assertTrue(
      'reminder title is preserved',
      j.result?.reminder?.reminder?.title === 'submit the proposal'
    );
  }

  // ---- POST /api/ask "Summarize my day"
  {
    const r = await fetch(`${BFF_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Summarize my day' }),
    });
    const j = await r.json();
    assertTrue('ask(summary) 200', r.ok);
    assertTrue('result.kind === "summary"', j.result?.kind === 'summary');
  }

  console.log(`\nSummary: ${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
  shutdown(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CRASH:', e);
  shutdown(1);
});
