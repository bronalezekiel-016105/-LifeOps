import { describe, expect, it } from 'vitest';
import {
  buildDeterministicPlan,
  computeFreeIntervals,
  detectConflicts,
} from '../src/services/planner.js';
import type { CalendarEvent, Task } from '../src/types/domain.js';

const iso = (isoString: string) => new Date(isoString).toISOString();

function mkTask(o: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    id: o.id,
    userId: 'u',
    title: o.title,
    notes: null,
    priority: o.priority ?? 'medium',
    status: o.status ?? 'pending',
    dueDate: o.dueDate ?? null,
    estimatedMinutes: o.estimatedMinutes ?? 30,
    createdAt: iso('2026-01-01T00:00:00Z'),
    updatedAt: iso('2026-01-01T00:00:00Z'),
    completedAt: o.completedAt ?? null,
  };
}

function mkEvent(o: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'startAt' | 'endAt'>): CalendarEvent {
  return {
    id: o.id,
    userId: 'u',
    title: o.title,
    location: o.location ?? null,
    startAt: o.startAt,
    endAt: o.endAt,
    createdAt: iso('2026-01-01T00:00:00Z'),
  };
}

describe('planner: computeFreeIntervals', () => {
  it('returns the whole window when there are no events', () => {
    const s = new Date('2026-01-01T09:00:00Z').getTime();
    const e = new Date('2026-01-01T18:00:00Z').getTime();
    const gaps = computeFreeIntervals(s, e, []);
    expect(gaps).toEqual([{ start: s, end: e }]);
  });

  it('splits the window around an event', () => {
    const s = new Date('2026-01-01T09:00:00Z').getTime();
    const e = new Date('2026-01-01T18:00:00Z').getTime();
    const events = [
      mkEvent({
        id: 'a',
        title: 'meeting',
        startAt: '2026-01-01T13:00:00Z',
        endAt: '2026-01-01T14:00:00Z',
      }),
    ];
    const gaps = computeFreeIntervals(s, e, events);
    expect(gaps).toHaveLength(2);
  });

  it('ignores gaps shorter than 15 minutes', () => {
    const s = new Date('2026-01-01T09:00:00Z').getTime();
    const e = new Date('2026-01-01T18:00:00Z').getTime();
    const events = [
      mkEvent({
        id: 'a',
        title: 'a',
        startAt: '2026-01-01T09:00:00Z',
        endAt: '2026-01-01T09:10:00Z',
      }),
    ];
    const gaps = computeFreeIntervals(s, e, events);
    // Only the 09:10–18:00 gap remains; the 0-minute prefix and the 10-minute
    // sliver before it are dropped.
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.start).toBe(new Date('2026-01-01T09:10:00Z').getTime());
  });
});

describe('planner: detectConflicts', () => {
  it('detects overlapping events', () => {
    const conflicts = detectConflicts([
      mkEvent({
        id: 'a',
        title: 'A',
        startAt: '2026-01-01T09:00:00Z',
        endAt: '2026-01-01T10:00:00Z',
      }),
      mkEvent({
        id: 'b',
        title: 'B',
        startAt: '2026-01-01T09:30:00Z',
        endAt: '2026-01-01T10:30:00Z',
      }),
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it('ignores back-to-back events', () => {
    const conflicts = detectConflicts([
      mkEvent({
        id: 'a',
        title: 'A',
        startAt: '2026-01-01T09:00:00Z',
        endAt: '2026-01-01T10:00:00Z',
      }),
      mkEvent({
        id: 'b',
        title: 'B',
        startAt: '2026-01-01T10:00:00Z',
        endAt: '2026-01-01T11:00:00Z',
      }),
    ]);
    expect(conflicts).toHaveLength(0);
  });
});

describe('planner: buildDeterministicPlan', () => {
  it('places high-priority tasks first', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const plan = buildDeterministicPlan({
      userId: 'u',
      date: '2026-01-01',
      now,
      tasks: [
        mkTask({ id: 't1', title: 'Low', priority: 'low', estimatedMinutes: 30 }),
        mkTask({ id: 't2', title: 'High', priority: 'high', estimatedMinutes: 30 }),
      ],
      events: [],
    });
    const taskBlocks = plan.blocks.filter((b) => b.kind === 'task');
    expect(taskBlocks[0]!.title).toBe('High');
  });

  it('front-loads overdue tasks above high-priority-today', () => {
    const now = new Date('2026-01-05T08:00:00Z');
    const plan = buildDeterministicPlan({
      userId: 'u',
      date: '2026-01-05',
      now,
      tasks: [
        mkTask({
          id: 't-overdue',
          title: 'Overdue medium',
          priority: 'medium',
          dueDate: '2026-01-03',
          estimatedMinutes: 30,
        }),
        mkTask({
          id: 't-today',
          title: 'High today',
          priority: 'high',
          dueDate: '2026-01-05',
          estimatedMinutes: 30,
        }),
      ],
      events: [],
    });
    const taskBlocks = plan.blocks.filter((b) => b.kind === 'task');
    expect(taskBlocks[0]!.title).toBe('Overdue medium');
  });

  it('reports unplaced tasks in warnings', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const plan = buildDeterministicPlan({
      userId: 'u',
      date: '2026-01-01',
      now,
      windowStart: '09:00',
      windowEnd: '10:00', // only 60 minutes available
      tasks: [
        mkTask({ id: 't1', title: 'A', estimatedMinutes: 40 }),
        mkTask({ id: 't2', title: 'B', estimatedMinutes: 40 }),
      ],
      events: [],
    });
    expect(plan.warnings.some((w) => /could not be placed/.test(w))).toBe(true);
  });

  it('marks output as deterministic when Bedrock is not called', () => {
    const plan = buildDeterministicPlan({
      userId: 'u',
      date: '2026-01-01',
      now: new Date('2026-01-01T08:00:00Z'),
      tasks: [],
      events: [],
    });
    expect(plan.generatedBy).toBe('deterministic');
  });
});
