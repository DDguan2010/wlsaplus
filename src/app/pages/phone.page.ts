import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { PhoneControlAction } from '../core/models';
import { PhoneService } from '../core/phone.service';

@Component({
  selector: 'app-phone-page',
  imports: [RouterLink, MatButtonModule, MatSlideToggleModule, MatTooltipModule],
  template: `
    <div class="page phone-page">
      <header class="page-header">
        <a class="back icon-button" routerLink="/tools" aria-label="Back to tools"><span class="material-symbols-rounded">arrow_back</span></a>
        <h1 class="page-title">Phone control</h1>
        <span class="spacer"></span>
      </header>

      <section class="connection surface" aria-live="polite">
        <span class="status-icon material-symbols-rounded" [class.active]="status().state === 'mirroring'">{{ statusIcon() }}</span>
        <div class="connection-copy">
          <strong>{{ statusTitle() }}</strong>
          <span>{{ status().message }}</span>
          @if (status().deviceName) {
            <small>{{ status().deviceName }}@if (status().androidVersion) { · Android {{ status().androidVersion }} }@if (status().ip) { · {{ status().ip }} }</small>
          }
        </div>
        <div class="connection-actions">
          @if (status().state === 'mirroring') {
            <button mat-flat-button (click)="stop()" [disabled]="working()"><span class="material-symbols-rounded">stop_circle</span>Close phone</button>
          } @else if (canReopen()) {
            <button mat-flat-button (click)="start()" [disabled]="working()"><span class="material-symbols-rounded">smartphone</span>Open wirelessly</button>
          } @else {
            <button mat-flat-button (click)="connect()" [disabled]="working()"><span class="material-symbols-rounded">usb</span>{{ working() ? 'Connecting' : 'Connect by USB' }}</button>
          }
        </div>
      </section>

      @if (status().state === 'mirroring') {
        <section>
          <h2 class="section-title">Controls</h2>
          <div class="control-bar surface" aria-label="Phone controls">
            @for (control of controls; track control.action) {
              <button type="button" class="control-button" (click)="control.action && sendControl(control.action)" [matTooltip]="control.label" [attr.aria-label]="control.label">
                <span class="material-symbols-rounded">{{ control.icon }}</span>
              </button>
            }
          </div>
        </section>
      }

      <section>
        <h2 class="section-title">First connection</h2>
        <div class="setup-list surface">
          <div class="setup-step"><span class="step-number">1</span><div><strong>Enable USB debugging</strong><span>On the Android phone, enable Developer options and USB debugging.</span></div></div>
          <div class="setup-step"><span class="step-number">2</span><div><strong>Connect and authorize</strong><span>Connect the phone by USB, unlock it, then allow this computer on the debugging prompt.</span></div></div>
          <div class="setup-step"><span class="step-number">3</span><div><strong>Use the same Wi-Fi</strong><span>Connect the phone and laptop to the same Wi-Fi. WLSAPlus finds the phone address and switches it to wireless mode.</span></div></div>
        </div>
      </section>

      <section>
        <h2 class="section-title">Mirroring</h2>
        <div class="settings-list surface">
          <div class="setting"><div><strong>Turn off the phone display</strong><span>The computer view stays active while the physical phone screen is black.</span></div><mat-slide-toggle [checked]="turnScreenOff()" (change)="setTurnScreenOff($event.checked)" [disabled]="working() || status().state === 'mirroring'"></mat-slide-toggle></div>
          <div class="setting"><div><strong>Sound</strong><span>@if (status().audioAvailable === false) { This phone needs Android 11 or newer for audio. } @else { Sound starts automatically on Android 11 or newer. Keep Android 11 phones unlocked while opening the mirror. }</span></div><span class="material-symbols-rounded feature-state">{{ status().audioAvailable === false ? 'volume_off' : 'volume_up' }}</span></div>
          @if (status().serial) {
            <div class="setting"><div><strong>Wireless device</strong><span>{{ status().serial }}</span></div><button mat-stroked-button (click)="disconnect()" [disabled]="working()"><span class="material-symbols-rounded">link_off</span>Forget</button></div>
          }
        </div>
      </section>
    </div>
  `,
  styles: `
    .phone-page { max-width: 980px; }
    .connection { min-height: 116px; padding: 20px; display: grid; grid-template-columns: 58px minmax(0,1fr) auto; align-items: center; gap: 18px; }
    .status-icon { width: 58px; height: 58px; border-radius: 8px; background: var(--app-accent-soft); color: var(--app-accent); font-size: 31px; } .status-icon.active { background: var(--app-accent); color: var(--app-on-accent); }
    .connection-copy { min-width: 0; display: grid; gap: 5px; } .connection-copy strong { font-size: 18px; } .connection-copy > span { color: var(--app-muted); font-size: 13px; line-height: 1.45; } .connection-copy small { color: var(--app-accent); font-size: 12px; overflow-wrap: anywhere; }
    .connection-actions button, .setting button { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; } .connection-actions .material-symbols-rounded, .setting button .material-symbols-rounded { font-size: 19px; }
    .setup-list, .settings-list { overflow: hidden; } .setup-step { min-height: 82px; padding: 16px 18px; display: grid; grid-template-columns: 34px minmax(0,1fr); align-items: center; gap: 15px; border-bottom: 1px solid var(--app-border); } .setup-step:last-child, .setting:last-child { border: 0; }
    .step-number { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--app-accent); border-radius: 50%; color: var(--app-accent); font-size: 13px; font-weight: 700; } .setup-step div { display: grid; gap: 4px; } .setup-step div span { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
    .control-bar { min-height: 74px; padding: 10px 14px; display: flex; align-items: center; justify-content: center; gap: 8px; } .control-button { width: 48px; height: 48px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--app-text); cursor: pointer; } .control-button:hover { background: var(--app-accent-soft); color: var(--app-accent); } .control-button .material-symbols-rounded { font-size: 25px; }
    .setting { min-height: 78px; padding: 16px 18px; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 20px; border-bottom: 1px solid var(--app-border); } .setting > div { min-width: 0; display: grid; gap: 4px; } .setting > div > span { color: var(--app-muted); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; } .feature-state { color: var(--app-accent); font-size: 24px; }
    @media (max-width: 680px) { .connection { grid-template-columns: 48px minmax(0,1fr); padding: 16px; gap: 13px; } .status-icon { width: 48px; height: 48px; font-size: 27px; } .connection-actions { grid-column: 2; } .control-bar { justify-content: space-between; gap: 2px; } .control-button { width: 42px; height: 42px; } }
  `,
})
export class PhonePage {
  private readonly phone = inject(PhoneService);
  private readonly snack = inject(MatSnackBar);
  readonly status = this.phone.status;
  readonly turnScreenOff = signal(localStorage.getItem('wlsaplus:phone-screen-off') !== 'false');
  readonly working = computed(() => ['waiting-usb', 'waiting-authorization', 'configuring', 'connecting', 'stopping'].includes(this.status().state));
  readonly canReopen = computed(() => Boolean(this.status().serial) && ['ready', 'error'].includes(this.status().state));
  readonly controls: { action: PhoneControlAction; label: string; icon: string }[] = [
    { action: 'back', label: 'Back', icon: 'arrow_back' },
    { action: 'home', label: 'Home', icon: 'home' },
    { action: 'recents', label: 'Recent apps', icon: 'crop_square' },
    { action: 'volume-down', label: 'Volume down', icon: 'volume_down' },
    { action: 'volume-up', label: 'Volume up', icon: 'volume_up' },
    { action: 'power', label: 'Power', icon: 'power_settings_new' },
  ];

