import { Injectable, inject } from '@angular/core';
import type { PowerSchoolCredentials, ScheduleSnapshot } from './models';
import { CredentialVault } from './credential-vault.service';
import { LocalStore } from './local-store.service';
import { parsePowerSchoolSchedule } from './powerschool-parser';
import { PlatformService } from './platform.service';

@Injectable({ providedIn: 'root' })
export class PowerSchoolService {
  private readonly platform = inject(PlatformService);
  private readonly vault = inject(CredentialVault);
  private readonly store = inject(LocalStore);

  async connect(credentials: PowerSchoolCredentials): Promise<ScheduleSnapshot> {
    const normalized = { ...credentials, schoolUrl: this.normalizeUrl(credentials.schoolUrl) };
    await this.platform.clearSession(normalized.schoolUrl);
    const login = await this.platform.request({ baseUrl: normalized.schoolUrl, path: '/public/', method: 'GET' });
    if (login.status >= 400) throw new Error(`PowerSchool returned HTTP ${login.status}.`);
    const doc = new DOMParser().parseFromString(login.text, 'text/html');
    const field = (name: string): string => (doc.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
    const body = new URLSearchParams({
      dbpw: normalized.password,
      translator_username: '',
      translator_password: '',
      translator_ldappassword: '',
      returnUrl: field('returnUrl'),
      serviceName: field('serviceName') || 'PS Parent Portal',
      serviceTicket: field('serviceTicket'),
      pcasServerUrl: field('pcasServerUrl') || '/',
      credentialType: field('credentialType') || 'User Id and Password Credential',
      request_locale: field('request_locale'),
      account: normalized.username,
      pw: normalized.password,
      translatorpw: '',
    }).toString();
    const result = await this.platform.request({
      baseUrl: normalized.schoolUrl,
      path: '/guardian/home.html',
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    if (result.status >= 400 || /name=["']account["']/i.test(result.text)) {
      throw new Error('Sign in failed. Check the server address, username, and password.');
    }
    const snapshot = await this.fetchSchedule(normalized.schoolUrl);
    await this.vault.set(normalized);
    this.store.saveSchedule(snapshot);
    return snapshot;
  }

  async syncSaved(): Promise<ScheduleSnapshot> {
    const credentials = await this.vault.get();
    if (!credentials) throw new Error('No saved PowerSchool account.');
    return this.connect(credentials);
  }

  async disconnect(): Promise<void> {
    const credentials = await this.vault.get();
    if (credentials) await this.platform.clearSession(credentials.schoolUrl);
    await this.vault.clear();
    this.store.clearAll();
  }

  private async fetchSchedule(baseUrl: string): Promise<ScheduleSnapshot> {
    const [week, matrix] = await Promise.all([
      this.platform.request({ baseUrl, path: '/guardian/myschedule.html', method: 'GET' }),
      this.platform.request({ baseUrl, path: '/guardian/myschedulematrix.html', method: 'GET' }),
    ]);
    if (!week.text.includes('tableStudentSchedMatrix')) throw new Error('The weekly schedule was not available for this account.');
    const snapshot = parsePowerSchoolSchedule(week.text, matrix.text);
    if (!snapshot.sessions.length) throw new Error('PowerSchool returned an empty or unsupported schedule.');
    return snapshot;
  }

  private normalizeUrl(value: string): string {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    return url.origin;
  }
}
