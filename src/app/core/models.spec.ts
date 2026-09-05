import { describe, expect, it } from 'vitest';
import { normalizeTodoColor, normalizeTodoEndAt, todoDeadlineProgress } from './models';

describe('task deadlines', () => {
  it('normalizes valid timestamps and rejects invalid values', () => {
    expect(normalizeTodoEndAt('2026-09-03T18:30:00Z')).toBe('2026-09-03T18:30:00.000Z');
    expect(normalizeTodoEndAt('not-a-date')).toBeNull();
    expect(normalizeTodoEndAt('')).toBeNull();
  });

  it('calculates deadline progress and clamps it to the bar range', () => {
    const todo = {
      createdAt: '2026-09-03T08:00:00.000Z',
      endAt: '2026-09-03T10:00:00.000Z',
    };

    expect(todoDeadlineProgress(todo, Date.parse('2026-09-03T07:00:00.000Z'))).toBe(0);
    expect(todoDeadlineProgress(todo, Date.parse('2026-09-03T09:00:00.000Z'))).toBe(50);
    expect(todoDeadlineProgress(todo, Date.parse('2026-09-03T11:00:00.000Z'))).toBe(100);
  });

  it('returns no progress when a task has no valid deadline', () => {
    expect(todoDeadlineProgress({ createdAt: '2026-09-03T08:00:00.000Z', endAt: null })).toBe(0);
    expect(todoDeadlineProgress({ createdAt: 'invalid', endAt: '2026-09-03T10:00:00.000Z' })).toBe(0);
  });
});

describe('task colors', () => {
  it('accepts palette values and rejects unsupported colors', () => {
    expect(normalizeTodoColor('blue')).toBe('blue');
    expect(normalizeTodoColor('chartreuse')).toBeNull();
    expect(normalizeTodoColor(null)).toBeNull();
  });
});
