import { Injectable, computed, signal } from '@angular/core';
import type { UpdateStatus } from './models';

const UNSUPPORTED: UpdateStatus = {
  state: 'unsupported',
  message: 'Automatic updates are available in the installed Windows app.',
  currentVersion: '',
  version: null,
  percent: null,
};

@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly status = signal<UpdateStatus>(UNSUPPORTED);
  readonly actionable = computed(() => ['available', 'downloading', 'ready', 'installing'].includes(this.status().state));

  constructor() {
    if (!window.wlsaplus) return;
    void window.wlsaplus.updater.status().then((status) => this.status.set(status));
    window.wlsaplus.updater.onStatus((status) => this.status.set(status));
  }

  async check(): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.updater.check());
  }

  async download(): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.updater.download());
  }

  async install(): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.updater.install());
  }
}
