import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlatformService } from '../core/platform.service';
import { VpnService } from '../core/vpn.service';

@Component({
  selector: 'app-vpn-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <div class="page tool-page">
      <header class="page-header"><a class="back icon-button" routerLink="/tools" aria-label="Back to tools"><span class="material-symbols-rounded">arrow_back</span></a><div><h1 class="page-title">VPN</h1><span>02VPN</span></div></header>
      <section class="vpn-panel surface" [class.connected]="status().state === 'connected'">
        <div class="status-mark"><span class="material-symbols-rounded">{{ statusIcon() }}</span></div>
        <div class="status-copy"><span>{{ statusLabel() }}</span><h2>{{ status().message }}</h2>@if (status().connectedAt) { <time>Connected {{ status().connectedAt | date:'HH:mm' }}</time> }</div>
        @if (busy()) { <mat-spinner diameter="42"></mat-spinner> }
        @else if (status().state === 'connected') { <button mat-stroked-button (click)="vpn.disconnect()">Disconnect</button> }
        @else { <button mat-flat-button (click)="vpn.connect()" [disabled]="status().state === 'unavailable'">{{ platform.info.kind === 'android' ? 'Open VPN client' : 'Connect' }}</button> }
      </section>
      <div class="facts"><span><span class="material-symbols-rounded">shield</span>Encrypted connection</span><span><span class="material-symbols-rounded">public</span>System proxy</span><span><span class="material-symbols-rounded">sync</span>Automatic subscription</span></div>
      @if (platform.info.kind === 'android') { <p class="platform-note">Android opens 02VPN in an installed Clash-compatible client.</p> }
      @if (platform.info.kind === 'web') { <p class="platform-note">Install the Windows, macOS, or Android app to use VPN.</p> }
    </div>
  `,
  styles: `
    .tool-page { max-width: 820px; } .page-header { justify-content: flex-start; } .page-header > div { min-width: 0; } .page-header > div span { color: var(--app-muted); font-size: 13px; } .back { margin-left: -10px; color: var(--app-text); text-decoration: none; }
    .vpn-panel { min-height: 260px; padding: 32px; display: grid; grid-template-columns: 64px minmax(0,1fr) auto; align-items: center; gap: 24px; } .status-mark { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 8px; background: var(--app-surface-raised); color: var(--app-muted); } .status-mark span { font-size: 34px; } .connected .status-mark { background: color-mix(in srgb, var(--app-success) 18%, var(--app-surface)); color: var(--app-success); }
    .status-copy { min-width: 0; } .status-copy > span { color: var(--app-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; } h2 { margin: 7px 0 6px; font-size: 25px; line-height: 1.2; } time { color: var(--app-muted); font-size: 13px; } button { min-width: 116px; height: 46px; }
    .facts { display: grid; grid-template-columns: repeat(3,1fr); margin-top: 14px; color: var(--app-muted); font-size: 12px; } .facts > span { min-height: 46px; display: flex; align-items: center; justify-content: center; gap: 7px; border-right: 1px solid var(--app-border); } .facts > span:last-child { border: 0; } .facts .material-symbols-rounded { font-size: 18px; } .platform-note { margin: 20px 0 0; color: var(--app-muted); font-size: 13px; text-align: center; }
    @media (max-width: 600px) { .vpn-panel { min-height: 310px; padding: 25px 20px; grid-template-columns: 1fr; justify-items: center; gap: 18px; text-align: center; } .facts { grid-template-columns: 1fr; } .facts > span { border-right: 0; border-bottom: 1px solid var(--app-border); } }
  `,
})
export class VpnPage {
  readonly vpn = inject(VpnService); readonly platform = inject(PlatformService); readonly status = this.vpn.status;
  readonly busy = computed(() => this.status().state === 'connecting' || this.status().state === 'disconnecting');
  readonly statusLabel = computed(() => ({ connected: 'Connected', connecting: 'Connecting', disconnecting: 'Disconnecting', delegated: 'Opened', error: 'Connection error', unavailable: 'Unavailable', idle: 'Disconnected' })[this.status().state]);
  readonly statusIcon = computed(() => this.status().state === 'connected' ? 'verified_user' : this.status().state === 'error' ? 'error' : 'vpn_lock');
}
