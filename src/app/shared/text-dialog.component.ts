import { Component, inject } from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TODO_COLOR_OPTIONS, TODO_ICON_OPTIONS } from '../core/models';
import type { TodoColor, TodoIcon, TodoTimeType } from '../core/models';

export interface TaskDialogData {
  mode: 'add' | 'edit';
  title?: string;
  details?: string;
  endAt?: string | null;
  color?: TodoColor | null;
  icon?: TodoIcon | null;
  timeType?: TodoTimeType;
}

export interface TaskDialogResult {
  title: string;
  details: string;
  endAt: string | null;
  color: TodoColor | null;
  icon: TodoIcon | null;
  timeType: TodoTimeType;
}

function optionalTime(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  if (!value) return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : { time: true };
}

@Component({
  selector: 'app-text-dialog',
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatButtonToggleModule, MatDatepickerModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
  providers: [provideNativeDateAdapter()],
  template: `
    <h2 mat-dialog-title>{{ data?.mode === 'edit' ? 'Edit task' : 'Add a task' }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Title</mat-label>
        <input matInput [formControl]="title" maxlength="120" autofocus>
        <mat-hint align="end">{{ title.value.length }}/120</mat-hint>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Information</mat-label>
        <textarea matInput [formControl]="details" rows="5" maxlength="1000"></textarea>
        <mat-hint align="end">{{ details.value.length }}/1000</mat-hint>
      </mat-form-field>
      <div class="time-type-row">
        <span>When</span>
        <mat-button-toggle-group [formControl]="timeType" aria-label="Task time type">
          <mat-button-toggle value="time"><span class="material-symbols-rounded">schedule</span>Time</mat-button-toggle>
          <mat-button-toggle value="deadline"><span class="material-symbols-rounded">timer</span>Deadline</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <div class="deadline-fields">
        <mat-form-field appearance="outline">
          <mat-label>{{ timeType.value === 'deadline' ? 'Due date' : 'Date' }}</mat-label>
          <input matInput [matDatepicker]="endDatePicker" [formControl]="endDate" (dateChange)="ensureEndTime()">
          <mat-datepicker-toggle matIconSuffix [for]="endDatePicker" aria-label="Open deadline calendar"></mat-datepicker-toggle>
          <mat-datepicker #endDatePicker></mat-datepicker>
          <mat-hint>Optional</mat-hint>
          @if (endDate.invalid) { <mat-error>Choose a valid date.</mat-error> }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Time</mat-label>
          <input matInput type="time" [formControl]="endTime">
          <mat-hint>Required with a date</mat-hint>
          @if (endTime.hasError('time')) { <mat-error>Choose a valid time.</mat-error> }
        </mat-form-field>
      </div>
      @if (endDate.value || endTime.value) { <button type="button" mat-button class="clear-deadline" (click)="clearDeadline()"><span class="material-symbols-rounded">event_busy</span>Clear {{ timeType.value }}</button> }
      <fieldset class="color-field">
        <legend>Color <span>Optional</span></legend>
        <div class="color-options">
          <button type="button" class="color-swatch no-color" [class.selected]="color.value === null" [attr.aria-pressed]="color.value === null" (click)="color.setValue(null)" aria-label="No task color" matTooltip="No color"><span class="none-line"></span>@if (color.value === null) { <span class="material-symbols-rounded">check</span> }</button>
          @for (option of colorOptions; track option.value) {
            <button type="button" class="color-swatch" [attr.data-task-color]="option.value" [class.selected]="color.value === option.value" [attr.aria-pressed]="color.value === option.value" (click)="color.setValue(option.value)" [attr.aria-label]="option.label + ' task color'" [matTooltip]="option.label">@if (color.value === option.value) { <span class="material-symbols-rounded">check</span> }</button>
          }
        </div>
      </fieldset>
      <fieldset class="icon-field">
        <legend>Icon <span>Optional</span></legend>
        <div class="icon-options">
          <button type="button" class="icon-option" [class.selected]="icon.value === null" [attr.aria-pressed]="icon.value === null" (click)="icon.setValue(null)" aria-label="No task icon" matTooltip="No icon"><span class="material-symbols-rounded">block</span></button>
          @for (option of iconOptions; track option.value) {
            <button type="button" class="icon-option" [class.selected]="icon.value === option.value" [attr.aria-pressed]="icon.value === option.value" (click)="icon.setValue(option.value)" [attr.aria-label]="option.label + ' task icon'" [matTooltip]="option.label"><span class="material-symbols-rounded">{{ option.value }}</span></button>
          }
        </div>
      </fieldset>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="title.invalid || details.invalid || !deadlineValid()" (click)="submit()">{{ data?.mode === 'edit' ? 'Save' : 'Add' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { width: min(480px, 82vw); }
    mat-form-field { width: 100%; margin-top: 6px; }
    .time-type-row { min-height: 48px; margin-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .time-type-row > span { color: var(--app-text); font-size: 14px; font-weight: 500; }
    .time-type-row mat-button-toggle-group { flex: 0 0 auto; }
    .time-type-row mat-button-toggle .material-symbols-rounded { margin-right: 5px; font-size: 17px; vertical-align: -3px; }
    .deadline-fields { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(120px, .75fr); gap: 10px; }
    .clear-deadline { height: 34px; margin: -2px 0 4px; color: var(--app-muted); }
    .clear-deadline .material-symbols-rounded { margin-right: 6px; font-size: 18px; }
    .color-field, .icon-field { margin: 8px 0 2px; padding: 0; border: 0; }
    .color-field legend, .icon-field legend { margin-bottom: 10px; color: var(--app-text); font-size: 14px; font-weight: 500; }
    .color-field legend span, .icon-field legend span { margin-left: 5px; color: var(--app-muted); font-size: 12px; font-weight: 400; }
    .color-options { display: flex; flex-wrap: wrap; gap: 10px; }
    .color-swatch { position: relative; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 2px solid transparent; border-radius: 50%; background: var(--task-color); color: var(--task-on-color); cursor: pointer; }
    .color-swatch:hover { transform: scale(1.06); }
    .color-swatch.selected { border-color: var(--app-text); box-shadow: 0 0 0 2px var(--app-surface); }
    .color-swatch .material-symbols-rounded { width: 18px; height: 18px; font-size: 18px; font-variation-settings: 'FILL' 0, 'wght' 700, 'GRAD' 0, 'opsz' 20; }
    .no-color { overflow: hidden; border-color: var(--app-border); background: var(--app-surface-raised); color: var(--app-text); }
    .no-color .none-line { position: absolute; width: 38px; height: 2px; background: #c43d4f; transform: rotate(-45deg); }
    .no-color .material-symbols-rounded { z-index: 1; padding: 1px; border-radius: 50%; background: var(--app-surface-raised); }
    .icon-options { display: flex; flex-wrap: wrap; gap: 8px; }
    .icon-option { width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border: 1px solid var(--app-border); border-radius: 6px; background: transparent; color: var(--app-muted); cursor: pointer; }
    .icon-option:hover { background: var(--app-surface-raised); color: var(--app-text); }
    .icon-option.selected { border-color: var(--app-accent); background: var(--app-accent-soft); color: var(--app-accent); }
    .icon-option .material-symbols-rounded { width: 20px; height: 20px; font-size: 20px; }
    @media (max-width: 430px) { .deadline-fields { grid-template-columns: 1fr; gap: 0; } }
  `,
})
export class TextDialogComponent {
  private readonly ref = inject(MatDialogRef<TextDialogComponent>);
  readonly data = inject<TaskDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly title = new FormControl(this.data?.title ?? '', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(120)] });
  readonly details = new FormControl(this.data?.details ?? '', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly endDate = new FormControl<Date | null>(this.toEndDate(this.data?.endAt));
  readonly endTime = new FormControl(this.toEndTime(this.data?.endAt), { nonNullable: true, validators: [optionalTime] });
  readonly colorOptions = TODO_COLOR_OPTIONS;
  readonly color = new FormControl<TodoColor | null>(this.data?.color ?? null);
  readonly iconOptions = TODO_ICON_OPTIONS;
  readonly icon = new FormControl<TodoIcon | null>(this.data?.icon ?? null);
  readonly timeType = new FormControl<TodoTimeType>(this.data?.timeType ?? 'time', { nonNullable: true });
  submit(): void {
    if (this.title.valid && this.details.valid && this.deadlineValid()) {
      this.ref.close({ title: this.title.value.trim(), details: this.details.value.trim(), endAt: this.buildEndAt(), color: this.color.value, icon: this.icon.value, timeType: this.timeType.value });
    }
  }
  ensureEndTime(): void {
    if (this.endDate.value && !this.endTime.value) this.endTime.setValue('23:59');
  }
  clearDeadline(): void {
    this.endDate.setValue(null);
    this.endTime.setValue('');
  }
  deadlineValid(): boolean {
    if (!this.endDate.value && !this.endTime.value) return true;
    return Boolean(this.endDate.value && this.endDate.valid && this.endTime.value && this.endTime.valid);
  }
  private buildEndAt(): string | null {
    const date = this.endDate.value;
    const match = /^(\d{2}):(\d{2})$/.exec(this.endTime.value);
    if (!date || !match) return null;
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number(match[1]), Number(match[2]));
    return result.toISOString();
  }
  private toEndDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  private toEndTime(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [mat-dialog-close]="true">{{ data.action }}</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<{ title: string; message: string; action: string }>(MAT_DIALOG_DATA);
}
