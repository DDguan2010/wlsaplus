import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ClockService } from '../core/clock.service';
import { buildHomeTimeline } from '../core/home-timeline';
import { LocalStore } from '../core/local-store.service';
import { todoDeadlineProgress } from '../core/models';
import type { ClassSession, TodoItem } from '../core/models';
import { ConfirmDialogComponent, TextDialogComponent } from '../shared/text-dialog.component';
import type { TaskDialogResult } from '../shared/text-dialog.component';

@Component({
  selector: 'app-home-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatDialogModule, MatProgressBarModule, MatSnackBarModule, MatTooltipModule],
  template: `
    <div class="page">
      <header class="page-header"><div><div class="eyebrow">{{ clock.now() | date:'EEEE, MMMM d' }}</div><h1 class="page-title">Overview</h1></div><a mat-icon-button class="header-icon-button" routerLink="/settings" aria-label="Open settings"><span class="material-symbols-rounded">settings</span></a></header>

      <a class="class-card" routerLink="/schedule">
        <div class="card-top"><span class="state-dot"></span><span class="state-label">{{ cardState().label }}</span><span class="spacer"></span><span class="time-now">{{ clock.now() | date:'HH:mm' }}</span></div>
        @if (featured(); as session) {
          <h2>{{ session.courseName }}</h2>
          <div class="time-range">{{ session.startsAt | date:'HH:mm' }} - {{ session.endsAt | date:'HH:mm' }}</div>
          <div class="facts"><span><span class="material-symbols-rounded">person</span>{{ session.teacher || 'Teacher unavailable' }}</span><span><span class="material-symbols-rounded">location_on</span>{{ session.room || 'Room unavailable' }}</span></div>
          <mat-progress-bar mode="determinate" [value]="progress()" />
          <div class="card-bottom"><strong>{{ countdown() }}</strong><span>{{ duration(session) }} min class</span></div>
          @if (nextAfterFeatured(); as next) { <div class="next-line"><span>Next</span><strong>{{ next.courseName }}</strong><span>{{ next.startsAt | date:'HH:mm' }}</span></div> }
        } @else {
          <div class="clear-state"><span class="material-symbols-rounded">event_available</span><h2>No more classes</h2><p>Your schedule is clear for now.</p></div>
        }
      </a>

      <section class="timeline-section">
        <div class="section-heading timeline-heading"><div><h2>Timeline</h2><span>{{ clock.now() | date:'MMM d, HH:mm' }} to {{ timeline().endsAt | date:'MMM d, HH:mm' }}</span></div></div>
        <div class="timeline-frame surface">
          <div class="timeline-scroll">
            <div class="timeline-canvas">
              <div class="timeline-axis">
                @for (tick of timeline().ticks; track tick.at; let first = $first; let last = $last) {
                  <time [style.left.%]="tick.left" [class.first]="first" [class.last]="last">{{ first ? 'Now' : (tick.at | date:'EEE, MMM d') }}</time>
                }
              </div>
              <div class="timeline-body">
                <span class="timeline-now" aria-hidden="true"></span>
                <div class="timeline-group-label"><span class="material-symbols-rounded">calendar_month</span>Schedule</div>
                @for (lane of timeline().scheduleLanes; track $index) {
                  <div class="timeline-lane">
                    @for (entry of lane; track entry.id) {
                      <div tabindex="0" class="timeline-entry schedule-entry" [style.left.%]="entry.left" [style.width.%]="entry.width" [style.--timeline-item-color]="timelineColor(entry.colorIndex)" [matTooltip]="entry.tooltip"><span>{{ entry.title }}</span></div>
                    }
                  </div>
                } @empty { <div class="timeline-lane"></div> }
                <div class="timeline-group-label"><span class="material-symbols-rounded">timer</span>Deadlines</div>
                @for (lane of timeline().deadlineLanes; track $index) {
                  <div class="timeline-lane">
                    @for (entry of lane; track entry.id) {
                      <div tabindex="0" class="timeline-entry deadline-entry" [attr.data-task-color]="entry.color" [style.left.%]="entry.left" [style.width.%]="entry.width" [matTooltip]="entry.tooltip"><span>{{ entry.title }}</span></div>
                    }
                  </div>
                } @empty { <div class="timeline-lane"></div> }
                <div class="timeline-group-label"><span class="material-symbols-rounded">schedule</span>Times</div>
                @for (lane of timeline().timeLanes; track $index) {
                  <div class="timeline-lane timeline-point-lane">
                    @for (entry of lane; track entry.id) {
                      <div tabindex="0" class="timeline-point" [attr.data-task-color]="entry.color" [style.left.%]="entry.left" [matTooltip]="entry.tooltip"><span></span></div>
                    }
                  </div>
                } @empty { <div class="timeline-lane"></div> }
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="todo-section">
        <div class="section-heading"><div><h2>Tasks</h2><span>{{ store.todos().length }} open</span></div><button mat-mini-fab (click)="addTodo()" aria-label="Add a task"><span class="material-symbols-rounded">add</span></button></div>
        <div class="todo-list surface">
          @for (todo of store.todos(); track todo.id) {
            <div class="todo-row" [class.expanded]="expandedTodoId() === todo.id" [attr.data-task-color]="todo.color">
              <button class="todo-circle" (click)="deleteTodo(todo)" [attr.aria-label]="'Delete ' + todo.title"></button>
              <div class="todo-main"><button class="todo-content" (click)="toggleTodo(todo.id)" [attr.aria-expanded]="expandedTodoId() === todo.id">
                  <span class="todo-title">@if (todo.icon) { <span class="todo-task-icon material-symbols-rounded">{{ todo.icon }}</span> }<strong>{{ todo.title }}</strong></span>
                  @if (expandedTodoId() === todo.id) { <span class="todo-details">{{ todo.details || 'No additional information.' }}</span> }
                </button>
                @if (todo.endAt) {
                  @if (todo.timeType === 'deadline') { <div class="todo-deadline" [class.overdue]="todoProgress(todo) >= 100"><div class="deadline-track"><span [style.width.%]="todoProgress(todo)"></span></div><time>Due {{ todo.endAt | date:'MMM d, HH:mm' }}</time></div> }
                  @else { <div class="todo-time"><span class="material-symbols-rounded">calendar_clock</span><time>{{ todo.endAt | date:'EEE, MMM d · HH:mm' }}</time></div> }
                }
                </div>
              <div class="todo-actions">
                <button mat-icon-button (click)="editTodo(todo)" [attr.aria-label]="'Edit ' + todo.title"><span class="material-symbols-rounded">edit</span></button>
                <button mat-icon-button (click)="deleteTodo(todo)" [attr.aria-label]="'Delete ' + todo.title"><span class="material-symbols-rounded">delete</span></button>
              </div>
            </div>
          } @empty {
            <div class="empty-state compact"><div><span class="material-symbols-rounded">check_circle</span><p>Nothing to do</p></div></div>
          }
        </div>
      </section>
    </div>
  `,
  styles: `
    .eyebrow { color: var(--app-muted); font-size: 13px; margin-bottom: 4px; }
    .header-icon-button { width: 44px; height: 44px; padding: 0 !important; display: inline-grid !important; place-items: center; line-height: 0; } .header-icon-button .material-symbols-rounded { width: 24px; height: 24px; font-size: 24px; }
    .class-card { min-height: 390px; display: flex; flex-direction: column; padding: 28px; border-radius: 8px; background: var(--app-accent); color: var(--app-on-accent); text-decoration: none; overflow: hidden; }
    .card-top, .facts, .card-bottom, .next-line { display: flex; align-items: center; }
    .state-dot { width: 8px; height: 8px; margin-right: 9px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 14%, transparent); }
    .state-label { font-size: 14px; font-weight: 700; } .time-now { font-variant-numeric: tabular-nums; }
    h2 { margin: 50px 0 8px; font-size: clamp(30px, 5vw, 48px); line-height: 1.08; font-weight: 600; }
    .time-range { opacity: .84; font-size: 18px; }
    .facts { gap: 24px; margin: 26px 0 34px; flex-wrap: wrap; } .facts span { display: inline-flex; align-items: center; gap: 7px; } .facts .material-symbols-rounded { font-size: 20px; }
    mat-progress-bar { --mdc-linear-progress-active-indicator-color: var(--app-on-accent); --mdc-linear-progress-track-color: color-mix(in srgb, var(--app-on-accent) 25%, transparent); }
    .card-bottom { margin-top: 13px; gap: 12px; font-size: 13px; } .card-bottom strong { font-size: 18px; }
    .next-line { min-height: 54px; margin-top: auto; padding-top: 20px; gap: 12px; border-top: 1px solid color-mix(in srgb, var(--app-on-accent) 22%, transparent); } .next-line span:first-child { opacity: .72; } .next-line strong { flex: 1; }
    .clear-state { margin: auto; text-align: center; } .clear-state .material-symbols-rounded { font-size: 54px; } .clear-state h2 { margin: 12px 0 6px; } .clear-state p { margin: 0; opacity: .8; }
    .timeline-section, .todo-section { margin-top: 34px; } .section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .section-heading h2 { margin: 0; color: var(--app-text); font-size: 22px; } .section-heading span { color: var(--app-muted); font-size: 13px; }
    .timeline-frame { overflow: hidden; } .timeline-scroll { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; } .timeline-canvas { width: 1680px; padding: 0 10px 6px; }
    .timeline-axis { position: relative; height: 32px; margin: 0 2px; border-bottom: 1px solid var(--app-border); } .timeline-axis time { position: absolute; bottom: 7px; color: var(--app-muted); font-size: 9px; white-space: nowrap; transform: translateX(-50%); } .timeline-axis time.first { color: var(--app-accent); font-weight: 700; transform: none; } .timeline-axis time.last { transform: translateX(-100%); }
    .timeline-body { position: relative; } .timeline-now { position: absolute; inset: 0 auto 0 2px; z-index: 3; width: 2px; background: var(--app-accent); pointer-events: none; }
    .timeline-group-label { position: sticky; left: 6px; z-index: 4; width: max-content; height: 20px; display: flex; align-items: center; gap: 4px; padding: 0 5px; background: color-mix(in srgb, var(--app-surface) 92%, transparent); color: var(--app-muted); font-size: 9px; font-weight: 700; text-transform: uppercase; } .timeline-group-label .material-symbols-rounded { font-size: 13px; }
    .timeline-lane { position: relative; height: 22px; border-top: 1px solid color-mix(in srgb, var(--app-border) 62%, transparent); background-image: linear-gradient(to right, transparent calc(100% - 1px), color-mix(in srgb, var(--app-border) 72%, transparent) calc(100% - 1px)); background-size: calc(100% / 7) 100%; }
    .timeline-entry { --timeline-entry-color: var(--timeline-item-color, var(--app-accent)); position: absolute; top: 3px; z-index: 2; min-width: 8px; height: 16px; display: flex; align-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--timeline-entry-color) 64%, var(--app-border)); border-left: 2px solid var(--timeline-entry-color); border-radius: 3px; background: color-mix(in srgb, var(--timeline-entry-color) 24%, var(--app-surface)); color: var(--app-text); outline: none; }
    .timeline-entry[data-task-color], .timeline-point[data-task-color] { --timeline-entry-color: var(--task-color); } .timeline-entry span { min-width: 0; padding: 0 4px; overflow: hidden; font-size: 9px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } .deadline-entry { background: color-mix(in srgb, var(--timeline-entry-color) 30%, var(--app-surface)); }
    .timeline-entry:focus-visible, .timeline-point:focus-visible { box-shadow: 0 0 0 2px var(--app-surface), 0 0 0 4px var(--timeline-entry-color); }
    .timeline-point { --timeline-entry-color: var(--app-accent); position: absolute; top: 4px; z-index: 2; width: 14px; height: 14px; display: grid; place-items: center; border-radius: 50%; outline: none; transform: translateX(-50%); } .timeline-point > span { width: 9px; height: 9px; border: 2px solid var(--app-surface); border-radius: 50%; background: var(--timeline-entry-color); box-shadow: 0 0 0 1px var(--timeline-entry-color); }
    .todo-list { overflow: hidden; } .todo-row { width: 100%; min-height: 62px; padding: 8px 10px 8px 18px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--app-border); background: transparent; color: var(--app-text); }
    .todo-row[data-task-color] { border-bottom-color: color-mix(in srgb, var(--task-color) 34%, var(--app-border)); background: color-mix(in srgb, var(--task-color) 26%, var(--app-surface)); }
    .todo-row:last-child { border-bottom: 0; } .todo-circle { width: 19px; height: 19px; flex: 0 0 19px; padding: 0; border: 2px solid var(--app-muted); border-radius: 50%; background: transparent; cursor: pointer; } .todo-row[data-task-color] .todo-circle { border-color: var(--task-color); } .todo-circle:hover { border-color: var(--task-color, var(--app-accent)); background: color-mix(in srgb, var(--task-color, var(--app-accent)) 16%, transparent); }
    .todo-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 7px; } .todo-content { width: 100%; min-width: 0; flex: 1; align-self: stretch; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 6px; padding: 4px 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; } .todo-title { width: 100%; display: flex; align-items: center; gap: 8px; } .todo-title strong { min-width: 0; overflow-wrap: anywhere; font-weight: 500; } .todo-task-icon { width: 21px; height: 21px; flex: 0 0 21px; color: var(--task-color, var(--app-accent)); font-size: 21px; } .todo-details { color: var(--app-muted); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .todo-deadline { width: 100%; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; } .deadline-track { height: 4px; overflow: hidden; border-radius: 2px; background: var(--app-surface-raised); } .deadline-track span { display: block; height: 100%; background: var(--task-color, var(--app-accent)); } .todo-deadline time { color: var(--app-muted); font-size: 11px; white-space: nowrap; } .todo-deadline.overdue time { color: #ba1a1a; }
    .todo-time { display: inline-flex; align-items: center; gap: 6px; color: var(--task-color, var(--app-accent)); } .todo-time .material-symbols-rounded { width: 17px; height: 17px; font-size: 17px; } .todo-time time { font-size: 11px; font-weight: 500; }
    .todo-actions { display: flex; flex: 0 0 auto; } .todo-actions button { width: 40px; height: 40px; color: var(--app-muted); } .todo-actions .material-symbols-rounded { width: 20px; height: 20px; font-size: 20px; } .todo-actions button:hover { color: var(--app-text); }
    .compact { min-height: 130px; } .compact .material-symbols-rounded { font-size: 32px; }
    @media (max-width: 580px) { .class-card { min-height: 400px; padding: 22px; } h2 { margin-top: 38px; } .facts { align-items: flex-start; flex-direction: column; gap: 10px; margin: 22px 0 30px; } .todo-row { gap: 10px; padding-left: 14px; } .todo-actions button { width: 36px; height: 40px; } }
  `,
})
export class HomePage {
  readonly store = inject(LocalStore);
  readonly clock = inject(ClockService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  readonly expandedTodoId = signal<string | null>(null);
  readonly timeline = computed(() => buildHomeTimeline(this.store.schedule().sessions, this.store.todos(), this.clock.now().getTime()));
  private readonly timelineColors = ['#3569ad', '#287451', '#7453ad', '#b65c12', '#c43d4f', '#14747b', '#a94474'];
  private readonly ordered = computed(() => [...this.store.schedule().sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  readonly current = computed(() => this.ordered().find((item) => new Date(item.startsAt) <= this.clock.now() && new Date(item.endsAt) > this.clock.now()) ?? null);
  readonly upcoming = computed(() => this.ordered().find((item) => new Date(item.startsAt) > this.clock.now()) ?? null);
  readonly featured = computed(() => this.current() ?? this.upcoming());
  readonly cardState = computed(() => ({ label: this.current() ? 'In class now' : this.upcoming() ? 'Up next' : 'Day complete' }));
  readonly nextAfterFeatured = computed(() => {
    const featured = this.featured();
    return featured ? this.ordered().find((item) => item.startsAt > featured.startsAt) ?? null : null;
  });
  readonly progress = computed(() => {
    const session = this.current(); if (!session) return 0;
    return Math.min(100, Math.max(0, (this.clock.now().getTime() - new Date(session.startsAt).getTime()) / (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) * 100));
  });
  readonly countdown = computed(() => {
    const session = this.featured(); if (!session) return '';
    const target = this.current() ? new Date(session.endsAt) : new Date(session.startsAt);
    const mins = Math.max(0, Math.ceil((target.getTime() - this.clock.now().getTime()) / 60_000));
    return this.current() ? `${mins} min left` : `Starts in ${mins} min`;
  });
  duration(session: ClassSession): number { return Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000); }
  timelineColor(index: number): string { return this.timelineColors[index % this.timelineColors.length]; }
  addTodo(): void {
    this.dialog.open(TextDialogComponent, { data: { mode: 'add' } }).afterClosed().subscribe((value: TaskDialogResult | undefined) => {
      if (value) this.store.addTodo(value.title, value.details, value.endAt, value.color, value.icon, value.timeType);
    });
  }
  editTodo(todo: TodoItem): void {
    this.dialog.open(TextDialogComponent, { data: { mode: 'edit', title: todo.title, details: todo.details, endAt: todo.endAt, color: todo.color, icon: todo.icon, timeType: todo.timeType } }).afterClosed().subscribe((value: TaskDialogResult | undefined) => {
      if (value) this.store.updateTodo(todo.id, value.title, value.details, value.endAt, value.color, value.icon, value.timeType);
    });
  }
  toggleTodo(id: string): void { this.expandedTodoId.update((current) => current === id ? null : id); }
  deleteTodo(todo: TodoItem): void {
    this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete task?', message: todo.title, action: 'Delete' } }).afterClosed().subscribe((confirmed) => {
      if (!confirmed) return; const removed = this.store.removeTodo(todo.id); if (!removed) return;
      if (this.expandedTodoId() === todo.id) this.expandedTodoId.set(null);
      this.snack.open('Task deleted', 'Undo', { duration: 4500 }).onAction().subscribe(() => this.store.restoreTodo(removed));
    });
  }
  todoProgress(todo: TodoItem): number { return todoDeadlineProgress(todo, this.clock.now().getTime()); }
}
