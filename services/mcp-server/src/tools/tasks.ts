import { z } from 'zod';
import { database } from '../services/database.js';
import { ISODate, Priority, UserId, jsonResult, toolError } from './_shared.js';

// -----------------------------------------------------------------------------
// get_tasks
// -----------------------------------------------------------------------------

export const getTasksSchema = {
  userId: UserId.describe('Identifier of the user whose tasks to retrieve.'),
  date: ISODate
    .optional()
    .describe('Optional YYYY-MM-DD to filter to tasks due on this date (or with no due date).'),
  status: z
    .enum(['pending', 'completed', 'cancelled'])
    .optional()
    .describe('Optional status filter.'),
  priority: Priority.optional().describe('Optional priority filter.'),
};

export const getTasksZod = z.object(getTasksSchema);
export type GetTasksInput = z.infer<typeof getTasksZod>;

export async function getTasksHandler(input: GetTasksInput) {
  const tasks = database.listTasks(input);
  return jsonResult({ tasks, count: tasks.length });
}

// -----------------------------------------------------------------------------
// complete_task
// -----------------------------------------------------------------------------

export const completeTaskSchema = {
  userId: UserId.describe('Identifier of the user who owns the task.'),
  taskId: z.string().min(1).describe('Identifier of the task to mark completed.'),
};

export const completeTaskZod = z.object(completeTaskSchema);
export type CompleteTaskInput = z.infer<typeof completeTaskZod>;

export async function completeTaskHandler(input: CompleteTaskInput) {
  const existing = database.getTaskById(input.taskId);
  if (!existing || existing.userId !== input.userId) {
    return toolError('That task could not be found.', { taskId: input.taskId });
  }
  if (existing.status === 'completed') {
    return jsonResult({
      task: existing,
      alreadyCompleted: true,
      message: 'Task was already marked complete.',
    });
  }
  const updated = database.completeTask(input.userId, input.taskId);
  return jsonResult({
    task: updated,
    alreadyCompleted: false,
    message: `Marked "${updated?.title}" complete.`,
  });
}
