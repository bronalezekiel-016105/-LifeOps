/**
 * Database service — thin, synchronous SQLite layer using better-sqlite3.
 *
 * Why SQLite? Zero-config, one file, works identically in tests, CI, and
 * demos. The tool layer never touches SQL directly; it goes through this
 * module, which means the storage engine can be swapped for DynamoDB in
 * production without changing any tool code.
 */
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type {
  CalendarEvent,
  DailyPlan,
  Priority,
  Reminder,
  Task,
  TaskStatus,
} from '../types/domain.js';

const dbFile = resolve(config.db.file);
mkdirSync(dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- Schema ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
    status TEXT NOT NULL CHECK (status IN ('pending','completed','cancelled')),
    due_date TEXT,
    estimated_minutes INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_user_start ON events(user_id, start_at);

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    remind_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled','fired','cancelled')),
    created_at TEXT NOT NULL,
    related_task_id TEXT,
    related_event_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_user_time ON reminders(user_id, remind_at);
`);

logger.info({ dbFile }, 'sqlite database ready');

// ---------- Row → domain mappers ----------

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  priority: Priority;
  status: TaskStatus;
  due_date: string | null;
  estimated_minutes: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
const rowToTask = (r: TaskRow): Task => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  notes: r.notes,
  priority: r.priority,
  status: r.status,
  dueDate: r.due_date,
  estimatedMinutes: r.estimated_minutes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});

interface EventRow {
  id: string;
  user_id: string;
  title: string;
  location: string | null;
  start_at: string;
  end_at: string;
  created_at: string;
}
const rowToEvent = (r: EventRow): CalendarEvent => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  location: r.location,
  startAt: r.start_at,
  endAt: r.end_at,
  createdAt: r.created_at,
});

interface ReminderRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  status: Reminder['status'];
  created_at: string;
  related_task_id: string | null;
  related_event_id: string | null;
}
const rowToReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  notes: r.notes,
  remindAt: r.remind_at,
  status: r.status,
  createdAt: r.created_at,
  relatedTaskId: r.related_task_id,
  relatedEventId: r.related_event_id,
});

// ---------- Public API ----------

export interface DatabaseService {
  raw: BetterSqliteDatabase;
  ensureUser(userId: string, displayName?: string, timezone?: string): void;
  createTask(input: {
    userId: string;
    title: string;
    notes?: string | null;
    priority: Priority;
    dueDate?: string | null;
    estimatedMinutes?: number;
  }): Task;
  getTaskById(id: string): Task | undefined;
  listTasks(filter: {
    userId: string;
    date?: string;
    status?: TaskStatus;
    priority?: Priority;
  }): Task[];
  completeTask(userId: string, taskId: string): Task | undefined;
  createEvent(input: {
    userId: string;
    title: string;
    location?: string | null;
    startAt: string;
    endAt: string;
  }): CalendarEvent;
  getEventById(id: string): CalendarEvent | undefined;
  listEvents(filter: {
    userId: string;
    date?: string;
    startTime?: string;
    endTime?: string;
  }): CalendarEvent[];
  createReminder(input: {
    userId: string;
    title: string;
    notes?: string | null;
    remindAt: string;
    relatedTaskId?: string | null;
    relatedEventId?: string | null;
  }): Reminder;
  getReminderById(id: string): Reminder | undefined;
  listReminders(filter: { userId: string; date?: string }): Reminder[];
  reset(): void;
  close(): void;
}

export const database: DatabaseService = {
  raw: db,

  ensureUser(userId: string, displayName = 'Demo User', timezone = 'UTC'): void {
    db.prepare(
      `INSERT INTO users (id, display_name, timezone, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(userId, displayName, timezone, new Date().toISOString());
  },

  // ---- Tasks ----

  createTask(input: {
    userId: string;
    title: string;
    notes?: string | null;
    priority: Priority;
    dueDate?: string | null;
    estimatedMinutes?: number;
  }): Task {
    const now = new Date().toISOString();
    const id = `task-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO tasks (id, user_id, title, notes, priority, status, due_date, estimated_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      id,
      input.userId,
      input.title,
      input.notes ?? null,
      input.priority,
      input.dueDate ?? null,
      input.estimatedMinutes ?? 30,
      now,
      now
    );
    return this.getTaskById(id)!;
  },

  getTaskById(id: string): Task | undefined {
    const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  },

  listTasks(filter: {
    userId: string;
    date?: string;
    status?: TaskStatus;
    priority?: Priority;
  }): Task[] {
    const clauses: string[] = ['user_id = ?'];
    const params: unknown[] = [filter.userId];
    if (filter.date) {
      clauses.push('(due_date = ? OR due_date IS NULL)');
      params.push(filter.date);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.priority) {
      clauses.push('priority = ?');
      params.push(filter.priority);
    }
    const sql = `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      due_date IS NULL, due_date, created_at`;
    return (db.prepare(sql).all(...params) as TaskRow[]).map(rowToTask);
  },

  completeTask(userId: string, taskId: string): Task | undefined {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status != 'completed'`
      )
      .run(now, now, taskId, userId);
    if (info.changes === 0) {
      // Either not found, wrong user, or already completed. Return current state (or undefined).
      return this.getTaskById(taskId);
    }
    return this.getTaskById(taskId);
  },

  // ---- Events ----

  createEvent(input: {
    userId: string;
    title: string;
    location?: string | null;
    startAt: string;
    endAt: string;
  }): CalendarEvent {
    const now = new Date().toISOString();
    const id = `evt-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO events (id, user_id, title, location, start_at, end_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.userId, input.title, input.location ?? null, input.startAt, input.endAt, now);
    return this.getEventById(id)!;
  },

  getEventById(id: string): CalendarEvent | undefined {
    const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  },

  listEvents(filter: {
    userId: string;
    date?: string;
    startTime?: string;
    endTime?: string;
  }): CalendarEvent[] {
    const clauses: string[] = ['user_id = ?'];
    const params: unknown[] = [filter.userId];
    if (filter.date) {
      // Simple prefix match against ISO date.
      clauses.push("substr(start_at, 1, 10) = ?");
      params.push(filter.date);
    }
    if (filter.startTime) {
      clauses.push('start_at >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime) {
      clauses.push('end_at <= ?');
      params.push(filter.endTime);
    }
    const sql = `SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY start_at`;
    return (db.prepare(sql).all(...params) as EventRow[]).map(rowToEvent);
  },

  // ---- Reminders ----

  createReminder(input: {
    userId: string;
    title: string;
    notes?: string | null;
    remindAt: string;
    relatedTaskId?: string | null;
    relatedEventId?: string | null;
  }): Reminder {
    const now = new Date().toISOString();
    const id = `rem-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO reminders (id, user_id, title, notes, remind_at, status, created_at, related_task_id, related_event_id)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`
    ).run(
      id,
      input.userId,
      input.title,
      input.notes ?? null,
      input.remindAt,
      now,
      input.relatedTaskId ?? null,
      input.relatedEventId ?? null
    );
    return this.getReminderById(id)!;
  },

  getReminderById(id: string): Reminder | undefined {
    const row = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as
      | ReminderRow
      | undefined;
    return row ? rowToReminder(row) : undefined;
  },

  listReminders(filter: { userId: string; date?: string }): Reminder[] {
    const clauses: string[] = ['user_id = ?'];
    const params: unknown[] = [filter.userId];
    if (filter.date) {
      clauses.push("substr(remind_at, 1, 10) = ?");
      params.push(filter.date);
    }
    const sql = `SELECT * FROM reminders WHERE ${clauses.join(' AND ')} ORDER BY remind_at`;
    return (db.prepare(sql).all(...params) as ReminderRow[]).map(rowToReminder);
  },

  // ---- Cleanup for tests / demo reset ----

  reset(): void {
    db.exec(`
      DELETE FROM reminders;
      DELETE FROM events;
      DELETE FROM tasks;
      DELETE FROM users;
    `);
  },

  close(): void {
    db.close();
  },
};

// Re-export the DailyPlan type solely to keep imports tidy at the tool layer.
export type { DailyPlan };
