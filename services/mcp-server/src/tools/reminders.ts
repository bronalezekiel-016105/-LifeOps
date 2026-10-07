import { z } from 'zod';
import { database } from '../services/database.js';
import { ISODateTime, UserId, jsonResult, toolError } from './_shared.js';

export const createReminderSchema = {
  userId: UserId.describe('Identifier of the user for whom to create the reminder.'),
  title: z
    .string()
    .min(1)
    .max(200)
    .describe('Short human-readable reminder title, e.g. "Submit proposal".'),
  reminderTime: ISODateTime
    .describe('ISO 8601 datetime the reminder should fire.'),
  notes: z
    .string()
    .max(1000)
    .optional()
    .describe('Optional longer note.'),
  relatedTaskId: z
    .string()
    .optional()
    .describe('Optional task ID this reminder is about.'),
  relatedEventId: z
    .string()
    .optional()
    .describe('Optional calendar event ID this reminder is anchored to.'),
};

export const createReminderZod = z.object(createReminderSchema);
export type CreateReminderInput = z.infer<typeof createReminderZod>;

export async function createReminderHandler(input: CreateReminderInput) {
  // Sanity-check the reminder time — must be in the near-ish future or past 24h.
  const remindMs = Date.parse(input.reminderTime);
  const now = Date.now();
  if (!Number.isFinite(remindMs)) {
    return toolError('Please provide a valid ISO 8601 datetime for reminderTime.');
  }
  if (remindMs < now - 24 * 60 * 60_000) {
    return toolError('Reminder time is more than 24 hours in the past; refusing to create.', {
      reminderTime: input.reminderTime,
    });
  }
  if (input.relatedTaskId) {
    const t = database.getTaskById(input.relatedTaskId);
    if (!t || t.userId !== input.userId) {
      return toolError('Related task not found for this user.', {
        relatedTaskId: input.relatedTaskId,
      });
    }
  }
  if (input.relatedEventId) {
    const e = database.getEventById(input.relatedEventId);
    if (!e || e.userId !== input.userId) {
      return toolError('Related event not found for this user.', {
        relatedEventId: input.relatedEventId,
      });
    }
  }
  const reminder = database.createReminder({
    userId: input.userId,
    title: input.title,
    notes: input.notes ?? null,
    remindAt: new Date(remindMs).toISOString(),
    relatedTaskId: input.relatedTaskId ?? null,
    relatedEventId: input.relatedEventId ?? null,
  });
  return jsonResult({
    reminder,
    status: 'created',
    scheduledFor: reminder.remindAt,
    message: `Reminder "${reminder.title}" scheduled for ${reminder.remindAt}.`,
  });
}
