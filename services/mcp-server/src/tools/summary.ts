import { z } from 'zod';
import { database } from '../services/database.js';
import { detectConflicts, computeFreeIntervals } from '../services/planner.js';
import { ISODate, UserId, jsonResult, todayLocal } from './_shared.js';

// -----------------------------------------------------------------------------
// summarize_day
// -----------------------------------------------------------------------------

export const summarizeDaySchema = {
  userId: UserId.describe('Identifier of the user.'),
  date: ISODate
    .optional()
    .describe('Optional YYYY-MM-DD; defaults to today.'),
};

export const summarizeDayZod = z.object(summarizeDaySchema);
export type SummarizeDayInput = z.infer<typeof summarizeDayZod>;

export async function summarizeDayHandler(input: SummarizeDayInput) {
  const date = input.date ?? todayLocal();
  const allTasks = database.listTasks({ userId: input.userId, date });
  const completed = allTasks.filter((t) => t.status === 'completed');
  const pending = allTasks.filter((t) => t.status === 'pending');
  const events = database.listEvents({ userId: input.userId, date });
  const now = new Date();
  const upcoming = events.filter((e) => Date.parse(e.startAt) > now.getTime());
  const reminders = database.listReminders({ userId: input.userId, date });

  const summary = [
    `${completed.length} task${completed.length === 1 ? '' : 's'} completed`,
    `${pending.length} task${pending.length === 1 ? '' : 's'} still pending`,
    `${upcoming.length} upcoming event${upcoming.length === 1 ? '' : 's'}`,
    `${reminders.length} reminder${reminders.length === 1 ? '' : 's'} scheduled`,
  ].join(' · ');

  return jsonResult({
    date,
    completed,
    pending,
    upcoming,
    reminders,
    summary,
  });
}

// -----------------------------------------------------------------------------
// get_productivity_insights
// -----------------------------------------------------------------------------

export const insightsSchema = {
  userId: UserId.describe('Identifier of the user.'),
  date: ISODate
    .optional()
    .describe('Optional YYYY-MM-DD; defaults to today.'),
};

export const insightsZod = z.object(insightsSchema);
export type InsightsInput = z.infer<typeof insightsZod>;

export async function insightsHandler(input: InsightsInput) {
  const date = input.date ?? todayLocal();
  const tasks = database.listTasks({ userId: input.userId, date });
  const events = database.listEvents({ userId: input.userId, date });

  const overdue = tasks.filter((t) => t.status === 'pending' && t.dueDate && t.dueDate < date);
  const conflicts = detectConflicts(events).map(([a, b]) => ({ a, b }));

  // Compute total pending workload minutes vs. free minutes in a 9–18 window.
  const winStart = new Date(`${date}T09:00:00`).getTime();
  const winEnd = new Date(`${date}T18:00:00`).getTime();
  const gaps = computeFreeIntervals(winStart, winEnd, events);
  const freeMinutes = gaps.reduce((sum, g) => sum + (g.end - g.start) / 60_000, 0);
  const pendingMinutes = tasks
    .filter((t) => t.status === 'pending')
    .reduce((s, t) => s + t.estimatedMinutes, 0);

  const overloaded = pendingMinutes > freeMinutes;

  return jsonResult({
    date,
    overdueTasks: overdue,
    conflictingEvents: conflicts,
    freeMinutes: Math.round(freeMinutes),
    pendingMinutes,
    overloaded,
    freePeriods: gaps.map((g) => ({
      startAt: new Date(g.start).toISOString(),
      endAt: new Date(g.end).toISOString(),
      minutes: Math.round((g.end - g.start) / 60_000),
    })),
    highlights: [
      overdue.length > 0 && `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} to clear.`,
      conflicts.length > 0 && `${conflicts.length} calendar conflict${conflicts.length === 1 ? '' : 's'}.`,
      overloaded && `Pending workload (${pendingMinutes}m) exceeds free time (${Math.round(freeMinutes)}m).`,
    ].filter(Boolean),
  });
}
