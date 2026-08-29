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
    <h2 mat-dialog-title>Add a task</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>What needs to be done?</mat-label>
        <textarea matInput [formControl]="text" rows="3" maxlength="180" autofocus></textarea>
        <mat-hint align="end">{{ text.value.length }}/180</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="text.invalid" (click)="submit()">Add</button>
    </mat-dialog-actions>
  `,
  styles: `mat-form-field { width: min(420px, 72vw); margin-top: 6px; }`,
})
export class TextDialogComponent {
  private readonly ref = inject(MatDialogRef<TextDialogComponent>);
  readonly text = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  submit(): void { if (this.text.valid) this.ref.close(this.text.value.trim()); }
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
