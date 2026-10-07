/**
 * Shared building blocks for MCP tools.
 *
 * Every tool exports:
 *   - a zod input schema
 *   - a description string
 *   - an async handler that produces MCP tool content
 *
 * server.ts wires them into the McpServer via `server.registerTool(...)`.
 */
import { z } from 'zod';

/** ISO 8601 date string YYYY-MM-DD. */
export const ISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** ISO 8601 datetime string YYYY-MM-DDTHH:MM(:SS)?(Z|±HH:MM)? */
export const ISODateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'expected ISO 8601 datetime');

/** HH:MM 24-hour clock. */
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24h)');

export const UserId = z.string().min(1).max(120);

export const Priority = z.enum(['low', 'medium', 'high']);

/** Today, in local time, as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Wrap a JSON object into the MCP tool content shape. Every LifeOps tool
 * returns a single "text" content block that is a JSON string — this keeps
 * outputs cheap to parse for both AI agents and our web UI.
 */
export function jsonResult(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const structured = (payload && typeof payload === 'object' ? payload : { value: payload }) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: structured,
  };
}

/** Convert unknown errors into a safe tool-error payload. */
export function toolError(message: string, details?: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, details: details ?? null }, null, 2),
      },
    ],
    structuredContent: { error: message, details: details ?? null } as Record<string, unknown>,
  };
}
