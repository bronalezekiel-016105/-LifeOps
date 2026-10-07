/**
 * Seed the SQLite database with the demo dataset described in spec §13.
 *
 * Idempotent: running it repeatedly wipes prior demo data and reseeds. Real
 * users of the tool (not "demo-user") are never touched.
 */
import { database } from '../services/database.js';
import { logger } from '../lib/logger.js';

const USER = 'demo-user';

/** Today, in local time, as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoAt(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

/**
 * ISO string N minutes from now, rounded to the nearest quarter-hour so times
 * look tidy in the UI ("2:15 PM" rather than "2:14:37 PM").
 */
function inMinutes(mins: number): string {
  const d = new Date(Date.now() + mins * 60_000);
  const q = 15;
  d.setMinutes(Math.round(d.getMinutes() / q) * q, 0, 0);
  return d.toISOString();
}

function wipeDemoUser() {
  const db = database.raw;
  db.prepare(`DELETE FROM reminders WHERE user_id = ?`).run(USER);
  db.prepare(`DELETE FROM events    WHERE user_id = ?`).run(USER);
  db.prepare(`DELETE FROM tasks     WHERE user_id = ?`).run(USER);
  db.prepare(`DELETE FROM users     WHERE id = ?`).run(USER);
}

function seed() {
  wipeDemoUser();
  database.ensureUser(USER, 'Demo User');

  const dueToday = today();

  database.createTask({
    userId: USER,
    title: 'Finish project proposal',
    priority: 'high',
    estimatedMinutes: 90,
    dueDate: dueToday,
    notes: 'Final draft for the Q4 initiative.',
  });
  database.createTask({
    userId: USER,
    title: 'Review financial report',
    priority: 'medium',
    estimatedMinutes: 45,
    dueDate: dueToday,
  });
  database.createTask({
    userId: USER,
    title: 'Reply to client emails',
    priority: 'medium',
    estimatedMinutes: 30,
    dueDate: dueToday,
  });
  database.createTask({
    userId: USER,
    title: 'Update project documentation',
    priority: 'low',
    estimatedMinutes: 45,
    dueDate: dueToday,
  });

  // Events are seeded relative to "now" so the demo scenario ("Plan my afternoon")
  // always has future events to reason about, regardless of the wall-clock hour
  // the demo is run. Titles + shape match spec §13.
  database.createEvent({
    userId: USER,
    title: 'Focused work',
    startAt: inMinutes(30),
    endAt: inMinutes(120),
    location: null,
  });
  database.createEvent({
    userId: USER,
    title: 'Team meeting',
    startAt: inMinutes(150),
    endAt: inMinutes(210),
    location: 'Conference room B',
  });
  database.createEvent({
    userId: USER,
    title: 'Client call',
    startAt: inMinutes(240),
    endAt: inMinutes(270),
    location: 'Zoom',
  });

  logger.info({ user: USER, date: dueToday }, 'demo data seeded');
}

seed();
database.close();
