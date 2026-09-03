import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { LocalStore } from '../core/local-store.service';
import type { ClassSession } from '../core/models';

@Component({
  selector: 'app-schedule-page',
  imports: [DatePipe, MatButtonToggleModule],
  template: `
    <div class="page">
      <header class="page-header"><h1 class="page-title">Schedule</h1><span class="sync-label">Updated {{ store.schedule().syncedAt | date:'MMM d, HH:mm' }}</span></header>
      <mat-button-toggle-group [value]="view()" (change)="view.set($event.value)" aria-label="Schedule view"><mat-button-toggle value="week">Full Schedule</mat-button-toggle><mat-button-toggle value="courses">All Courses</mat-button-toggle></mat-button-toggle-group>
      @if (view() === 'week') {
        <div class="layout-row"><span>Layout</span><mat-button-toggle-group [value]="layout()" (change)="layout.set($event.value)" aria-label="Full schedule layout"><mat-button-toggle value="agenda"><span class="material-symbols-rounded">view_agenda</span>Agenda</mat-button-toggle><mat-button-toggle value="grid"><span class="material-symbols-rounded">calendar_view_week</span>Week Grid</mat-button-toggle></mat-button-toggle-group></div>
        @if (layout() === 'agenda') {
          <div class="day-list">
            @for (day of days(); track day.date) {
              <section class="day-section"><div class="day-heading"><div><strong>{{ day.date | date:'EEEE' }}</strong><span>{{ day.date | date:'MMMM d' }}</span></div><span>{{ day.sessions.length }} classes</span></div>
                <div class="session-list surface">
                  @for (session of day.sessions; track session.id) {
                    <div class="session-row"><div class="session-time"><strong>{{ session.startsAt | date:'HH:mm' }}</strong><span>{{ session.endsAt | date:'HH:mm' }}</span></div><span class="color-bar"></span><div class="session-main"><strong>{{ session.courseName }}</strong><span>{{ session.teacher || 'Teacher unavailable' }}</span></div><div class="room"><span class="material-symbols-rounded">location_on</span>{{ session.room || 'TBA' }}</div></div>
                  }
                </div>
              </section>
            } @empty { <div class="surface empty-state">No schedule has been synced yet.</div> }
          </div>
        } @else {
          <div class="matrix-scroll surface">
            <div class="week-matrix">
              <div class="matrix-corner"></div>
              @for (day of matrixDays(); track day.key) { <div class="matrix-header"><strong>{{ day.date | date:'EEEE' }}</strong><span>{{ day.date | date:'MMM d' }}</span></div> }
              <div class="time-column" [style.height.px]="matrixHeight()">
                @for (hour of hourMarks(); track hour) { <time [style.top.px]="lineTop(hour)">{{ hourLabel(hour) }}</time> }
              </div>
              @for (day of matrixDays(); track day.key) {
                <div class="matrix-day" [style.height.px]="matrixHeight()">
                  @for (hour of hourMarks(); track hour) { <span class="hour-line" [style.top.px]="lineTop(hour)"></span> }
                  @for (session of day.sessions; track session.id) {
                    <article class="matrix-session" tabindex="0" [attr.data-density]="sessionDensity(session)" [attr.aria-label]="sessionLabel(session)" [style.top.px]="sessionTop(session)" [style.height.px]="sessionHeight(session)" [style.background]="courseColor(session.courseName)">
                      <strong>{{ session.courseName }}</strong>
                      <div class="session-details">
                        <span class="session-time">{{ session.startsAt | date:'HH:mm' }} - {{ session.endsAt | date:'HH:mm' }}</span>
                        <span class="session-teacher">{{ session.teacher || 'Teacher TBA' }}</span>
                        <span class="session-room"><span class="material-symbols-rounded">location_on</span>{{ session.room || 'TBA' }}</span>
                      </div>
                    </article>
                  }
                </div>
              }
            </div>
          </div>
        }
      } @else {
        <div class="course-grid">
          @for (course of courseStats(); track course.id) {
            <article class="course-card surface"><div class="course-icon">{{ initials(course.name) }}</div><h2>{{ course.name }}</h2><p>{{ course.teacher || 'Teacher unavailable' }}</p><div class="course-room"><span class="material-symbols-rounded">location_on</span>{{ course.room || 'Room TBA' }} @if (course.sectionNumber) { <span>· {{ course.sectionNumber }}</span> }</div><div class="counts"><div><strong>{{ course.total }}</strong><span>This week</span></div><div><strong>{{ course.done }}</strong><span>Completed</span></div><div><strong>{{ course.left }}</strong><span>Remaining</span></div></div></article>
          } @empty { <div class="surface empty-state">No courses are available.</div> }
        </div>
      }
    </div>
  `,
  styles: `
    .page { width: min(100%, 1280px); } .sync-label { color: var(--app-muted); font-size: 13px; } .page > mat-button-toggle-group { margin-bottom: 18px; }
    .layout-row { min-height: 48px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--app-muted); font-size: 13px; } .layout-row mat-button-toggle-group { margin: 0; } .layout-row .material-symbols-rounded { width: 18px; height: 18px; margin-right: 6px; font-size: 18px; }
    .day-section { margin-bottom: 28px; } .day-heading { display: flex; justify-content: space-between; align-items: end; margin: 0 2px 10px; color: var(--app-muted); font-size: 13px; } .day-heading div { display: flex; gap: 10px; align-items: baseline; } .day-heading strong { color: var(--app-text); font-size: 18px; }
    .session-list { overflow: hidden; } .session-row { min-height: 84px; padding: 14px 18px; display: grid; grid-template-columns: 62px 4px minmax(0,1fr) auto; align-items: center; gap: 16px; border-bottom: 1px solid var(--app-border); } .session-row:last-child { border: 0; }
    .session-time, .session-main { display: flex; flex-direction: column; gap: 4px; } .session-time { font-variant-numeric: tabular-nums; } .session-time span, .session-main span { color: var(--app-muted); font-size: 13px; } .color-bar { width: 4px; height: 48px; border-radius: 2px; background: var(--app-accent); }
    .session-main strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .room, .course-room { display: flex; align-items: center; gap: 5px; color: var(--app-muted); font-size: 13px; } .room .material-symbols-rounded, .course-room .material-symbols-rounded { font-size: 18px; }
    .course-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; } .course-card { padding: 20px; min-width: 0; } .course-icon { width: 42px; height: 42px; display: grid; place-items: center; background: var(--app-accent-soft); color: var(--app-accent); border-radius: 8px; font-weight: 700; }
    .course-card h2 { margin: 18px 0 5px; font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .course-card p { margin: 0 0 12px; color: var(--app-muted); font-size: 14px; }
    .counts { display: grid; grid-template-columns: repeat(3,1fr); margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--app-border); } .counts div { display: flex; flex-direction: column; } .counts strong { font-size: 20px; } .counts span { color: var(--app-muted); font-size: 11px; }
    .matrix-scroll { width: 100%; } .week-matrix { min-width: 1120px; display: grid; grid-template-columns: 76px repeat(5, minmax(200px, 1fr)); grid-template-rows: 62px auto; }
    .matrix-corner, .matrix-header { position: sticky; top: 0; z-index: 4; background: var(--app-surface-raised); border-bottom: 1px solid var(--app-border); } .matrix-corner { left: 0; z-index: 5; border-right: 1px solid var(--app-border); } .matrix-header { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border-right: 1px solid var(--app-border); } .matrix-header strong { font-size: 13px; } .matrix-header span { color: var(--app-muted); font-size: 11px; }
    .time-column { position: sticky; left: 0; z-index: 3; background: var(--app-surface); border-right: 1px solid var(--app-border); } .time-column time { position: absolute; right: 10px; color: var(--app-muted); font-size: 11px; font-variant-numeric: tabular-nums; transform: translateY(-7px); } .time-column time:first-child { transform: translateY(4px); }
    .matrix-day { position: relative; min-width: 0; border-right: 1px solid var(--app-border); background: var(--app-surface); } .hour-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--app-border); }
    .matrix-session { position: absolute; left: 4px; right: 4px; z-index: 2; min-height: 26px; padding: 4px 7px; overflow: hidden; border: 0; border-left: 4px solid color-mix(in srgb, var(--app-accent) 75%, #000); border-radius: 5px; color: #172023; font-size: 10px; line-height: 12px; cursor: default; transition: min-height 120ms ease, box-shadow 120ms ease; }
    .matrix-session strong { display: block; min-height: 16px; overflow: hidden; font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
    .session-details { display: flex; flex-direction: column; gap: 1px; margin-top: 2px; } .session-details > span { display: none; min-height: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .matrix-session[data-density="medium"] .session-time, .matrix-session[data-density="full"] .session-details > span { display: block; }
    .matrix-session:hover, .matrix-session:focus { z-index: 20; min-height: 76px; overflow: visible; box-shadow: 0 5px 18px rgba(23,32,35,.24); }
    .matrix-session:focus-visible { outline: 2px solid color-mix(in srgb, var(--app-accent) 72%, #000); outline-offset: 1px; }
    .matrix-session:hover .session-details > span, .matrix-session:focus .session-details > span { display: block; }
    .session-room .material-symbols-rounded { width: 12px; height: 12px; margin-right: 2px; font-size: 12px; vertical-align: -2px; }
    @media (max-width: 650px) { .course-grid { grid-template-columns: 1fr; } .session-row { padding: 12px; grid-template-columns: 52px 3px minmax(0,1fr); gap: 10px; } .room { grid-column: 3; } .day-heading div { display: block; } .day-heading div span { margin-left: 8px; } .layout-row { align-items: flex-start; flex-direction: column; } .layout-row mat-button-toggle-group { width: 100%; } .layout-row mat-button-toggle { flex: 1; } }
  `,
})
export class SchedulePage {
  readonly store = inject(LocalStore);
  readonly view = signal<'week' | 'courses'>('week');
  readonly layout = signal<'agenda' | 'grid'>('agenda');
  private readonly pixelsPerMinute = 1.75;
  readonly days = computed(() => {
    const groups = new Map<string, ClassSession[]>();
    for (const session of this.store.schedule().sessions) {
      const date = session.startsAt.slice(0, 10); groups.set(date, [...(groups.get(date) ?? []), session]);
    }
    return [...groups].map(([date, sessions]) => ({ date: `${date}T12:00:00`, sessions }));
  });
  readonly courseStats = computed(() => {
    const now = Date.now(); const sessions = this.store.schedule().sessions;
    const courses = this.store.schedule().courses.length ? this.store.schedule().courses : [...new Set(sessions.map((s) => s.courseName))].map((name, i) => ({ id: `fallback-${i}`, name, sectionNumber: '', teacher: '', room: '', meetingPattern: '' }));
    return courses.map((course) => {
      const own = sessions.filter((s) => s.courseId === course.id || s.courseName.toLowerCase() === course.name.toLowerCase());
      const done = own.filter((s) => new Date(s.endsAt).getTime() <= now).length;
      return { ...course, total: own.length, done, left: own.length - done };
    });
  });
  readonly matrixDays = computed(() => {
    const sessions = [...this.store.schedule().sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const anchor = sessions[0] ? new Date(sessions[0].startsAt) : new Date();
    const monday = new Date(anchor); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(monday); date.setDate(monday.getDate() + index);
      const key = this.localDateKey(date);
      return { key, date, sessions: sessions.filter((session) => this.localDateKey(new Date(session.startsAt)) === key) };
    });
  });
  readonly range = computed(() => {
    const sessions = this.store.schedule().sessions;
    if (!sessions.length) return { start: 8 * 60, end: 17 * 60 };
    const starts = sessions.map((session) => this.minutes(new Date(session.startsAt)));
    const ends = sessions.map((session) => this.minutes(new Date(session.endsAt)));
    return { start: Math.floor(Math.min(...starts) / 60) * 60, end: Math.ceil(Math.max(...ends) / 60) * 60 };
  });
  readonly hourMarks = computed(() => Array.from({ length: (this.range().end - this.range().start) / 60 + 1 }, (_, index) => this.range().start + index * 60));
  readonly matrixHeight = computed(() => (this.range().end - this.range().start) * this.pixelsPerMinute);
  lineTop(minutes: number): number { return (minutes - this.range().start) * this.pixelsPerMinute; }
  sessionTop(session: ClassSession): number { return this.lineTop(this.minutes(new Date(session.startsAt))); }
  sessionHeight(session: ClassSession): number { return Math.max(26, (this.minutes(new Date(session.endsAt)) - this.minutes(new Date(session.startsAt))) * this.pixelsPerMinute - 3); }
  sessionDensity(session: ClassSession): 'compact' | 'medium' | 'full' {
    const height = this.sessionHeight(session);
    if (height >= 64) return 'full';
    if (height >= 40) return 'medium';
    return 'compact';
  }
  sessionLabel(session: ClassSession): string { return `${session.courseName}, ${this.timeText(session.startsAt)} to ${this.timeText(session.endsAt)}, ${session.teacher || 'teacher unavailable'}, room ${session.room || 'TBA'}`; }
  hourLabel(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:00`; }
  courseColor(name: string): string { const colors = ['#d9eef7', '#e9e0f1', '#dff1dc', '#f7e1e7', '#fff0c7', '#d9f2ef', '#e7e9f7']; return colors[Math.abs([...name].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0)) % colors.length]; }
  private minutes(date: Date): number { return date.getHours() * 60 + date.getMinutes(); }
  private timeText(value: string): string { const date = new Date(value); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
  private localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  initials(name: string): string { return name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase(); }
}
