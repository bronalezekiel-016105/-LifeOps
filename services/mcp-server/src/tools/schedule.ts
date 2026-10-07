import { z } from 'zod';
import { database } from '../services/database.js';
import { ISODate, ISODateTime, UserId, jsonResult } from './_shared.js';

export const getScheduleSchema = {
  userId: UserId.describe('Identifier of the user whose calendar to retrieve.'),
  date: ISODate
    .optional()
    .describe('Optional YYYY-MM-DD; filters events to this date.'),
  startTime: ISODateTime
    .optional()
    .describe('Optional inclusive lower bound ISO datetime for event start.'),
  endTime: ISODateTime
    .optional()
    .describe('Optional inclusive upper bound ISO datetime for event end.'),
};

export const getScheduleZod = z.object(getScheduleSchema);
export type GetScheduleInput = z.infer<typeof getScheduleZod>;

export async function getScheduleHandler(input: GetScheduleInput) {
  const events = database.listEvents(input);
  return jsonResult({ events, count: events.length });
}
