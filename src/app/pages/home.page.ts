import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ClockService } from '../core/clock.service';
import { LocalStore } from '../core/local-store.service';
import { todoDeadlineProgress } from '../core/models';
import type { ClassSession, TodoItem } from '../core/models';
import { ConfirmDialogComponent, TextDialogComponent } from '../shared/text-dialog.component';
import type { TaskDialogResult } from '../shared/text-dialog.component';

@Component({
  selector: 'app-home-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatDialogModule, MatProgressBarModule, MatSnackBarModule],
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

      <section class="todo-section">
        <div class="section-heading"><div><h2>Tasks</h2><span>{{ store.todos().length }} open</span></div><button mat-mini-fab (click)="addTodo()" aria-label="Add a task"><span class="material-symbols-rounded">add</span></button></div>
        <div class="todo-list surface">
          @for (todo of store.todos(); track todo.id) {
            <div class="todo-row" [class.expanded]="expandedTodoId() === todo.id" [attr.data-task-color]="todo.color">
              <button class="todo-circle" (click)="deleteTodo(todo)" [attr.aria-label]="'Delete ' + todo.title"></button>
              <div class="todo-main"><button class="todo-content" (click)="toggleTodo(todo.id)" [attr.aria-expanded]="expandedTodoId() === todo.id">
                  <strong>{{ todo.title }}</strong>
                  @if (expandedTodoId() === todo.id) { <span>{{ todo.details || 'No additional information.' }}</span> }
                </button>
                @if (todo.endAt) { <div class="todo-deadline" [class.overdue]="todoProgress(todo) >= 100"><div class="deadline-track"><span [style.width.%]="todoProgress(todo)"></span></div><time>Ends {{ todo.endAt | date:'MMM d, HH:mm' }}</time></div> }
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
    .class-card { min-height: 390px; display: flex; flex-direction: column; padding: 28px; border-radius: 8px; background: var(--app-accent); color: white; text-decoration: none; overflow: hidden; }
    .card-top, .facts, .card-bottom, .next-line { display: flex; align-items: center; }
    .state-dot { width: 8px; height: 8px; margin-right: 9px; border-radius: 50%; background: #b8f5cf; box-shadow: 0 0 0 5px rgba(184,245,207,.13); }
    .state-label { font-size: 14px; font-weight: 700; } .time-now { font-variant-numeric: tabular-nums; }
    h2 { margin: 50px 0 8px; font-size: clamp(30px, 5vw, 48px); line-height: 1.08; font-weight: 600; }
    .time-range { opacity: .84; font-size: 18px; }
    .facts { gap: 24px; margin: 26px 0 34px; flex-wrap: wrap; } .facts span { display: inline-flex; align-items: center; gap: 7px; } .facts .material-symbols-rounded { font-size: 20px; }
    mat-progress-bar { --mdc-linear-progress-active-indicator-color: #fff; --mdc-linear-progress-track-color: rgba(255,255,255,.25); }
    .card-bottom { margin-top: 13px; gap: 12px; font-size: 13px; } .card-bottom strong { font-size: 18px; }
    .next-line { min-height: 54px; margin-top: auto; padding-top: 20px; gap: 12px; border-top: 1px solid rgba(255,255,255,.22); } .next-line span:first-child { opacity: .72; } .next-line strong { flex: 1; }
    .clear-state { margin: auto; text-align: center; } .clear-state .material-symbols-rounded { font-size: 54px; } .clear-state h2 { margin: 12px 0 6px; } .clear-state p { margin: 0; opacity: .8; }
    .todo-section { margin-top: 34px; } .section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .section-heading h2 { margin: 0; color: var(--app-text); font-size: 22px; } .section-heading span { color: var(--app-muted); font-size: 13px; }
    .todo-list { overflow: hidden; } .todo-row { width: 100%; min-height: 62px; padding: 8px 10px 8px 18px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--app-border); background: transparent; color: var(--app-text); }
    .todo-row[data-task-color] { border-bottom-color: color-mix(in srgb, var(--task-color) 34%, var(--app-border)); background: color-mix(in srgb, var(--task-color) 26%, var(--app-surface)); }
    .todo-row:last-child { border-bottom: 0; } .todo-circle { width: 19px; height: 19px; flex: 0 0 19px; padding: 0; border: 2px solid var(--app-muted); border-radius: 50%; background: transparent; cursor: pointer; } .todo-row[data-task-color] .todo-circle { border-color: var(--task-color); } .todo-circle:hover { border-color: var(--task-color, var(--app-accent)); background: color-mix(in srgb, var(--task-color, var(--app-accent)) 16%, transparent); }
    .todo-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 7px; } .todo-content { width: 100%; min-width: 0; flex: 1; align-self: stretch; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 6px; padding: 4px 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; } .todo-content strong { width: 100%; overflow-wrap: anywhere; font-weight: 500; } .todo-content > span { color: var(--app-muted); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .todo-deadline { width: 100%; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; } .deadline-track { height: 4px; overflow: hidden; border-radius: 2px; background: var(--app-surface-raised); } .deadline-track span { display: block; height: 100%; background: var(--task-color, var(--app-accent)); } .todo-deadline time { color: var(--app-muted); font-size: 11px; white-space: nowrap; } .todo-deadline.overdue time { color: #ba1a1a; }
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
  addTodo(): void {
    this.dialog.open(TextDialogComponent, { data: { mode: 'add' } }).afterClosed().subscribe((value: TaskDialogResult | undefined) => {
      if (value) this.store.addTodo(value.title, value.details, value.endAt, value.color);
    });
  }
  editTodo(todo: TodoItem): void {
    this.dialog.open(TextDialogComponent, { data: { mode: 'edit', title: todo.title, details: todo.details, endAt: todo.endAt, color: todo.color } }).afterClosed().subscribe((value: TaskDialogResult | undefined) => {
      if (value) this.store.updateTodo(todo.id, value.title, value.details, value.endAt, value.color);
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
