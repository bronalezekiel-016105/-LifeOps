import { z } from 'zod';
import { database } from '../services/database.js';
import { buildDeterministicPlan } from '../services/planner.js';
import { rewriteSummaryWithBedrock } from '../services/bedrock.js';
import { HHMM, ISODate, UserId, jsonResult } from './_shared.js';

export const generateDailyPlanSchema = {
  userId: UserId.describe('Identifier of the user to plan for.'),
  date: ISODate
    .optional()
    .describe('Optional YYYY-MM-DD to plan. Defaults to today.'),
  planningWindow: z
    .object({
      start: HHMM.describe('Local start time HH:MM.'),
      end: HHMM.describe('Local end time HH:MM.'),
    })
    .optional()
    .describe('Optional planning window. Defaults to 09:00–18:00.'),
  userRequest: z
    .string()
    .max(500)
    .optional()
    .describe('Optional natural-language context, e.g. "I have a 4pm meeting and want to prep first".'),
};

export const generateDailyPlanZod = z.object(generateDailyPlanSchema);
export type GenerateDailyPlanInput = z.infer<typeof generateDailyPlanZod>;

export async function generateDailyPlanHandler(input: GenerateDailyPlanInput) {
  const now = new Date();
  const date = input.date ?? now.toISOString().slice(0, 10);

  const [tasks, events] = [
    database.listTasks({ userId: input.userId, date, status: 'pending' }),
    database.listEvents({ userId: input.userId, date }),
  ];

  const deterministic = buildDeterministicPlan({
    userId: input.userId,
    date,
    now,
    windowStart: input.planningWindow?.start,
    windowEnd: input.planningWindow?.end,
    tasks,
    events,
  });

  // Enhance the summary with Bedrock if available. Deterministic result is
  // returned unchanged on failure — the demo never breaks.
  const enriched = await rewriteSummaryWithBedrock({
    userRequest: input.userRequest ?? `Plan ${date}.`,
    plan: deterministic,
  });

  return jsonResult({ plan: enriched });
}
