import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ClockService } from '../core/clock.service';
import { LocalStore } from '../core/local-store.service';
import type { DesktopCardType, ThemeMode } from '../core/models';
import { PlatformService } from '../core/platform.service';
import { PowerSchoolService } from '../core/powerschool.service';
import { UpdateService } from '../core/update.service';
import { ConfirmDialogComponent } from '../shared/text-dialog.component';
import { BUILD_VERSION } from '../build-info';

@Component({
  selector: 'app-settings-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatSlideToggleModule],
  template: `
    <div class="page">
      <header class="page-header"><h1 class="page-title">Settings</h1></header>
      <section><h2 class="section-title">Appearance</h2><div class="setting surface"><div><strong>Theme</strong><span>Choose how WLSAPlus looks.</span></div><mat-button-toggle-group [value]="store.settings().theme" (change)="setTheme($event.value)"><mat-button-toggle value="system">System</mat-button-toggle><mat-button-toggle value="light">Light</mat-button-toggle><mat-button-toggle value="dark">Dark</mat-button-toggle></mat-button-toggle-group></div></section>

      <section><h2 class="section-title">Schedule</h2><div class="settings-list surface">
        <div class="setting"><div><strong>PowerSchool</strong><span>@if (store.schedule().syncedAt) { Last updated {{ store.schedule().syncedAt | date:'MMM d, HH:mm' }} } @else { Not connected }</span></div><button mat-stroked-button (click)="sync()" [disabled]="syncing() || !platform.info.supportsPowerSchool"><span class="material-symbols-rounded">sync</span>{{ syncing() ? 'Syncing' : 'Sync now' }}</button></div>
        <div class="setting"><div><strong>Account</strong><span>Change your PowerSchool login.</span></div><button mat-button (click)="changeAccount()">Change account</button></div>
      </div></section>

      <section><h2 class="section-title">Tuning</h2><div class="settings-list surface">
        <div class="setting"><div><strong>Simulated time</strong><span>Preview the current-class card at another time.</span></div><mat-slide-toggle [checked]="store.settings().tuningEnabled" (change)="toggleTuning($event.checked)"></mat-slide-toggle></div>
        @if (store.settings().tuningEnabled) {
          <div class="tuning-panel"><input type="datetime-local" [value]="localDateTime()" (change)="setTime($event)"><div class="time-buttons"><button mat-stroked-button (click)="clock.shiftMinutes(-15)">-15 min</button><button mat-stroked-button (click)="clock.reset()">Now</button><button mat-stroked-button (click)="clock.shiftMinutes(15)">+15 min</button></div></div>
        }
      </div></section>

      @if (platform.info.supportsDesktopCards) {
        <section><h2 class="section-title">Windows Desktop Cards</h2><div class="settings-list surface"><div class="setting"><div><strong>Launch cards at startup</strong><span>Restore your desktop cards when Windows starts.</span></div><mat-slide-toggle [checked]="launchAtStartup()" (change)="setLaunchAtStartup($event.checked)"></mat-slide-toggle></div><div class="setting"><div><strong>Add a desktop card</strong><span>Cards stay behind normal app windows and do not appear in the taskbar.</span></div></div><div class="widget-actions">@for (card of cards; track card.type) { <button mat-stroked-button (click)="addCard(card.type)"><span class="material-symbols-rounded">{{ card.icon }}</span>{{ card.label }}</button> }</div></div></section>
      }

      @if (platform.info.kind === 'electron' && platform.info.os === 'windows') {
        <section><h2 class="section-title">Software updates</h2><div class="settings-list surface"><div class="setting update-setting"><div><strong>WLSAPlus {{ version }}</strong><span>{{ updater.status().message }}</span>@if (updater.status().state === 'downloading') { <div class="update-progress"><progress [value]="updater.status().percent ?? 0" max="100"></progress><span>{{ updater.status().percent ?? 0 }}%</span></div> }</div>
          @switch (updater.status().state) {
            @case ('available') { <button mat-flat-button (click)="updater.download()"><span class="material-symbols-rounded">download</span>Download update</button> }
            @case ('ready') { <button mat-flat-button (click)="updater.install()"><span class="material-symbols-rounded">restart_alt</span>Restart and install</button> }
            @case ('downloading') { <button mat-button disabled>Downloading</button> }
            @case ('installing') { <button mat-button disabled>Installing</button> }
            @case ('checking') { <button mat-button disabled>Checking</button> }
            @default { <button mat-stroked-button (click)="updater.check()"><span class="material-symbols-rounded">refresh</span>Check for updates</button> }
          }
        </div></div></section>
      }

      <section><h2 class="section-title">Local Data</h2><div class="settings-list surface danger-zone"><div class="setting"><div><strong>Clear this device</strong><span>Remove saved credentials, schedule, and tasks.</span></div><button mat-stroked-button (click)="clearData()">Clear data</button></div></div></section>
      <footer>WLSAPlus {{ version }} · Local-first student tools</footer>
    </div>
  `,
  styles: `
    .settings-list { overflow: hidden; } .setting { min-height: 78px; padding: 16px 18px; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 20px; border-bottom: 1px solid var(--app-border); } .setting:last-child { border: 0; }
    .setting > div { min-width: 0; display: flex; flex-direction: column; gap: 4px; } .setting > div strong { line-height: 1.25; } .setting > div > span { color: var(--app-muted); font-size: 13px; line-height: 1.4; } .setting button, .widget-actions button, .time-buttons button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap; } .setting button .material-symbols-rounded, .widget-actions .material-symbols-rounded { margin: 0; font-size: 19px; line-height: 1; }
    .tuning-panel { padding: 18px; background: var(--app-surface-raised); } input { height: 48px; width: min(100%, 280px); padding: 0 12px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface); color: var(--app-text); }
    .time-buttons, .widget-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; } .widget-actions { padding: 0 18px 18px; margin-top: 0; }
    .danger-zone button { color: #ba1a1a; } footer { padding: 34px 0 6px; color: var(--app-muted); text-align: center; font-size: 12px; }
    .update-progress { width: min(100%, 360px); display: grid; grid-template-columns: minmax(0,1fr) 36px; align-items: center; gap: 9px; margin-top: 8px; color: var(--app-muted); font-size: 11px; } .update-progress progress { width: 100%; height: 7px; accent-color: var(--app-accent); }
    @media (max-width: 680px) { .setting { gap: 12px; } .setting > button { justify-self: start; } .setting > mat-slide-toggle { justify-self: end; } mat-button-toggle-group { width: 100%; } mat-button-toggle { flex: 1; } }
  `,
})
export class SettingsPage {
  readonly version = BUILD_VERSION;
  readonly store = inject(LocalStore); readonly clock = inject(ClockService); readonly platform = inject(PlatformService);
  readonly updater = inject(UpdateService);
  private readonly service = inject(PowerSchoolService); private readonly router = inject(Router); private readonly snack = inject(MatSnackBar); private readonly dialog = inject(MatDialog);
  readonly syncing = signal(false);
  readonly launchAtStartup = signal(true);
  readonly cards: { type: DesktopCardType; label: string; icon: string }[] = [
    { type: 'current-class', label: 'Current class', icon: 'schedule' }, { type: 'next-class', label: 'Next class', icon: 'skip_next' }, { type: 'today', label: 'Today', icon: 'calendar_today' }, { type: 'todo', label: 'Tasks', icon: 'checklist' },
  ];
  constructor() {
    if (this.platform.info.supportsDesktopCards) void window.wlsaplus?.desktopCards.getSettings().then((value) => this.launchAtStartup.set(value.launchAtStartup));
  }
  setTheme(theme: ThemeMode): void { this.store.updateSettings({ theme }); }
  toggleTuning(enabled: boolean): void { this.store.updateSettings({ tuningEnabled: enabled, tunedTime: enabled ? (this.store.settings().tunedTime ?? new Date().toISOString()) : null }); }
  localDateTime(): string { const date = this.clock.now(); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); }
  setTime(event: Event): void { this.clock.setTunedTime((event.target as HTMLInputElement).value); }
  async sync(): Promise<void> { this.syncing.set(true); try { await this.service.syncSaved(); this.snack.open('Schedule updated', undefined, { duration: 2500 }); } catch (error) { this.snack.open(error instanceof Error ? error.message : 'Sync failed', 'Dismiss'); } finally { this.syncing.set(false); } }
  async changeAccount(): Promise<void> { await this.router.navigateByUrl('/connect'); }
  async addCard(type: DesktopCardType): Promise<void> { await window.wlsaplus?.desktopCards.add(type); this.snack.open('Desktop card added', undefined, { duration: 2200 }); }
  async setLaunchAtStartup(value: boolean): Promise<void> { this.launchAtStartup.set(value); await window.wlsaplus?.desktopCards.setSettings({ launchAtStartup: value }); }
  clearData(): void { this.dialog.open(ConfirmDialogComponent, { data: { title: 'Clear this device?', message: 'Saved credentials, schedule, and tasks will be removed.', action: 'Clear data' } }).afterClosed().subscribe(async (confirmed) => { if (confirmed) { await this.service.disconnect(); await this.router.navigateByUrl('/connect'); } }); }
}
