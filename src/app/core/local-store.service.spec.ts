import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './local-store.service';
import type { AppSettings, ProgressSnapshot, ScheduleSnapshot, TodoItem } from './models';

describe('LocalStore', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark-theme');
    delete document.documentElement.dataset['appColor'];
  });

  it('refreshes schedule and todos written by another window', () => {
    const store = new LocalStore();
    const schedule: ScheduleSnapshot = {
      syncedAt: '2026-08-29T08:00:00.000Z',
      weekStart: '2026-08-24',
      weekEnd: '2026-08-28',
      sessions: [{ id: 'session-1', courseId: null, courseName: 'Advisory', teacher: '', room: '', startsAt: '2026-08-24T08:00:00', endsAt: '2026-08-24T08:10:00' }],
      courses: [],
    };
    const todos: TodoItem[] = [{ id: 'todo-1', title: 'Submit essay', details: 'Upload the final PDF.', createdAt: '2026-08-29T08:00:00.000Z', endAt: null, color: 'blue' }];
    const settings: AppSettings = { theme: 'dark', color: 'green', tuningEnabled: true, tunedTime: '2026-08-24T08:05:00.000Z' };

    window.dispatchEvent(new StorageEvent('storage', { key: 'wlsaplus:schedule', newValue: JSON.stringify(schedule), storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wlsaplus:todos', newValue: JSON.stringify(todos), storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wlsaplus:settings', newValue: JSON.stringify(settings), storageArea: localStorage }));

    expect(store.schedule()).toEqual(schedule);
    expect(store.todos()).toEqual(todos);
    expect(store.settings()).toEqual(settings);
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(document.documentElement.dataset['appColor']).toBe('green');
  });

  it('migrates existing appearance settings to the default app color', () => {
    localStorage.setItem('wlsaplus:settings', JSON.stringify({ theme: 'light', tuningEnabled: false, tunedTime: null }));

    expect(new LocalStore().settings()).toEqual({ theme: 'light', color: 'default', tuningEnabled: false, tunedTime: null });
  });

  it('saves and applies the selected app color', () => {
    const store = new LocalStore();

    store.updateSettings({ theme: 'light', color: 'purple' });

    expect(store.settings().color).toBe('purple');
    expect(JSON.parse(localStorage.getItem('wlsaplus:settings') ?? '{}').color).toBe('purple');
    expect(document.documentElement.dataset['appColor']).toBe('purple');
    expect(new LocalStore().settings().color).toBe('purple');
  });

  it('loads old text-only tasks as titles', () => {
    localStorage.setItem('wlsaplus:todos', JSON.stringify([{ id: 'todo-1', text: 'Legacy task', createdAt: '2026-08-29T08:00:00.000Z' }]));
    const store = new LocalStore();

    expect(store.todos()).toEqual([{ id: 'todo-1', title: 'Legacy task', details: '', createdAt: '2026-08-29T08:00:00.000Z', endAt: null, color: null }]);
  });

  it('stores progress and preserves loaded course details across summary refreshes', () => {
    const store = new LocalStore();
    const progress: ProgressSnapshot = {
      syncedAt: '2026-09-04T08:00:00.000Z', term: 'S1', absenceTotal: 0, tardyTotal: 0,
      attendanceStart: '2026-08-24', attendanceEnd: '2027-01-24', attendanceEvents: [],
      courses: [{ id: 'course-1', name: 'Algebra', teacher: 'Teacher', room: '210', meetingPattern: 'P1', term: 'S1', grade: '', absences: 0, tardies: 0, detailsPath: '/guardian/scores.html?course=1', details: null }],
    };
    store.saveProgress(progress);
    store.updateProgressCourse('course-1', { details: { description: '', teacherComment: '', assignments: [], loadedAt: '2026-09-04T08:01:00.000Z' } });

    store.saveProgress({ ...progress, syncedAt: '2026-09-04T08:15:00.000Z', courses: progress.courses.map((course) => ({ ...course, grade: 'A' })) });

    expect(store.progress().courses[0].grade).toBe('A');
    expect(store.progress().courses[0].details?.loadedAt).toBe('2026-09-04T08:01:00.000Z');
    expect(JSON.parse(localStorage.getItem('wlsaplus:progress') ?? '{}').courses).toHaveLength(1);
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

  it('adds, edits, preserves, and clears task colors', () => {
    const store = new LocalStore();
    store.addTodo('Draft essay', '', null, 'blue');
    const todo = store.todos()[0];

    expect(todo.color).toBe('blue');

    expect(store.updateTodo(todo.id, 'Draft essay', 'Add citations.')).toBe(true);
    expect(store.todos()[0].color).toBe('blue');

    expect(store.updateTodo(todo.id, 'Draft essay', 'Add citations.', undefined, 'purple')).toBe(true);
    expect(store.todos()[0].color).toBe('purple');

    expect(store.updateTodo(todo.id, 'Draft essay', 'Add citations.', undefined, null)).toBe(true);
    expect(store.todos()[0].color).toBeNull();
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

  it('normalizes invalid stored task colors to no color', () => {
    localStorage.setItem('wlsaplus:todos', JSON.stringify([{
      id: 'todo-1',
      title: 'Legacy task',
      details: '',
      createdAt: '2026-08-29T08:00:00.000Z',
      endAt: null,
      color: 'chartreuse',
    }]));

    expect(new LocalStore().todos()[0].color).toBeNull();
  });
});
