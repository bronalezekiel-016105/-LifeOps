/**
 * MCP server factory.
 *
 * Following the CVE-2026-25536 mitigation guidance (fixed in
 * @modelcontextprotocol/sdk >= 1.26.0): each session gets its OWN McpServer
 * instance and its OWN StreamableHTTPServerTransport. We never share
 * server/transport state across concurrent client sessions.
 *
 * All tool inputs use raw Zod shape objects (not compiled schemas) because
 * McpServer#registerTool accepts a `{ key: ZodType }` map and derives the JSON
 * Schema for tools/list from it. That means the schemas the AI agent sees
 * exactly match the schemas we validate against — one source of truth.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

import {
  getTasksSchema,
  getTasksHandler,
  completeTaskSchema,
  completeTaskHandler,
} from './tools/tasks.js';
import { getScheduleSchema, getScheduleHandler } from './tools/schedule.js';
import { createReminderSchema, createReminderHandler } from './tools/reminders.js';
import { generateDailyPlanSchema, generateDailyPlanHandler } from './tools/planning.js';
import {
  summarizeDaySchema,
  summarizeDayHandler,
  insightsSchema,
  insightsHandler,
} from './tools/summary.js';

/**
 * Build a brand new McpServer with every tool registered. Called once per
 * client session. Do NOT cache the result globally.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: config.mcp.serverName,
      version: config.mcp.serverVersion,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'LifeOps is an ambient AI productivity assistant. Use the tools to read the user\'s ' +
        'tasks and schedule, generate day plans, create reminders, and mark tasks complete. ' +
        'Always call tools rather than guessing — never invent task IDs, event IDs, or times.',
    }
  );

  // ---- Read-only, safe tools ----

  server.registerTool(
    'get_tasks',
    {
      title: 'Get tasks',
      description:
        'Retrieve pending and completed tasks for a user for a specified date and optional filters. ' +
        'Filters by status and priority are supported.',
      inputSchema: getTasksSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => getTasksHandler(args)
  );

  server.registerTool(
    'get_schedule',
    {
      title: 'Get schedule',
      description:
        'Retrieve the user\'s calendar events for a given date or time range. Returns events sorted by start time.',
      inputSchema: getScheduleSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => getScheduleHandler(args)
  );

  server.registerTool(
    'summarize_day',
    {
      title: 'Summarize the day',
      description:
        'Return a concise summary of the user\'s day: completed and pending tasks, upcoming events, and scheduled reminders.',
      inputSchema: summarizeDaySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => summarizeDayHandler(args)
  );

  server.registerTool(
    'get_productivity_insights',
    {
      title: 'Get productivity insights',
      description:
        'Identify overdue tasks, calendar conflicts, free time blocks, and whether the pending workload exceeds available time.',
      inputSchema: insightsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => insightsHandler(args)
  );

  server.registerTool(
    'generate_daily_plan',
    {
      title: 'Generate a daily plan',
      description:
        'Build a structured plan for the user\'s day: fetches tasks and schedule, computes free time, ' +
        'orders tasks by priority and deadlines, and optionally uses Amazon Bedrock to write a natural-language summary. ' +
        'Never invents tasks or times — only arranges existing ones.',
      inputSchema: generateDailyPlanSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // Bedrock rewrite may vary run-to-run.
        openWorldHint: false,
      },
    },
    async (args) => generateDailyPlanHandler(args)
  );

  // ---- Write tools — clearly marked non-readonly ----

  server.registerTool(
    'create_reminder',
    {
      title: 'Create a reminder',
      description:
        'Create a reminder for the user. Provide an absolute ISO 8601 reminderTime. ' +
        'Optionally attach a related task or event ID. Returns the created reminder record.',
      inputSchema: createReminderSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => createReminderHandler(args)
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete a task',
      description:
        'Mark a task complete for the user. Returns the updated task record. ' +
        'Idempotent when the task is already complete.',
      inputSchema: completeTaskSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => completeTaskHandler(args)
  );

  logger.debug({ tools: 7 }, 'mcp server built');
  return server;
}
