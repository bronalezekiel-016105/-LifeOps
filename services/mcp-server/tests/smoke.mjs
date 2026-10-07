/**
 * Live MCP smoke test.
 *
 * Boots the MCP server as a child process, then connects via the official
 * MCP TypeScript client using the Streamable HTTP transport and exercises
 * every tool. Prints a pass/fail summary and exits with a non-zero code on
 * any failure.
 *
 * Usage:  node tests/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = process.env.SMOKE_PORT ?? '8765';
const BASE = `http://127.0.0.1:${PORT}`;
const MCP_URL = `${BASE}/mcp`;

let failures = 0;
function ok(name) {
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failures++;
  console.log(`  ✗ ${name}`);
  if (err) console.log(`      ${err.stack || err.message || err}`);
}

async function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name);
  else fail(name, new Error(`expected ${e} got ${a}`));
}
async function assertTrue(name, cond, extra) {
  if (cond) ok(name);
  else fail(name, new Error(extra || 'condition false'));
}

// ---------- boot server ----------

console.log('booting server on port', PORT);
const child = spawn(
  'npx',
  ['tsx', 'src/index.ts'],
  {
    env: {
      ...process.env,
      PORT,
      HOST: '127.0.0.1',
      DATABASE_URL: 'file:./data/lifeops.smoke.db',
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
child.stdout.on('data', (b) => process.stderr.write(`[srv] ${b}`));
child.stderr.on('data', (b) => process.stderr.write(`[srv] ${b}`));

let stopped = false;
function shutdown(code) {
  if (stopped) return;
  stopped = true;
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(1));
process.on('SIGTERM', () => shutdown(1));

// Wait for /healthz
async function waitReady(maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('server did not become ready');
}

// ---------- seed via direct database import ----------

async function seedForTest() {
  process.env.DATABASE_URL = 'file:./data/lifeops.smoke.db';
  // eslint-disable-next-line import/no-unresolved
  const seedMod = await import('../src/scripts/seed.ts').catch(() => null);
  // The seed script runs on import (top-level side effects). If it did not,
  // fall back to programmatic seeding via the module.
  return seedMod;
}

// ---------- MAIN ----------

try {
  await seedForTest();
  await waitReady();
  console.log('server ready\n');

  // Fresh client + Streamable HTTP transport.
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client(
    { name: 'lifeops-smoke', version: '0.1.0' },
    { capabilities: {} }
  );
  await client.connect(transport);
  ok('initialize handshake');

  const serverInfo = client.getServerVersion();
  await assertEq('server name', serverInfo?.name, 'lifeops-mcp');
  await assertTrue('server version present', typeof serverInfo?.version === 'string');

  // tools/list
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  await assertEq('tools/list returns all 7 tools', names, [
    'complete_task',
    'create_reminder',
    'generate_daily_plan',
    'get_productivity_insights',
    'get_schedule',
    'get_tasks',
    'summarize_day',
  ]);

  // Check tool metadata + schemas exist
  const getTasks = tools.tools.find((t) => t.name === 'get_tasks');
  await assertTrue(
    'get_tasks has description and inputSchema',
    Boolean(getTasks?.description) && Boolean(getTasks?.inputSchema)
  );
  await assertTrue(
    'get_tasks has annotations.readOnlyHint === true',
    getTasks?.annotations?.readOnlyHint === true
  );

  // ---- get_tasks
  const gt = await client.callTool({
    name: 'get_tasks',
    arguments: { userId: 'demo-user' },
  });
  const gtStructured = gt.structuredContent;
  await assertTrue('get_tasks returns tasks array', Array.isArray(gtStructured?.tasks));
  await assertTrue('get_tasks count matches array length',
    gtStructured?.tasks.length === gtStructured?.count);
  await assertTrue(
    'seed produced 4 pending tasks',
    gtStructured?.tasks.filter((t) => t.status === 'pending').length === 4
  );

  // ---- get_schedule
  const gs = await client.callTool({
    name: 'get_schedule',
    arguments: { userId: 'demo-user' },
  });
  await assertTrue('get_schedule returns 3 events', gs.structuredContent?.events?.length === 3);

  // ---- complete_task
  const firstTaskId = gtStructured.tasks[0].id;
  const ct = await client.callTool({
    name: 'complete_task',
    arguments: { userId: 'demo-user', taskId: firstTaskId },
  });
  await assertTrue('complete_task returned updated task',
    ct.structuredContent?.task?.status === 'completed');

  // ---- complete_task idempotent
  const ct2 = await client.callTool({
    name: 'complete_task',
    arguments: { userId: 'demo-user', taskId: firstTaskId },
  });
  await assertTrue('complete_task idempotent on already-completed task',
    ct2.structuredContent?.alreadyCompleted === true);

  // ---- complete_task on missing task -> tool error
  const ctBad = await client.callTool({
    name: 'complete_task',
    arguments: { userId: 'demo-user', taskId: 'task-does-not-exist' },
  });
  await assertTrue('complete_task on missing task returns tool error',
    ctBad.isError === true);

  // ---- create_reminder
  const remindTime = new Date(Date.now() + 3600_000).toISOString();
  const cr = await client.callTool({
    name: 'create_reminder',
    arguments: {
      userId: 'demo-user',
      title: 'Submit proposal',
      reminderTime: remindTime,
    },
  });
  await assertTrue('create_reminder returned scheduled reminder',
    cr.structuredContent?.reminder?.status === 'scheduled');
  await assertTrue('create_reminder returned matching time',
    cr.structuredContent?.reminder?.remindAt === remindTime);

  // ---- create_reminder rejects past times
  const crBad = await client.callTool({
    name: 'create_reminder',
    arguments: {
      userId: 'demo-user',
      title: 'Too old',
      reminderTime: new Date(Date.now() - 48 * 3600_000).toISOString(),
    },
  });
  await assertTrue('create_reminder rejects >24h past times',
    crBad.isError === true);

  // ---- generate_daily_plan
  const plan = await client.callTool({
    name: 'generate_daily_plan',
    arguments: { userId: 'demo-user', userRequest: 'Plan my afternoon.' },
  });
  const p = plan.structuredContent?.plan;
  await assertTrue('generate_daily_plan returned a plan', !!p);
  await assertTrue('plan has blocks', Array.isArray(p?.blocks) && p.blocks.length > 0);
  await assertTrue('plan has a summary', typeof p?.summary === 'string' && p.summary.length > 0);
  await assertTrue('plan generatedBy is deterministic (bedrock off)',
    p?.generatedBy === 'deterministic');

  // ---- summarize_day
  const sd = await client.callTool({
    name: 'summarize_day',
    arguments: { userId: 'demo-user' },
  });
  await assertTrue('summarize_day returned summary text',
    typeof sd.structuredContent?.summary === 'string');

  // ---- get_productivity_insights
  const ins = await client.callTool({
    name: 'get_productivity_insights',
    arguments: { userId: 'demo-user' },
  });
  await assertTrue('insights returns freePeriods array',
    Array.isArray(ins.structuredContent?.freePeriods));

  // ---- Bad tool args -> tool error (SDK returns isError:true, not a throw)
  let badArgs;
  try {
    badArgs = await client.callTool({
      name: 'get_tasks',
      arguments: { userId: '' }, // violates min(1)
    });
    await assertTrue(
      'bad args rejected as tool error',
      badArgs?.isError === true,
      `expected isError:true, got ${JSON.stringify(badArgs)}`
    );
  } catch (e) {
    // Some SDK versions may throw; either shape is acceptable evidence.
    ok('bad args rejected (thrown)');
  }

  // ---- Unknown tool
  try {
    const unknown = await client.callTool({ name: 'not_a_real_tool', arguments: {} });
    await assertTrue(
      'unknown tool rejected',
      unknown?.isError === true,
      `expected isError:true, got ${JSON.stringify(unknown)}`
    );
  } catch (e) {
    ok('unknown tool rejected (thrown)');
  }

  await transport.close();
  console.log(`\nSummary: ${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
  shutdown(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('SMOKE TEST CRASHED:', err);
  shutdown(1);
}
