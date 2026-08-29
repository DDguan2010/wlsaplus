import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalStore } from './local-store.service';

@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly store = inject(LocalStore);
  private readonly tick = signal(Date.now());
  readonly now = computed(() => {
    this.tick();
    const settings = this.store.settings();
    return settings.tuningEnabled && settings.tunedTime
      ? new Date(settings.tunedTime)
      : new Date();
  });

  constructor() {
    setInterval(() => this.tick.set(Date.now()), 30_000);
  }

  setTunedTime(value: string): void {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      this.store.updateSettings({ tunedTime: date.toISOString() });
      this.tick.set(Date.now());
    }
  }

  shiftMinutes(minutes: number): void {
    const next = new Date(this.now().getTime() + minutes * 60_000);
    this.store.updateSettings({ tunedTime: next.toISOString() });
    this.tick.set(Date.now());
  }

  reset(): void {
    this.store.updateSettings({ tunedTime: new Date().toISOString() });
    this.tick.set(Date.now());
  }
}
