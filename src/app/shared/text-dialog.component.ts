import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-text-dialog',
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatFormFieldModule, MatInputModule],
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
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="title.invalid || details.invalid" (click)="submit()">{{ data?.mode === 'edit' ? 'Save' : 'Add' }}</button>
    </mat-dialog-actions>
  `,
  styles: `mat-dialog-content { width: min(480px, 82vw); } mat-form-field { width: 100%; margin-top: 6px; }`,
})
export class TextDialogComponent {
  private readonly ref = inject(MatDialogRef<TextDialogComponent>);
  readonly data = inject<{ mode: 'add' | 'edit'; title?: string; details?: string } | null>(MAT_DIALOG_DATA, { optional: true });
  readonly title = new FormControl(this.data?.title ?? '', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(120)] });
  readonly details = new FormControl(this.data?.details ?? '', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  submit(): void {
    if (this.title.valid && this.details.valid) this.ref.close({ title: this.title.value.trim(), details: this.details.value.trim() });
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
