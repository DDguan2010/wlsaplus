import { Injectable, computed, signal } from '@angular/core';
import { normalizeTodoColor, normalizeTodoEndAt } from './models';
import type { AppColor, AppSettings, ProgressCourse, ProgressSnapshot, ScheduleSnapshot, ThemeMode, TodoColor, TodoItem } from './models';

const EMPTY_SCHEDULE: ScheduleSnapshot = {
  syncedAt: '',
  weekStart: '',
  weekEnd: '',
  sessions: [],
  courses: [],
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  color: 'default',
  tuningEnabled: false,
  tunedTime: null,
};

const EMPTY_PROGRESS: ProgressSnapshot = {
  syncedAt: '',
  term: '',
  absenceTotal: null,
  tardyTotal: null,
  attendanceStart: '',
  attendanceEnd: '',
  courses: [],
  attendanceEvents: [],
};

const THEME_MODES = new Set<ThemeMode>(['system', 'light', 'dark']);
const APP_COLORS = new Set<AppColor>(['default', 'blue', 'green', 'purple', 'rose']);

@Injectable({ providedIn: 'root' })
export class LocalStore {
  readonly schedule = signal(this.read<ScheduleSnapshot>('schedule', EMPTY_SCHEDULE));
  readonly progress = signal(this.read<ProgressSnapshot>('progress', EMPTY_PROGRESS));
  readonly todos = signal(this.readTodos());
  readonly settings = signal(this.readSettings());
  readonly hasSchedule = computed(() => this.schedule().sessions.length > 0);
  readonly hasProgress = computed(() => this.progress().courses.length > 0 || this.progress().syncedAt !== '');

  constructor() {
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== localStorage || !event.key) return;
      if (event.key === this.key('schedule')) this.schedule.set(this.parse(event.newValue, EMPTY_SCHEDULE));
      if (event.key === this.key('progress')) this.progress.set(this.parse(event.newValue, EMPTY_PROGRESS));
      if (event.key === this.key('todos')) this.todos.set(this.parseTodos(event.newValue));
      if (event.key === this.key('settings')) {
        this.settings.set(this.parseSettings(event.newValue));
        this.applyTheme();
      }
    });
  }

  saveSchedule(value: ScheduleSnapshot): void {
    this.schedule.set(value);
    this.write('schedule', value);
  }

  addTodo(title: string, details = '', endAt: string | null = null, color: TodoColor | null = null): void {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const value: TodoItem = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      details: details.trim(),
      createdAt: new Date().toISOString(),
      endAt: normalizeTodoEndAt(endAt),
      color: normalizeTodoColor(color),
    };
    this.todos.update((items) => [value, ...items]);
    this.write('todos', this.todos());
  }

  saveProgress(value: ProgressSnapshot): void {
    const previous = new Map(this.progress().courses.map((course) => [course.id, course]));
    const merged = {
      ...value,
      courses: value.courses.map((course) => {
        const cached = previous.get(course.id);
        return cached?.details && cached.detailsPath === course.detailsPath
          ? { ...course, details: cached.details }
          : course;
      }),
    };
    this.progress.set(merged);
    this.write('progress', merged);
  }

  updateProgressCourse(courseId: string, patch: Partial<ProgressCourse>): ProgressCourse | null {
    let updated: ProgressCourse | null = null;
    this.progress.update((snapshot) => ({
      ...snapshot,
      courses: snapshot.courses.map((course) => {
        if (course.id !== courseId) return course;
        updated = { ...course, ...patch };
        return updated;
      }),
    }));
    if (updated) this.write('progress', this.progress());
    return updated;
  }

  updateTodo(id: string, title: string, details = '', endAt?: string | null, color?: TodoColor | null): boolean {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !this.todos().some((item) => item.id === id)) return false;
    this.todos.update((items) => items.map((item) => item.id === id
      ? {
        ...item,
        title: trimmedTitle,
        details: details.trim(),
        endAt: endAt === undefined ? item.endAt : normalizeTodoEndAt(endAt),
        color: color === undefined ? item.color : normalizeTodoColor(color),
      }
      : item));
    this.write('todos', this.todos());
    return true;
  }

  removeTodo(id: string): TodoItem | null {
    const removed = this.todos().find((item) => item.id === id) ?? null;
    this.todos.update((items) => items.filter((item) => item.id !== id));
    this.write('todos', this.todos());
    return removed;
  }

  restoreTodo(item: TodoItem): void {
    this.todos.update((items) => [item, ...items]);
    this.write('todos', this.todos());
  }

  updateSettings(patch: Partial<AppSettings>): void {
    this.settings.update((value) => ({ ...value, ...patch }));
    this.write('settings', this.settings());
    this.applyTheme();
  }

  clearAll(): void {
    localStorage.removeItem(this.key('schedule'));
    localStorage.removeItem(this.key('progress'));
    localStorage.removeItem(this.key('todos'));
    this.schedule.set(EMPTY_SCHEDULE);
    this.progress.set(EMPTY_PROGRESS);
    this.todos.set([]);
  }

  applyTheme(): void {
    const { theme: mode, color } = this.settings();
    const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-theme', dark);
    document.documentElement.dataset['appColor'] = color;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101114' : '#ffffff');
  }

  private key(name: string): string {
    return `wlsaplus:${name}`;
  }

  private read<T>(name: string, fallback: T): T {
    return this.parse(localStorage.getItem(this.key(name)), fallback);
  }

  private readTodos(): TodoItem[] {
    return this.parseTodos(localStorage.getItem(this.key('todos')));
  }

  private readSettings(): AppSettings {
    return this.parseSettings(localStorage.getItem(this.key('settings')));
  }

  private parseSettings(raw: string | null): AppSettings {
    const parsed = this.parse<unknown>(raw, DEFAULT_SETTINGS);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    const value = parsed as Record<string, unknown>;
    return {
      theme: THEME_MODES.has(value['theme'] as ThemeMode) ? value['theme'] as ThemeMode : DEFAULT_SETTINGS.theme,
      color: APP_COLORS.has(value['color'] as AppColor) ? value['color'] as AppColor : DEFAULT_SETTINGS.color,
      tuningEnabled: typeof value['tuningEnabled'] === 'boolean' ? value['tuningEnabled'] : DEFAULT_SETTINGS.tuningEnabled,
      tunedTime: typeof value['tunedTime'] === 'string' ? value['tunedTime'] : null,
    };
  }

  private parseTodos(raw: string | null): TodoItem[] {
    const values = this.parse<unknown>(raw, []);
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const title = typeof item['title'] === 'string'
        ? item['title'].trim()
        : typeof item['text'] === 'string' ? item['text'].trim() : '';
      if (!title || typeof item['id'] !== 'string' || typeof item['createdAt'] !== 'string') return [];
      return [{
        id: item['id'],
        title,
        details: typeof item['details'] === 'string' ? item['details'].trim() : '',
        createdAt: item['createdAt'],
        endAt: normalizeTodoEndAt(item['endAt']),
        color: normalizeTodoColor(item['color']),
      }];
    });
  }

  private parse<T>(raw: string | null, fallback: T): T {
    try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
  }

  private write(name: string, value: unknown): void {
    localStorage.setItem(this.key(name), JSON.stringify(value));
  }
}
