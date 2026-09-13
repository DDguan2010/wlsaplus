import { Injectable, signal } from '@angular/core';

export interface AppNotice {
  id: string;
  title: string;
  content: string;
  type?: 'info' | 'success' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class NoticeService {
  readonly notice = signal<AppNotice | null>(null);
  readonly dismissed = signal(false);

  constructor() {
    void this.load();
  }

  dismiss(): void {
    const notice = this.notice();
    if (!notice) return;
    localStorage.setItem('wlsaplus:notice-seen', notice.id);
    this.dismissed.set(true);
  }

  private async load(): Promise<void> {
    const cacheBust = Date.now();
    const sources = [
      `https://wlsaplus.02studio.xyz/notice.json?ts=${cacheBust}`,
      `/notice.json?ts=${cacheBust}`,
    ];
    for (const url of sources) {
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        });
        if (!response.ok) continue;
        const value = await response.json() as Partial<AppNotice>;
        if (typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || !value.title
          || typeof value.content !== 'string' || !value.content) continue;
        this.notice.set({ id: value.id, title: value.title, content: value.content, type: value.type });
        this.dismissed.set(localStorage.getItem('wlsaplus:notice-seen') === value.id);
        return;
      } catch {
        // Try the bundled fallback if the shared front page is unavailable.
      }
    }
  }
}
