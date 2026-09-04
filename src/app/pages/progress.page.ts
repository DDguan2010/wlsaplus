import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { AssignmentScore, AttendanceEvent, ProgressCourse } from '../core/models';
import { LocalStore } from '../core/local-store.service';
import { PowerSchoolService } from '../core/powerschool.service';

@Component({
  selector: 'app-progress-page',
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1 class="page-title">Progress</h1>
          @if (store.progress().syncedAt) {
            <span class="sync-label">Updated {{ store.progress().syncedAt | date:'MMM d, HH:mm' }}</span>
          }
        </div>
        <button mat-icon-button class="refresh-button" (click)="refresh()" [disabled]="refreshing()" matTooltip="Refresh grades and attendance" aria-label="Refresh grades and attendance">
          <span class="material-symbols-rounded" [class.spinning]="refreshing()">refresh</span>
        </button>
      </header>

      @if (refreshError()) {
        <div class="error-banner" role="alert"><span class="material-symbols-rounded">error</span><span>{{ refreshError() }}</span><button mat-button (click)="refresh()">Try again</button></div>
      }

      <mat-button-toggle-group class="view-switch" [value]="view()" (change)="view.set($event.value)" aria-label="Progress view">
        <mat-button-toggle value="grades"><span class="material-symbols-rounded">school</span>Grades</mat-button-toggle>
        <mat-button-toggle value="attendance"><span class="material-symbols-rounded">fact_check</span>Attendance</mat-button-toggle>
      </mat-button-toggle-group>

      <section class="summary-band surface" aria-label="Academic summary">
        <div><span class="summary-icon material-symbols-rounded">menu_book</span><p><strong>{{ store.progress().courses.length }}</strong><span>Courses</span></p></div>
        <div><span class="summary-icon absence material-symbols-rounded">event_busy</span><p><strong>{{ valueOrDash(store.progress().absenceTotal) }}</strong><span>Absences</span></p></div>
        <div><span class="summary-icon tardy material-symbols-rounded">schedule</span><p><strong>{{ valueOrDash(store.progress().tardyTotal) }}</strong><span>Tardies</span></p></div>
      </section>

      @if (view() === 'grades') {
        <div class="section-heading">
          <div><h2>Course grades</h2><span>{{ store.progress().term || 'Current term' }}</span></div>
        </div>
        <section class="course-list surface">
          @for (course of store.progress().courses; track course.id) {
            <article class="course-item" [class.expanded]="selectedCourseId() === course.id">
              <button class="course-toggle" (click)="toggleCourse(course)" [attr.aria-expanded]="selectedCourseId() === course.id">
                <span class="course-icon">{{ initials(course.name) }}</span>
                <span class="course-copy"><strong>{{ course.name }}</strong><span>{{ course.teacher || 'Teacher unavailable' }} @if (course.room) { | Room {{ course.room }} }</span></span>
                <span class="course-results">
                  <span><small>Grade</small><strong [class.unposted]="!course.grade">{{ course.grade || 'Not posted' }}</strong></span>
                  <span><small>Absent</small><strong>{{ valueOrDash(course.absences) }}</strong></span>
                  <span><small>Tardy</small><strong>{{ valueOrDash(course.tardies) }}</strong></span>
                </span>
                <span class="expand-icon material-symbols-rounded">{{ selectedCourseId() === course.id ? 'expand_less' : 'expand_more' }}</span>
              </button>

              @if (selectedCourseId() === course.id) {
                <div class="course-detail">
                  @if (loadingCourseId() === course.id) {
                    <div class="detail-loading"><mat-spinner diameter="28"/><span>Loading assignments...</span></div>
                  } @else if (courseError()) {
                    <div class="detail-error" role="alert"><span>{{ courseError() }}</span><button mat-stroked-button (click)="reloadCourse(course)">Try again</button></div>
                  } @else if (course.details; as details) {
                    <div class="course-facts">
                      @if (course.meetingPattern) { <span><span class="material-symbols-rounded">calendar_today</span>{{ course.meetingPattern }}</span> }
                      @if (course.room) { <span><span class="material-symbols-rounded">location_on</span>Room {{ course.room }}</span> }
                    </div>
                    @if (details.teacherComment) {
                      <section class="detail-note"><h3>Teacher comment</h3><p>{{ details.teacherComment }}</p></section>
                    }
                    @if (details.description) {
                      <section class="detail-note"><h3>Course description</h3><p>{{ details.description }}</p></section>
                    }
                    <div class="assignments-heading"><h3>Assignments</h3><span>{{ details.assignments.length }}</span></div>
                    <div class="assignment-list">
                      @for (assignment of details.assignments; track assignment.id) {
                        <article class="assignment-row">
                          <div class="assignment-main">
                            <strong>{{ assignment.name }}</strong>
                            <span>@if (assignment.dueDate) { Due {{ dateValue(assignment.dueDate) | date:'MMM d' }} } @if (assignment.category) { | {{ assignment.category }} }</span>
                            @if (assignment.description) { <p>{{ assignment.description }}</p> }
                            @if (assignmentFlags(assignment).length) {
                              <div class="status-list">@for (flag of assignmentFlags(assignment); track flag) { <span>{{ flag }}</span> }</div>
                            }
                          </div>
                          <div class="assignment-score" [class.no-score]="scoreText(assignment) === 'Not scored'">
                            <strong>{{ scoreText(assignment) }}</strong>
                            @if (pointsText(assignment)) { <span>{{ pointsText(assignment) }}</span> }
                          </div>
                        </article>
                      } @empty {
                        <div class="empty-state compact"><div><span class="material-symbols-rounded">assignment</span><p>No assignments have been posted for this course.</p></div></div>
                      }
                    </div>
                  }
                </div>
              }
            </article>
          } @empty {
            <div class="empty-state"><div><span class="material-symbols-rounded">school</span><p>No course grades are available yet.</p><button mat-stroked-button (click)="refresh()">Refresh</button></div></div>
          }
        </section>
      } @else {
        <div class="attendance-controls">
          <mat-button-toggle-group [value]="attendanceFilter()" (change)="attendanceFilter.set($event.value)" aria-label="Attendance status filter">
            <mat-button-toggle value="all">All</mat-button-toggle>
            <mat-button-toggle value="absence">Absences</mat-button-toggle>
            <mat-button-toggle value="tardy">Tardies</mat-button-toggle>
          </mat-button-toggle-group>
          <label class="course-filter"><span class="screen-reader-only">Filter attendance by course</span><select [value]="attendanceCourse()" (change)="setAttendanceCourse($event)">
            <option value="all">All courses</option>
            @for (name of attendanceCourses(); track name) { <option [value]="name">{{ name }}</option> }
          </select><span class="material-symbols-rounded">expand_more</span></label>
        </div>

        <div class="section-heading attendance-heading">
          <div><h2>Attendance history</h2><span>@if (store.progress().attendanceStart) { {{ dateValue(store.progress().attendanceStart) | date:'MMM d' }} to {{ dateValue(store.progress().attendanceEnd) | date:'MMM d' }} } @else { {{ store.progress().term || 'Current term' }} }</span></div>
        </div>
        <section class="attendance-list surface">
          @for (event of filteredAttendance(); track event.id) {
            <article class="attendance-row">
              <time><strong>{{ dateValue(event.date) | date:'d' }}</strong><span>{{ dateValue(event.date) | date:'MMM' }}</span></time>
              <span class="event-icon material-symbols-rounded" [attr.data-kind]="event.kind">{{ eventIcon(event) }}</span>
              <div class="event-main"><strong>{{ event.courseName }}</strong><span>{{ event.meetingPattern || 'Meeting time unavailable' }}</span></div>
              <div class="event-status" [attr.data-kind]="event.kind"><strong>{{ event.label }}</strong>@if (event.count > 1) { <span>{{ event.count }} records</span> }</div>
            </article>
          } @empty {
            <div class="empty-state attendance-empty"><div><span class="material-symbols-rounded">event_available</span><h3>No attendance records</h3><p>{{ attendanceEmptyMessage() }}</p></div></div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .page { width: min(100%, 1120px); }
    .page-header > div { display: grid; gap: 4px; } .sync-label { color: var(--app-muted); font-size: 12px; }
    .refresh-button { width: 44px; height: 44px; } .spinning { animation: spin 800ms linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
    .error-banner { min-height: 52px; margin-bottom: 16px; padding: 8px 10px 8px 14px; display: flex; align-items: center; gap: 10px; border: 1px solid #e6b9b9; border-radius: 8px; background: #fff1f0; color: #8b1c1c; font-size: 13px; } .error-banner > span:nth-child(2) { flex: 1; }
    .view-switch { margin-bottom: 18px; } .view-switch .material-symbols-rounded { width: 18px; height: 18px; margin-right: 7px; font-size: 18px; }
    .summary-band { min-height: 88px; display: grid; grid-template-columns: repeat(3, 1fr); overflow: hidden; }
    .summary-band > div { min-width: 0; padding: 16px 20px; display: flex; align-items: center; gap: 12px; border-right: 1px solid var(--app-border); } .summary-band > div:last-child { border-right: 0; }
    .summary-icon { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 8px; background: var(--app-accent-soft); color: var(--app-accent); font-size: 21px; } .summary-icon.absence { background: #fde1df; color: #a62b2b; } .summary-icon.tardy { background: #ffedcc; color: #855000; }
    .summary-band p { margin: 0; display: grid; gap: 2px; } .summary-band strong { font-size: 21px; font-variant-numeric: tabular-nums; } .summary-band p span { color: var(--app-muted); font-size: 12px; }
    .section-heading { min-height: 38px; margin: 26px 2px 10px; display: flex; align-items: end; justify-content: space-between; }
    .section-heading h2 { margin: 0; font-size: 18px; } .section-heading div > span { color: var(--app-muted); font-size: 12px; }
    .course-list { overflow: hidden; } .course-item { border-bottom: 1px solid var(--app-border); } .course-item:last-child { border-bottom: 0; }
    .course-toggle { width: 100%; min-height: 82px; padding: 12px 16px; display: grid; grid-template-columns: 42px minmax(180px,1fr) minmax(280px, .8fr) 28px; align-items: center; gap: 14px; border: 0; background: transparent; color: var(--app-text); text-align: left; cursor: pointer; }
    .course-toggle:hover { background: color-mix(in srgb, var(--app-accent-soft) 25%, transparent); } .course-item.expanded .course-toggle { background: color-mix(in srgb, var(--app-accent-soft) 32%, transparent); }
    .course-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 8px; background: var(--app-accent-soft); color: var(--app-accent); font-weight: 700; }
    .course-copy { min-width: 0; display: grid; gap: 5px; } .course-copy strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; } .course-copy > span { overflow: hidden; color: var(--app-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .course-results { display: grid; grid-template-columns: minmax(100px, 1.5fr) repeat(2, minmax(62px, 1fr)); gap: 8px; } .course-results > span { min-width: 0; display: grid; gap: 4px; } .course-results small { color: var(--app-muted); font-size: 10px; text-transform: uppercase; } .course-results strong { overflow-wrap: anywhere; font-size: 14px; font-variant-numeric: tabular-nums; } .course-results .unposted { color: var(--app-muted); font-size: 12px; font-weight: 500; }
    .expand-icon { color: var(--app-muted); }
    .course-detail { padding: 18px 24px 24px 80px; border-top: 1px solid var(--app-border); background: color-mix(in srgb, var(--app-surface-raised) 45%, transparent); }
    .detail-loading { min-height: 86px; display: flex; align-items: center; gap: 12px; color: var(--app-muted); font-size: 13px; } .detail-error { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 14px; color: #a62b2b; font-size: 13px; }
    .course-facts { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 18px; color: var(--app-muted); font-size: 12px; } .course-facts span { display: inline-flex; align-items: center; gap: 5px; } .course-facts .material-symbols-rounded { font-size: 17px; }
    .detail-note { margin: 0 0 18px; } .detail-note h3, .assignments-heading h3 { margin: 0 0 6px; font-size: 13px; } .detail-note p { margin: 0; color: var(--app-muted); font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
    .assignments-heading { min-height: 32px; display: flex; align-items: center; gap: 8px; } .assignments-heading h3 { margin: 0; } .assignments-heading span { color: var(--app-muted); font-size: 12px; }
    .assignment-list { border-top: 1px solid var(--app-border); } .assignment-row { min-height: 76px; padding: 13px 0; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 18px; border-bottom: 1px solid var(--app-border); } .assignment-row:last-child { border-bottom: 0; }
    .assignment-main { min-width: 0; display: grid; gap: 4px; } .assignment-main > strong { font-size: 13px; } .assignment-main > span { color: var(--app-muted); font-size: 11px; } .assignment-main p { margin: 3px 0 0; color: var(--app-muted); font-size: 12px; line-height: 1.4; }
    .assignment-score { min-width: 82px; display: grid; justify-items: end; gap: 3px; } .assignment-score strong { color: var(--app-accent); font-size: 17px; font-variant-numeric: tabular-nums; } .assignment-score span { color: var(--app-muted); font-size: 10px; } .assignment-score.no-score strong { color: var(--app-muted); font-size: 12px; font-weight: 500; }
    .status-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; } .status-list span { padding: 2px 5px; border-radius: 4px; background: #ffedcc; color: #754500; font-size: 10px; font-weight: 700; }
    .compact { min-height: 110px; } .compact .material-symbols-rounded, .attendance-empty .material-symbols-rounded, .course-list > .empty-state .material-symbols-rounded { font-size: 34px; } .empty-state p { margin: 8px 0 12px; }
    .attendance-controls { margin: 26px 0 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; } .attendance-heading { margin-top: 14px; }
    .course-filter { position: relative; min-width: 180px; } .course-filter select { width: 100%; height: 40px; padding: 0 36px 0 12px; appearance: none; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface); color: var(--app-text); cursor: pointer; } .course-filter > .material-symbols-rounded { position: absolute; right: 9px; top: 10px; pointer-events: none; color: var(--app-muted); font-size: 20px; }
    .screen-reader-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .attendance-list { overflow: hidden; } .attendance-row { min-height: 72px; padding: 10px 18px; display: grid; grid-template-columns: 42px 38px minmax(0,1fr) auto; align-items: center; gap: 13px; border-bottom: 1px solid var(--app-border); } .attendance-row:last-child { border-bottom: 0; }
    .attendance-row time { display: grid; justify-items: center; line-height: 1; } .attendance-row time strong { font-size: 19px; } .attendance-row time span { margin-top: 3px; color: var(--app-muted); font-size: 10px; text-transform: uppercase; }
    .event-icon { width: 36px; height: 36px; border-radius: 8px; background: var(--app-surface-raised); color: var(--app-muted); font-size: 20px; } .event-icon[data-kind='absence'] { background: #fde1df; color: #a62b2b; } .event-icon[data-kind='tardy'] { background: #ffedcc; color: #855000; }
    .event-main { min-width: 0; display: grid; gap: 4px; } .event-main strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; } .event-main span { overflow: hidden; color: var(--app-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .event-status { display: grid; justify-items: end; gap: 3px; } .event-status strong { font-size: 12px; } .event-status span { color: var(--app-muted); font-size: 10px; } .event-status[data-kind='absence'] strong { color: #a62b2b; } .event-status[data-kind='tardy'] strong { color: #855000; }
    .attendance-empty h3 { margin: 10px 0 0; color: var(--app-text); font-size: 15px; } .attendance-empty p { max-width: 360px; line-height: 1.4; }
    :host-context(.dark-theme) .summary-icon.absence, :host-context(.dark-theme) .event-icon[data-kind='absence'] { background: #572423; color: #ffb4ad; }
    :host-context(.dark-theme) .summary-icon.tardy, :host-context(.dark-theme) .event-icon[data-kind='tardy'], :host-context(.dark-theme) .status-list span { background: #553a0d; color: #ffd38b; }
    :host-context(.dark-theme) .event-status[data-kind='absence'] strong, :host-context(.dark-theme) .detail-error { color: #ffb4ad; } :host-context(.dark-theme) .event-status[data-kind='tardy'] strong { color: #ffd38b; } :host-context(.dark-theme) .error-banner { border-color: #703c39; background: #3c1d1c; color: #ffb4ad; }
    @media (max-width: 760px) {
      .course-toggle { min-height: 104px; grid-template-columns: 42px minmax(0,1fr) 28px; gap: 10px 12px; } .course-results { grid-column: 2 / -1; grid-row: 2; width: min(100%, 300px); } .expand-icon { grid-column: 3; grid-row: 1; } .course-detail { padding: 18px 18px 22px; }
    }
    @media (max-width: 560px) {
      .summary-band > div { padding: 12px 10px; gap: 8px; } .summary-icon { width: 32px; height: 32px; flex-basis: 32px; font-size: 18px; } .summary-band strong { font-size: 18px; }
      .attendance-controls { align-items: stretch; flex-direction: column; } .attendance-controls mat-button-toggle-group { width: 100%; } .attendance-controls mat-button-toggle { flex: 1; } .course-filter { width: 100%; }
      .attendance-row { padding: 10px 12px; grid-template-columns: 34px 34px minmax(0,1fr); gap: 9px; } .event-icon { width: 32px; height: 32px; font-size: 18px; } .event-status { grid-column: 3; justify-items: start; }
      .assignment-row { align-items: start; gap: 10px; } .assignment-score { min-width: 70px; }
    }
    @media (max-width: 390px) { .summary-icon { display: none; } .summary-band > div { justify-content: center; text-align: center; } .view-switch { width: 100%; } .view-switch mat-button-toggle { flex: 1; } }
  `,
})
export class ProgressPage {
  readonly store = inject(LocalStore);
  private readonly powerSchool = inject(PowerSchoolService);
  readonly view = signal<'grades' | 'attendance'>('grades');
  readonly refreshing = signal(false);
  readonly refreshError = signal('');
  readonly selectedCourseId = signal<string | null>(null);
  readonly loadingCourseId = signal<string | null>(null);
  readonly courseError = signal('');
  readonly attendanceFilter = signal<'all' | 'absence' | 'tardy'>('all');
  readonly attendanceCourse = signal('all');
  readonly attendanceCourses = computed(() => [...new Set(this.store.progress().attendanceEvents.map((event) => event.courseName))].sort());
  readonly filteredAttendance = computed(() => this.store.progress().attendanceEvents.filter((event) =>
    (this.attendanceFilter() === 'all' || event.kind === this.attendanceFilter())
    && (this.attendanceCourse() === 'all' || event.courseName === this.attendanceCourse())));

  async refresh(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.refreshError.set('');
    try {
      await this.powerSchool.syncSaved();
    } catch (error) {
      this.refreshError.set(error instanceof Error ? error.message : 'Could not refresh PowerSchool.');
    } finally {
      this.refreshing.set(false);
    }
  }

  async toggleCourse(course: ProgressCourse): Promise<void> {
    if (this.selectedCourseId() === course.id) {
      this.selectedCourseId.set(null);
      return;
    }
    this.selectedCourseId.set(course.id);
    await this.loadCourse(course, false);
  }

  async reloadCourse(course: ProgressCourse): Promise<void> {
    await this.loadCourse(course, true);
  }

  private async loadCourse(course: ProgressCourse, force: boolean): Promise<void> {
    this.loadingCourseId.set(course.id);
    this.courseError.set('');
    try {
      await this.powerSchool.loadCourse(course.id, force);
    } catch (error) {
      this.courseError.set(error instanceof Error ? error.message : 'Could not load this course.');
    } finally {
      if (this.loadingCourseId() === course.id) this.loadingCourseId.set(null);
    }
  }

  setAttendanceCourse(event: Event): void {
    this.attendanceCourse.set((event.target as HTMLSelectElement).value);
  }

  valueOrDash(value: number | null): number | string { return value ?? '-'; }
  dateValue(value: string): string { return value ? `${value}T12:00:00` : ''; }
  initials(name: string): string { return name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase(); }
  assignmentFlags(assignment: AssignmentScore): string[] {
    return [assignment.isMissing && 'Missing', assignment.isLate && 'Late', assignment.isAbsent && 'Absent', assignment.isIncomplete && 'Incomplete', assignment.isExempt && 'Exempt'].filter((item): item is string => Boolean(item));
  }
  scoreText(assignment: AssignmentScore): string {
    if (assignment.percent !== null) return `${assignment.percent}%`;
    if (assignment.letterGrade) return assignment.letterGrade;
    return 'Not scored';
  }
  pointsText(assignment: AssignmentScore): string {
    if (assignment.pointsEarned === null && assignment.pointsPossible === null) return '';
    return `${assignment.pointsEarned ?? '-'} / ${assignment.pointsPossible ?? '-'} pts`;
  }
  eventIcon(event: AttendanceEvent): string {
    return event.kind === 'absence' ? 'event_busy' : event.kind === 'tardy' ? 'schedule' : 'info';
  }
  attendanceEmptyMessage(): string {
    if (this.attendanceFilter() !== 'all' || this.attendanceCourse() !== 'all') return 'No records match these filters.';
    return 'No absences or tardies were found for this term.';
  }
}
