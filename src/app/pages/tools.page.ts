import { TranslatePipe } from '../core/i18n.service';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlatformService } from '../core/platform.service';
import { PhoneReceiverService } from '../core/phone-receiver.service';

@Component({
  selector: 'app-tools-page',
  imports: [TranslatePipe, RouterLink],
  template: `
    <div class="page">
      <header class="page-header"><h1 class="page-title">{{ 'Tools' | t }}</h1></header>
      <section class="tool-list" [attr.aria-label]="'Available tools' | t">
        <a class="tool-row surface" routerLink="/tools/map"><span class="tool-icon material-symbols-rounded">map</span><span><strong>{{ 'Map' | t }}</strong><small>{{ 'Find classrooms, buildings, and facilities on the WLSA campus.' | t }}</small></span><span class="arrow material-symbols-rounded">chevron_right</span></a>
        @if (platform.info.kind === 'android') { <button class="tool-row surface" (click)="receiver.open()"><span class="tool-icon material-symbols-rounded">phonelink</span><span><strong>{{ 'Connect to computer' | t }}</strong><small>{{ 'Phone control' | t }}</small></span><span class="arrow material-symbols-rounded">chevron_right</span></button> }
        @if (platform.info.kind !== 'web') { <a class="tool-row surface" routerLink="/tools/vpn"><span class="tool-icon material-symbols-rounded">vpn_lock</span><span><strong>VPN</strong><small>{{ 'Free VPN used for access to apps and websites blocked by school Wi-Fi. Sometimes unstable.' | t }}</small></span><span class="arrow material-symbols-rounded">chevron_right</span></a> }
        @if (platform.info.supportsPhoneControl) { <a class="tool-row surface" routerLink="/tools/phone"><span class="tool-icon material-symbols-rounded">cast</span><span><strong>{{ 'Phone control' | t }}</strong><small>{{ 'Use an Android phone from your laptop over the same Wi-Fi, with sound and the phone display turned off.' | t }}</small></span><span class="arrow material-symbols-rounded">chevron_right</span></a> }
        <a class="tool-row surface" routerLink="/tools/translate"><span class="tool-icon material-symbols-rounded">translate</span><span><strong>{{ 'Translator' | t }}</strong><small>{{ 'Translate text between languages and recognize text from a selected screen region on Windows.' | t }}</small></span><span class="arrow material-symbols-rounded">chevron_right</span></a>
      </section>
    </div>
  `,
  styles: `
    button.tool-row { width: 100%; text-align: left; font: inherit; cursor: pointer; }
    .tool-list { display: grid; gap: 10px; } .tool-row { min-height: 92px; padding: 18px; display: grid; grid-template-columns: 48px minmax(0,1fr) 24px; align-items: center; gap: 16px; color: var(--app-text); text-decoration: none; }
    .tool-row:hover { border-color: color-mix(in srgb, var(--app-accent) 48%, var(--app-border)); background: color-mix(in srgb, var(--app-accent-soft) 28%, var(--app-surface)); }
    .tool-icon { width: 48px; height: 48px; border-radius: 8px; background: var(--app-accent-soft); color: var(--app-accent); font-size: 26px; }
    .tool-row > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 5px; } strong { font-size: 17px; } small { max-width: 680px; color: var(--app-muted); font-size: 13px; line-height: 1.45; }
    .arrow { color: var(--app-muted); font-size: 22px; }
    @media (max-width: 520px) { .tool-row { grid-template-columns: 42px minmax(0,1fr) 20px; padding: 15px 13px; gap: 11px; } .tool-icon { width: 42px; height: 42px; font-size: 23px; } }
  `,
})
export class ToolsPage {
  readonly platform = inject(PlatformService); readonly receiver = inject(PhoneReceiverService); }
