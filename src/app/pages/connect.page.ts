import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CredentialVault } from '../core/credential-vault.service';
import { PlatformService } from '../core/platform.service';
import { PowerSchoolService } from '../core/powerschool.service';

@Component({
  selector: 'app-connect-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  template: `
    <main class="connect-page">
      <section class="connect-panel">
        <div class="logo"><img src="icons/app-icon.svg" alt="WLSAPlus"></div>
        <h1>Connect PowerSchool</h1>
        <p class="muted">Your account and schedule stay on this device.</p>
        @if (!platform.info.supportsPowerSchool) {
          <div class="notice"><span class="material-symbols-rounded">computer</span><div><strong>Use the desktop or Android app to connect</strong><br>The web browser cannot access your school's PowerSchool directly. Cached data remains available here.</div></div>
        }
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline"><mat-label>PowerSchool address</mat-label><input matInput formControlName="schoolUrl" autocomplete="url" [readonly]="platform.info.kind === 'web'"><span class="material-symbols-rounded field-icon" matSuffix>language</span></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Username</mat-label><input matInput formControlName="username" autocomplete="username"><span class="material-symbols-rounded field-icon" matSuffix>person</span></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Password</mat-label><input matInput formControlName="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password"><button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())" aria-label="Toggle password visibility"><span class="material-symbols-rounded field-icon">{{ showPassword() ? 'visibility_off' : 'visibility' }}</span></button></mat-form-field>
          @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
          <button mat-flat-button class="connect-button" type="submit" [disabled]="form.invalid || loading() || !platform.info.supportsPowerSchool">
            @if (loading()) { <mat-spinner diameter="22" /> } @else { <span>Connect</span><span class="material-symbols-rounded button-icon">arrow_forward</span> }
          </button>
          @if (hasSaved()) { <button mat-button type="button" (click)="openCached()">Open cached schedule</button> }
          @if (!platform.info.supportsPowerSchool && !hasSaved()) { <button mat-button type="button" (click)="openCached()">Continue offline</button> }
        </form>
      </section>
    </main>
  `,
  styles: `
    .connect-page { min-height: 100vh; padding: 32px 20px; display: grid; place-items: center; }
    .connect-panel { width: min(100%, 440px); }
    .logo { width: 58px; height: 58px; display: grid; place-items: center; } .logo img { display: block; width: 58px; height: 58px; }
    h1 { margin: 28px 0 8px; font-size: 32px; } p { margin: 0 0 28px; }
    form, mat-form-field { width: 100%; } form { display: grid; gap: 4px; }
    .connect-button { height: 52px; margin-top: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; } .connect-button mat-spinner { margin: auto; } .button-icon, .field-icon { line-height: 1; } .button-icon { font-size: 20px; } .field-icon { font-size: 20px; }
    .notice, .error { border-radius: 8px; padding: 14px; margin-bottom: 20px; }
    .notice { display: flex; gap: 12px; background: var(--app-accent-soft); color: var(--app-text); font-size: 13px; line-height: 1.5; }
    .error { background: color-mix(in srgb, #ba1a1a 14%, transparent); color: #ba1a1a; font-size: 14px; }
  `,
})
export class ConnectPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(PowerSchoolService);
  private readonly vault = inject(CredentialVault);
  private readonly router = inject(Router);
  readonly platform = inject(PlatformService);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);
  readonly hasSaved = signal(false);
  readonly form = this.fb.nonNullable.group({
    schoolUrl: ['https://ps.wlsash.org.cn', [Validators.required]],
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  async ngOnInit(): Promise<void> {
    const saved = await this.vault.get();
    this.hasSaved.set(Boolean(saved));
    if (saved) this.form.setValue(saved);
  }
  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.loading.set(true); this.error.set('');
    try { await this.service.connect(this.form.getRawValue()); await this.router.navigateByUrl('/'); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Unable to connect.'); }
    finally { this.loading.set(false); }
  }
  async openCached(): Promise<void> { sessionStorage.setItem('wlsaplus:offline', 'true'); await this.router.navigateByUrl('/'); }
}
