import { Injectable, computed, signal } from '@angular/core';
import type { AppSettings, ScheduleSnapshot, TodoItem } from './models';

const EMPTY_SCHEDULE: ScheduleSnapshot = {
  syncedAt: '',
  weekStart: '',
  weekEnd: '',
  sessions: [],
  courses: [],
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  tuningEnabled: false,
  tunedTime: null,
};

@Injectable({ providedIn: 'root' })
export class LocalStore {
  readonly schedule = signal(this.read<ScheduleSnapshot>('schedule', EMPTY_SCHEDULE));
  readonly todos = signal(this.readTodos());
  readonly settings = signal(this.read<AppSettings>('settings', DEFAULT_SETTINGS));
  readonly hasSchedule = computed(() => this.schedule().sessions.length > 0);

  constructor() {
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== localStorage || !event.key) return;
      if (event.key === this.key('schedule')) this.schedule.set(this.parse(event.newValue, EMPTY_SCHEDULE));
      if (event.key === this.key('todos')) this.todos.set(this.parseTodos(event.newValue));
      if (event.key === this.key('settings')) {
        this.settings.set(this.parse(event.newValue, DEFAULT_SETTINGS));
        this.applyTheme();
      }
    });
  }

  saveSchedule(value: ScheduleSnapshot): void {
    this.schedule.set(value);
    this.write('schedule', value);
  }

  addTodo(title: string, details = ''): void {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const value: TodoItem = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      details: details.trim(),
      createdAt: new Date().toISOString(),
    };
    this.todos.update((items) => [value, ...items]);
    this.write('todos', this.todos());
  }

  updateTodo(id: string, title: string, details = ''): boolean {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !this.todos().some((item) => item.id === id)) return false;
    this.todos.update((items) => items.map((item) => item.id === id
      ? { ...item, title: trimmedTitle, details: details.trim() }
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
    localStorage.removeItem(this.key('todos'));
    this.schedule.set(EMPTY_SCHEDULE);
    this.todos.set([]);
  }

  applyTheme(): void {
    const mode = this.settings().theme;
    const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-theme', dark);
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
