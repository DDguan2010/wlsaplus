import { Injectable, inject } from '@angular/core';
import type { PowerSchoolCredentials, ProgressCourse, ProgressSnapshot, ScheduleSnapshot } from './models';
import { CredentialVault } from './credential-vault.service';
import { LocalStore } from './local-store.service';
import {
  parseAssignmentLookupRequest,
  parsePowerSchoolCourseDetails,
  parsePowerSchoolProgress,
  parsePowerSchoolSchedule,
} from './powerschool-parser';
import { PlatformService, WEB_POWERSCHOOL_ORIGIN } from './platform.service';

@Injectable({ providedIn: 'root' })
export class PowerSchoolService {
  private readonly platform = inject(PlatformService);
  private readonly vault = inject(CredentialVault);
  private readonly store = inject(LocalStore);

  async connect(credentials: PowerSchoolCredentials): Promise<ScheduleSnapshot> {
    const normalized = { ...credentials, schoolUrl: this.normalizeUrl(credentials.schoolUrl) };
    await this.platform.clearSession(normalized.schoolUrl);
    const login = await this.platform.request({ baseUrl: normalized.schoolUrl, path: '/public/', method: 'GET' });
    this.requireSuccessful(login);
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
    this.requireSuccessful(result);
    if (/name=["']account["']/i.test(result.text)) {
      throw new Error('Sign in failed. Check the server address, username, and password.');
    }
    const [snapshot, progress] = await Promise.all([
      this.fetchSchedule(normalized.schoolUrl),
      this.fetchProgress(normalized.schoolUrl, result.text),
    ]);
    await this.vault.set(normalized);
    this.store.saveSchedule(snapshot);
    this.store.saveProgress(progress);
    return snapshot;
  }

  async syncSaved(): Promise<ScheduleSnapshot> {
    const credentials = await this.vault.get();
    if (!credentials) throw new Error('No saved PowerSchool account.');
    return this.connect(credentials);
  }

  async disconnect(): Promise<void> {
    const credentials = await this.vault.get();
    try {
      if (credentials || this.platform.info.kind === 'web') {
        await this.platform.clearSession(credentials?.schoolUrl ?? WEB_POWERSCHOOL_ORIGIN);
      }
    } catch {
      // Local data must still be removable while the remote gateway is unavailable.
    }
    await this.vault.clear();
    this.store.clearAll();
  }

  async loadCourse(courseId: string, force = false): Promise<ProgressCourse> {
    const course = this.store.progress().courses.find((item) => item.id === courseId);
    if (!course) throw new Error('This course is no longer available.');
    if (!force && course.details && Date.now() - Date.parse(course.details.loadedAt) < 5 * 60_000) return course;
    if (!course.detailsPath) {
      const updated = this.store.updateProgressCourse(courseId, {
        details: { description: '', teacherComment: '', assignments: [], loadedAt: new Date().toISOString() },
      });
      if (!updated) throw new Error('This course is no longer available.');
      return updated;
    }
    const credentials = await this.vault.get();
    if (!credentials) {
      if (course.details) return course;
      throw new Error('Connect to PowerSchool to load this course.');
    }

    try {
      const page = await this.platform.request({
        baseUrl: credentials.schoolUrl,
        path: course.detailsPath,
        method: 'GET',
      });
      this.requireSuccessful(page);
      this.requireSignedIn(page.text);
      const lookup = parseAssignmentLookupRequest(page.text);
      let assignmentJson = '[]';
      if (lookup) {
        const assignments = await this.platform.request({
          baseUrl: credentials.schoolUrl,
          path: `/ws/xte/assignment/lookup?_=${Date.now()}`,
          method: 'POST',
          body: JSON.stringify(lookup),
          referrerPath: course.detailsPath,
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json;charset=UTF-8',
          },
        });
        this.requireSuccessful(assignments);
        assignmentJson = assignments.text;
      }
      const updated = this.store.updateProgressCourse(courseId, {
        details: parsePowerSchoolCourseDetails(page.text, assignmentJson),
      });
      if (!updated) throw new Error('This course is no longer available.');
      return updated;
    } catch (error) {
      if (course.details) return course;
      throw error;
    }
  }

  private async fetchSchedule(baseUrl: string): Promise<ScheduleSnapshot> {
    const [week, matrix] = await Promise.all([
      this.platform.request({ baseUrl, path: '/guardian/myschedule.html', method: 'GET' }),
      this.platform.request({ baseUrl, path: '/guardian/myschedulematrix.html', method: 'GET' }),
    ]);
    this.requireSuccessful(week);
    this.requireSuccessful(matrix);
    if (!week.text.includes('tableStudentSchedMatrix')) {
      if (/name=["']account["']/i.test(week.text)) {
        throw new Error('Your PowerSchool session expired. Sign in again.');
      }
      throw new Error('The weekly schedule was not available for this account.');
    }
    const snapshot = parsePowerSchoolSchedule(week.text, matrix.text);
    if (!snapshot.sessions.length) throw new Error('PowerSchool returned an empty or unsupported schedule.');
    return snapshot;
  }

  private async fetchProgress(baseUrl: string, homeHtml: string): Promise<ProgressSnapshot> {
    let attendanceHtml = '';
    try {
      const attendance = await this.platform.request({ baseUrl, path: '/guardian/attendance.html', method: 'GET' });
      if (attendance.status < 400 && !this.isSignInPage(attendance.text)) attendanceHtml = attendance.text;
    } catch {
      // Grade summaries remain useful when attendance history is temporarily unavailable.
    }
    const progress = parsePowerSchoolProgress(homeHtml, attendanceHtml);
    if (!attendanceHtml && this.store.progress().attendanceEvents.length) {
      const cached = this.store.progress();
      return {
        ...progress,
        attendanceStart: cached.attendanceStart,
        attendanceEnd: cached.attendanceEnd,
        attendanceEvents: cached.attendanceEvents,
      };
    }
    return progress;
  }

  private normalizeUrl(value: string): string {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    return url.origin;
  }

  private requireSuccessful(response: { status: number; text: string }): void {
    if (response.status < 400) return;
    try {
      const value = JSON.parse(response.text) as { error?: unknown };
      if (typeof value.error === 'string' && value.error.trim()) throw new Error(value.error);
    } catch (error) {
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input'
        && !(error instanceof SyntaxError)) throw error;
    }
    throw new Error(`PowerSchool returned HTTP ${response.status}.`);
  }

  private isSignInPage(html: string): boolean {
    return /name=["']account["']/i.test(html);
  }

  private requireSignedIn(html: string): void {
    if (this.isSignInPage(html)) throw new Error('Your PowerSchool session expired. Refresh Progress and try again.');
  }
}
