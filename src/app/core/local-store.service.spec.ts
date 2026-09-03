import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './local-store.service';
import type { AppSettings, ScheduleSnapshot, TodoItem } from './models';

describe('LocalStore', () => {
  beforeEach(() => localStorage.clear());

  it('refreshes schedule and todos written by another window', () => {
    const store = new LocalStore();
    const schedule: ScheduleSnapshot = {
      syncedAt: '2026-08-29T08:00:00.000Z',
      weekStart: '2026-08-24',
      weekEnd: '2026-08-28',
      sessions: [{ id: 'session-1', courseId: null, courseName: 'Advisory', teacher: '', room: '', startsAt: '2026-08-24T08:00:00', endsAt: '2026-08-24T08:10:00' }],
      courses: [],
    };
    const todos: TodoItem[] = [{ id: 'todo-1', title: 'Submit essay', details: 'Upload the final PDF.', createdAt: '2026-08-29T08:00:00.000Z', endAt: null }];
    const settings: AppSettings = { theme: 'dark', tuningEnabled: true, tunedTime: '2026-08-24T08:05:00.000Z' };

    window.dispatchEvent(new StorageEvent('storage', { key: 'wlsaplus:schedule', newValue: JSON.stringify(schedule), storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wlsaplus:todos', newValue: JSON.stringify(todos), storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wlsaplus:settings', newValue: JSON.stringify(settings), storageArea: localStorage }));

    expect(store.schedule()).toEqual(schedule);
    expect(store.todos()).toEqual(todos);
    expect(store.settings()).toEqual(settings);
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
  });

  it('loads old text-only tasks as titles', () => {
    localStorage.setItem('wlsaplus:todos', JSON.stringify([{ id: 'todo-1', text: 'Legacy task', createdAt: '2026-08-29T08:00:00.000Z' }]));
    const store = new LocalStore();

    expect(store.todos()).toEqual([{ id: 'todo-1', title: 'Legacy task', details: '', createdAt: '2026-08-29T08:00:00.000Z', endAt: null }]);
  });

  it('adds and edits task titles and details', () => {
    const store = new LocalStore();
    store.addTodo('  Draft essay  ', '  Include three sources.  ');
    const todo = store.todos()[0];

    expect(todo).toMatchObject({ title: 'Draft essay', details: 'Include three sources.' });
    expect(store.updateTodo(todo.id, 'Final essay', 'Submit as PDF.')).toBe(true);
    expect(store.todos()[0]).toMatchObject({ title: 'Final essay', details: 'Submit as PDF.' });
  });

  it('adds, edits, preserves, and clears task end times', () => {
    const store = new LocalStore();
    store.addTodo('Draft essay', '', '2026-09-03T18:30:00.000Z');
    const todo = store.todos()[0];

    expect(todo.endAt).toBe('2026-09-03T18:30:00.000Z');

    expect(store.updateTodo(todo.id, 'Draft essay', 'Add citations.')).toBe(true);
    expect(store.todos()[0].endAt).toBe('2026-09-03T18:30:00.000Z');

    expect(store.updateTodo(todo.id, 'Draft essay', 'Add citations.', '2026-09-04T09:00:00.000Z')).toBe(true);
    expect(store.todos()[0].endAt).toBe('2026-09-04T09:00:00.000Z');

    expect(store.updateTodo(todo.id, 'Draft essay', 'Add citations.', null)).toBe(true);
    expect(store.todos()[0].endAt).toBeNull();
  });

  it('normalizes invalid stored task end times to no deadline', () => {
    localStorage.setItem('wlsaplus:todos', JSON.stringify([{
      id: 'todo-1',
      title: 'Legacy task',
      details: '',
      createdAt: '2026-08-29T08:00:00.000Z',
      endAt: 'not-a-date',
    }]));

    expect(new LocalStore().todos()[0].endAt).toBeNull();
  });
});