  readonly statusIcon = computed(() => ({
    unsupported: 'phone_android',
    idle: 'phone_android',
    'waiting-usb': 'usb',
    'waiting-authorization': 'phonelink_lock',
    configuring: 'settings_input_antenna',
    connecting: 'wifi',
    mirroring: 'cast_connected',
    ready: 'smartphone',
    stopping: 'progress_activity',
    error: 'error',
  }[this.status().state]));

  readonly statusTitle = computed(() => ({
    unsupported: 'Windows app required',
    idle: 'Connect an Android phone',
    'waiting-usb': 'Waiting for USB',
    'waiting-authorization': 'Authorization needed',
    configuring: 'Setting up wireless mode',
    connecting: 'Connecting over Wi-Fi',
    mirroring: 'Phone is connected',
    ready: 'Ready to reopen',
    stopping: 'Closing phone window',
    error: 'Connection problem',
  }[this.status().state]));

  setTurnScreenOff(value: boolean): void {
    this.turnScreenOff.set(value);
    localStorage.setItem('wlsaplus:phone-screen-off', String(value));
  }

  async connect(): Promise<void> { await this.run(() => this.phone.connect(this.turnScreenOff())); }
  async start(): Promise<void> { await this.run(() => this.phone.start(this.turnScreenOff())); }
  async stop(): Promise<void> { await this.run(() => this.phone.stop()); }
  async disconnect(): Promise<void> { await this.run(() => this.phone.disconnect()); }
  async sendControl(action: PhoneControlAction): Promise<void> { await this.run(() => this.phone.control(action)); }

  private async run(operation: () => Promise<void>): Promise<void> {
    try { await operation(); }
    catch (error) { this.snack.open(error instanceof Error ? error.message : 'Phone control failed.', 'Dismiss', { duration: 7000 }); }
  }
}
