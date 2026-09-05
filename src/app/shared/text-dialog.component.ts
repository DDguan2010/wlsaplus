import { Component, inject } from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TODO_COLOR_OPTIONS } from '../core/models';
import type { TodoColor } from '../core/models';

export interface TaskDialogData {
  mode: 'add' | 'edit';
  title?: string;
  details?: string;
  endAt?: string | null;
  color?: TodoColor | null;
}

export interface TaskDialogResult {
  title: string;
  details: string;
  endAt: string | null;
  color: TodoColor | null;
}

function optionalDateTime(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return { dateTime: true };
  return Number.isNaN(new Date(value).getTime()) ? { dateTime: true } : null;
}

@Component({
  selector: 'app-text-dialog',
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
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
      <mat-form-field appearance="outline">
        <mat-label>End time</mat-label>
        <input matInput type="datetime-local" [formControl]="endAt">
        <mat-hint>Optional deadline</mat-hint>
        @if (endAt.hasError('dateTime')) { <mat-error>Enter a valid date and time.</mat-error> }
      </mat-form-field>
      <fieldset class="color-field">
        <legend>Color <span>Optional</span></legend>
        <div class="color-options">
          <button type="button" class="color-swatch no-color" [class.selected]="color.value === null" [attr.aria-pressed]="color.value === null" (click)="color.setValue(null)" aria-label="No task color" matTooltip="No color"><span class="none-line"></span>@if (color.value === null) { <span class="material-symbols-rounded">check</span> }</button>
          @for (option of colorOptions; track option.value) {
            <button type="button" class="color-swatch" [attr.data-task-color]="option.value" [class.selected]="color.value === option.value" [attr.aria-pressed]="color.value === option.value" (click)="color.setValue(option.value)" [attr.aria-label]="option.label + ' task color'" [matTooltip]="option.label">@if (color.value === option.value) { <span class="material-symbols-rounded">check</span> }</button>
          }
        </div>
      </fieldset>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="title.invalid || details.invalid || endAt.invalid" (click)="submit()">{{ data?.mode === 'edit' ? 'Save' : 'Add' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { width: min(480px, 82vw); }
    mat-form-field { width: 100%; margin-top: 6px; }
    .color-field { margin: 8px 0 2px; padding: 0; border: 0; }
    .color-field legend { margin-bottom: 10px; color: var(--app-text); font-size: 14px; font-weight: 500; }
    .color-field legend span { margin-left: 5px; color: var(--app-muted); font-size: 12px; font-weight: 400; }
    .color-options { display: flex; flex-wrap: wrap; gap: 10px; }
    .color-swatch { position: relative; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 2px solid transparent; border-radius: 50%; background: var(--task-color); color: var(--task-on-color); cursor: pointer; }
    .color-swatch:hover { transform: scale(1.06); }
    .color-swatch.selected { border-color: var(--app-text); box-shadow: 0 0 0 2px var(--app-surface); }
    .color-swatch .material-symbols-rounded { width: 18px; height: 18px; font-size: 18px; font-variation-settings: 'FILL' 0, 'wght' 700, 'GRAD' 0, 'opsz' 20; }
    .no-color { overflow: hidden; border-color: var(--app-border); background: var(--app-surface-raised); color: var(--app-text); }
    .no-color .none-line { position: absolute; width: 38px; height: 2px; background: #c43d4f; transform: rotate(-45deg); }
    .no-color .material-symbols-rounded { z-index: 1; padding: 1px; border-radius: 50%; background: var(--app-surface-raised); }
  `,
})
export class TextDialogComponent {
  private readonly ref = inject(MatDialogRef<TextDialogComponent>);
  readonly data = inject<TaskDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly title = new FormControl(this.data?.title ?? '', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(120)] });
  readonly details = new FormControl(this.data?.details ?? '', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly endAt = new FormControl(this.toLocalDateTime(this.data?.endAt), { nonNullable: true, validators: [optionalDateTime] });
  readonly colorOptions = TODO_COLOR_OPTIONS;
  readonly color = new FormControl<TodoColor | null>(this.data?.color ?? null);
  submit(): void {
    if (this.title.valid && this.details.valid && this.endAt.valid) {
      const value = this.endAt.value.trim();
      this.ref.close({ title: this.title.value.trim(), details: this.details.value.trim(), endAt: value ? new Date(value).toISOString() : null, color: this.color.value });
    }
  }
  private toLocalDateTime(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
