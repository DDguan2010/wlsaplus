import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { PowerSchoolCredentials } from './models';

const KEY = 'wlsaplus:credentials';

@Injectable({ providedIn: 'root' })
export class CredentialVault {
  async get(): Promise<PowerSchoolCredentials | null> {
    if (window.wlsaplus) return window.wlsaplus.credentials.get();
    if (Capacitor.isNativePlatform()) return await SecureStorage.get(KEY) as PowerSchoolCredentials | null;
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as PowerSchoolCredentials) : null;
    } catch {
      return null;
    }
  }

  async set(value: PowerSchoolCredentials): Promise<void> {
    if (window.wlsaplus) return window.wlsaplus.credentials.set(value);
    if (Capacitor.isNativePlatform()) return SecureStorage.set(KEY, value as unknown as Record<string, unknown>);
    localStorage.setItem(KEY, JSON.stringify(value));
  }

  async clear(): Promise<void> {
    if (window.wlsaplus) return window.wlsaplus.credentials.clear();
    if (Capacitor.isNativePlatform()) { await SecureStorage.remove(KEY); return; }
    localStorage.removeItem(KEY);
  }
}
