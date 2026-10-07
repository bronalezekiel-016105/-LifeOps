/**
 * Core domain types. All tool inputs/outputs are built from these.
 */

export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  priority: Priority;
  status: TaskStatus;
  /** ISO 8601 date (YYYY-MM-DD) the task is due on. */
  dueDate: string | null;
  /** Estimated effort in minutes. */
  estimatedMinutes: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  location: string | null;
  /** ISO 8601 datetime, local time. */
  startAt: string;
  endAt: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  /** ISO 8601 datetime the reminder should fire. */
  remindAt: string;
  status: 'scheduled' | 'fired' | 'cancelled';
  createdAt: string;
  /** Optional link to the task/event that inspired this reminder. */
  relatedTaskId: string | null;
  relatedEventId: string | null;
}

/** A single block on the generated daily plan. */
export interface PlanBlock {
  startAt: string;
  endAt: string;
  kind: 'task' | 'event' | 'break';
  title: string;
  /** For task blocks: link back to the task. */
  taskId?: string;
  /** For event blocks: link back to the event. */
  eventId?: string;
  /** Human-readable reason this block is here. Shown in the UI. */
  reason: string;
}

export interface DailyPlan {
  userId: string;
  date: string;
  blocks: PlanBlock[];
  /** Two–three sentence natural-language summary. */
  summary: string;
  /** Warnings surfaced during planning (conflicts, overloads, etc). */
  warnings: string[];
  /** Which planner produced this — helpful in demos and debugging. */
  generatedBy: 'bedrock' | 'deterministic';
}
