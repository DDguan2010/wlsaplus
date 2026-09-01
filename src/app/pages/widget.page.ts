import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ClockService } from '../core/clock.service';
import { LocalStore } from '../core/local-store.service';
import type { TodoItem } from '../core/models';
import { ConfirmDialogComponent, TextDialogComponent } from '../shared/text-dialog.component';

@Component({
  selector: 'app-widget-page', imports: [DatePipe, MatDialogModule],
  template: `
    <main class="widget">
      <header><span class="widget-brand"><img src="icons/app-icon.svg" alt=""><strong>WLSAPlus</strong></span><button (click)="close()" aria-label="Close"><span class="material-symbols-rounded">close</span></button></header>
      <section class="content">
        @if (type() === 'todo') {
          <div class="title-row"><div><div class="status">TASKS</div><h1>To do</h1></div><strong class="count">{{ store.todos().length }}</strong></div>
          @for (todo of store.todos(); track todo.id) {
            <div class="todo" [class.expanded]="expandedTodoId() === todo.id">
              <button class="todo-circle" (click)="deleteTodo(todo)" [attr.aria-label]="'Delete ' + todo.title"></button>
              <button class="todo-copy" (click)="toggleTodo(todo.id)" [attr.aria-expanded]="expandedTodoId() === todo.id"><strong>{{ todo.title }}</strong>@if (expandedTodoId() === todo.id) { <span>{{ todo.details || 'No additional information.' }}</span> }</button>
              <div class="todo-actions"><button (click)="editTodo(todo)" [attr.aria-label]="'Edit ' + todo.title"><span class="material-symbols-rounded">edit</span></button><button (click)="deleteTodo(todo)" [attr.aria-label]="'Delete ' + todo.title"><span class="material-symbols-rounded">delete</span></button></div>
              <time>{{ todo.createdAt | date:'MMM d' }}</time>
            </div>
          } @empty { <p class="muted">Nothing to do.</p> }
        } @else if (type() === 'today') {
          <div class="title-row"><div><div class="status">{{ clock.now() | date:'EEEE' }}</div><h1>Today's classes</h1></div><strong class="count">{{ today().length }}</strong></div>
          @for (session of today(); track session.id) { <div class="row"><time><strong>{{ session.startsAt | date:'HH:mm' }}</strong><span>{{ session.endsAt | date:'HH:mm' }}</span></time><div><strong>{{ session.courseName }}</strong><span>{{ session.teacher || 'Teacher TBA' }} · {{ session.room || 'Room TBA' }}</span></div></div> } @empty { <p class="muted">No classes today.</p> }
        } @else {
          <div class="status-line"><span class="status">{{ type() === 'next-class' ? 'UP NEXT' : current() ? 'IN CLASS' : 'UP NEXT' }}</span><time>{{ clock.now() | date:'EEE, MMM d · HH:mm' }}</time></div>
          @if (displayed(); as session) {
            <h1>{{ session.courseName }}</h1>
            <div class="time">{{ session.startsAt | date:'HH:mm' }} - {{ session.endsAt | date:'HH:mm' }}</div>
            <div class="details"><span><span class="material-symbols-rounded">person</span>{{ session.teacher || 'Teacher TBA' }}</span><span><span class="material-symbols-rounded">location_on</span>{{ session.room || 'Room TBA' }}</span></div>
            <div class="progress"><span [style.width.%]="progress()"></span></div>
            <div class="metrics"><div><strong>{{ countdown() }}</strong><span>{{ current() === session ? 'remaining' : 'until start' }}</span></div><div><strong>{{ duration() }} min</strong><span>duration</span></div></div>
            @if (following(); as nextSession) { <div class="next"><span>After this</span><strong>{{ nextSession.courseName }}</strong><time>{{ nextSession.startsAt | date:'HH:mm' }}</time></div> }
          } @else { <h1>No classes</h1><p class="muted">Your schedule is clear.</p> }
        }
      </section>
      <span class="resize-grip material-symbols-rounded">drag_indicator</span>
    </main>
  `,
  styles: `
    :host { display: block; height: 100vh; background: var(--app-surface); } .widget { position: relative; height: 100%; padding: 14px 16px 18px; display: flex; flex-direction: column; overflow: hidden; } header { flex: 0 0 30px; display: flex; justify-content: space-between; align-items: center; color: var(--app-muted); font-size: 12px; -webkit-app-region: drag; } .widget-brand { display: inline-flex; align-items: center; gap: 7px; } .widget-brand img { width: 20px; height: 20px; } header button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; -webkit-app-region: no-drag; } header .material-symbols-rounded { width: 18px; height: 18px; font-size: 18px; }
    .content { min-height: 0; overflow: auto; padding: 0 2px 8px; scrollbar-width: thin; } h1 { margin: 10px 0 5px; font-size: 26px; line-height: 1.12; } .status { color: var(--app-accent); font-size: 11px; font-weight: 700; text-transform: uppercase; } .status-line { margin-top: 16px; display: flex; justify-content: space-between; gap: 10px; } .status-line time { color: var(--app-muted); font-size: 11px; }
    .time { color: var(--app-muted); font-size: 14px; } .details { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; color: var(--app-muted); font-size: 12px; } .details > span { display: inline-flex; align-items: center; gap: 5px; } .details .material-symbols-rounded { width: 17px; height: 17px; font-size: 17px; }
    .progress { height: 5px; margin-top: 16px; overflow: hidden; border-radius: 3px; background: var(--app-surface-raised); } .progress span { display: block; height: 100%; background: var(--app-accent); }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; margin-top: 12px; } .metrics div { display: flex; flex-direction: column; gap: 2px; } .metrics strong { font-size: 15px; } .metrics span { color: var(--app-muted); font-size: 10px; }
    .next { min-height: 42px; margin-top: 14px; padding-top: 10px; display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 9px; border-top: 1px solid var(--app-border); font-size: 11px; } .next span, .next time { color: var(--app-muted); } .next strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title-row { margin-top: 16px; display: flex; align-items: end; justify-content: space-between; } .title-row h1 { margin-bottom: 0; } .count { font-size: 26px; color: var(--app-accent); }
    .row, .todo { min-height: 54px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--app-border); font-size: 12px; } .row > time { width: 42px; display: flex; flex-direction: column; gap: 2px; color: var(--app-text); } .row > time span, .row > div span { color: var(--app-muted); font-size: 10px; } .row > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; } .row > div strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .todo { padding: 5px 0; } .todo-circle { width: 15px; height: 15px; flex: 0 0 15px; padding: 0; border: 1px solid var(--app-muted); border-radius: 50%; background: transparent; cursor: pointer; } .todo-copy { min-width: 0; flex: 1; align-self: stretch; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 4px; padding: 0; border: 0; background: transparent; color: var(--app-text); text-align: left; cursor: pointer; } .todo-copy strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .todo-copy span { line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; } .todo.expanded .todo-copy strong { white-space: normal; overflow-wrap: anywhere; }
    .todo-actions { display: flex; flex-direction: row !important; gap: 0 !important; } .todo-actions button { width: 26px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; color: var(--app-muted); cursor: pointer; } .todo-actions .material-symbols-rounded { width: 16px; height: 16px; font-size: 16px; } .todo time { flex: 0 0 auto; color: var(--app-muted); font-size: 10px; }
    .resize-grip { position: absolute; right: 1px; bottom: 1px; width: 18px; height: 18px; color: var(--app-muted); font-size: 16px; opacity: .55; transform: rotate(-45deg); pointer-events: none; }
  `,
})
export class WidgetPage {
  readonly store = inject(LocalStore); readonly clock = inject(ClockService); private readonly route = inject(ActivatedRoute); private readonly dialog = inject(MatDialog);
  readonly expandedTodoId = signal<string | null>(null);
  readonly type = computed(() => this.route.snapshot.paramMap.get('type') ?? 'current-class');
  readonly current = computed(() => this.store.schedule().sessions.find((s) => new Date(s.startsAt) <= this.clock.now() && new Date(s.endsAt) > this.clock.now()) ?? null);
  readonly next = computed(() => this.store.schedule().sessions.find((s) => new Date(s.startsAt) > this.clock.now()) ?? null);
  readonly displayed = computed(() => this.type() === 'next-class' ? this.next() : this.current() ?? this.next());
  readonly following = computed(() => { const displayed = this.displayed(); return displayed ? this.store.schedule().sessions.find((s) => s.startsAt > displayed.startsAt) ?? null : null; });
  readonly duration = computed(() => { const session = this.displayed(); return session ? Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000) : 0; });
  readonly progress = computed(() => {
    const session = this.displayed();
    if (!session || this.current() !== session) return 0;
    return Math.min(100, Math.max(0, (this.clock.now().getTime() - new Date(session.startsAt).getTime()) / (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) * 100));
  });
  readonly countdown = computed(() => {
    const session = this.displayed(); if (!session) return '0 min';
    const target = this.current() === session ? new Date(session.endsAt) : new Date(session.startsAt);
    return `${Math.max(0, Math.ceil((target.getTime() - this.clock.now().getTime()) / 60_000))} min`;
  });
  readonly today = computed(() => { const key = this.clock.now().toLocaleDateString('en-CA'); return this.store.schedule().sessions.filter((s) => s.startsAt.slice(0,10) === key); });
  toggleTodo(id: string): void { this.expandedTodoId.update((current) => current === id ? null : id); }
  editTodo(todo: TodoItem): void {
    this.dialog.open(TextDialogComponent, { data: { mode: 'edit', title: todo.title, details: todo.details } }).afterClosed().subscribe((value: { title: string; details: string } | undefined) => {
      if (value) this.store.updateTodo(todo.id, value.title, value.details);
    });
  }
  deleteTodo(todo: TodoItem): void {
    this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete task?', message: todo.title, action: 'Delete' } }).afterClosed().subscribe((confirmed) => {
      if (confirmed) this.store.removeTodo(todo.id);
    });
  }
  close(): void { window.close(); }
}
