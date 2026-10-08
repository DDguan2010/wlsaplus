import { Injectable, inject } from '@angular/core';
import type { CourseProgressDetails, PowerSchoolCredentials, ProgressCourse, ProgressCourseTerm, ProgressSnapshot, ScheduleSnapshot } from './models';
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

    const sourceTerms: ProgressCourseTerm[] = course.terms?.length ? course.terms : [{
      term: course.term,
      grade: course.grade,
      detailsPath: course.detailsPath,
      details: course.details,
    }];
    const availableTerms = sourceTerms.filter((term) => term.detailsPath);
    const fresh = !force && sourceTerms.length > 0 && sourceTerms.every((term) =>
      term.details && Date.now() - Date.parse(term.details.loadedAt) < 5 * 60_000);
    if (fresh) return course;

    if (!availableTerms.length) {
      const empty = sourceTerms.map((term) => ({ ...term, details: term.details ?? this.emptyCourseDetails() }));
      const updated = this.store.updateProgressCourse(courseId, { terms: course.terms?.length ? empty : course.terms, details: empty[0]?.details ?? null });
      if (!updated) throw new Error('This course is no longer available.');
      return updated;
    }

    const credentials = await this.vault.get();
    if (!credentials) {
      if (sourceTerms.some((term) => term.details)) return course;
      throw new Error('Connect to PowerSchool to load this course.');
    }

    try {
      const settledTerms = await Promise.allSettled(sourceTerms.map(async (term) => {
        if (!term.detailsPath) {
          return { ...term, details: term.details ?? this.emptyCourseDetails() };
        }
        if (!force && term.details && Date.now() - Date.parse(term.details.loadedAt) < 5 * 60_000) return term;
        return { ...term, details: await this.fetchCourseDetails(credentials.schoolUrl, term.detailsPath) };
      }));
      let firstError: unknown = null;
      const loadedTerms: ProgressCourseTerm[] = settledTerms.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        firstError ??= result.reason;
        return sourceTerms[index];
      });

      // Details are independent per grading period. A missing or temporarily
      // unavailable S2 page must not hide an otherwise valid S1 result.
      if (firstError && !loadedTerms.some((term) => term.details)) throw firstError;
      const updated = this.store.updateProgressCourse(courseId, {
        terms: loadedTerms,
        details: loadedTerms.find((term) => term.term === course.term && term.detailsPath === course.detailsPath)?.details
          ?? loadedTerms.find((term) => term.details)?.details
          ?? null,
      });
      if (!updated) throw new Error('This course is no longer available.');
      return updated;
    } catch (error) {
      if (sourceTerms.some((term) => term.details)) return course;
      throw error;
    }
  }

  private emptyCourseDetails(): CourseProgressDetails {
    return { description: '', teacherComment: '', assignments: [], loadedAt: new Date().toISOString() };
  }

  private async fetchCourseDetails(baseUrl: string, detailsPath: string): Promise<CourseProgressDetails> {
    const page = await this.platform.request({ baseUrl, path: detailsPath, method: 'GET' });
    this.requireSuccessful(page);
    this.requireSignedIn(page.text);
    const lookup = parseAssignmentLookupRequest(page.text);
    let assignmentJson = '[]';
    if (lookup) {
      const assignments = await this.platform.request({
        baseUrl,
        path: `/ws/xte/assignment/lookup?_=${Date.now()}`,
        method: 'POST',
        body: JSON.stringify(lookup),
        referrerPath: detailsPath,
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
        },
      });
      this.requireSuccessful(assignments);
      assignmentJson = assignments.text;
    }
    return parsePowerSchoolCourseDetails(page.text, assignmentJson);
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
