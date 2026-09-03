import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CredentialVault } from '../core/credential-vault.service';
import { LocalStore } from '../core/local-store.service';
import { PlatformService } from '../core/platform.service';
import { PowerSchoolService } from '../core/powerschool.service';
import { UpdateService } from '../core/update.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatTooltipModule],
  template: `
    <div class="app-frame">
      <aside class="rail">
        <a class="brand" routerLink="/" aria-label="WLSAPlus home"><img src="icons/app-icon.svg" alt=""></a>
        <nav aria-label="Main navigation">
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/' }" [matTooltip]="item.label" matTooltipPosition="right">
              <span class="material-symbols-rounded">{{ item.icon }}</span><span>{{ item.label }}</span>
            </a>
          }
        </nav>
      </aside>
      <main><router-outlet /></main>
      @if (updater.actionable()) {
        <aside class="update-alert" aria-live="polite">
          <span class="update-icon material-symbols-rounded">system_update</span>
          <div class="update-copy">
            <strong>@if (updater.status().state === 'ready') { Update ready } @else { New WLSAPlus version }</strong>
            <span>{{ updater.status().message }}</span>
            @if (updater.status().state === 'downloading') {
              <div class="progress-row"><progress [value]="updater.status().percent ?? 0" max="100"></progress><span>{{ updater.status().percent ?? 0 }}%</span></div>
            }
          </div>
          @if (updater.status().state === 'available') {
            <button mat-flat-button (click)="updater.download()"><span class="material-symbols-rounded">download</span>Download</button>
          } @else if (updater.status().state === 'ready') {
            <button mat-flat-button (click)="updater.install()"><span class="material-symbols-rounded">restart_alt</span>Restart</button>
          }
        </aside>
      }
      <nav class="bottom-nav" aria-label="Main navigation">
        @for (item of nav; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/' }">
            <span class="material-symbols-rounded">{{ item.icon }}</span><span>{{ item.label }}</span>
          </a>
        }
      </nav>
    </div>
  `,
  styles: `
    .app-frame { min-height: 100vh; }
    main { min-width: 0; }
    .rail { position: fixed; inset: 0 auto 0 0; z-index: 10; width: 88px; padding: 20px 10px; background: var(--app-surface); border-right: 1px solid var(--app-border); }
    .brand { width: 48px; height: 48px; margin: 0 auto 28px; display: grid; place-items: center; text-decoration: none; } .brand img { width: 48px; height: 48px; display: block; }
    nav { display: grid; gap: 8px; }
    nav a { min-height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-radius: 8px; color: var(--app-muted); text-decoration: none; font-size: 12px; font-weight: 500; }
    nav a .material-symbols-rounded { font-size: 24px; }
    nav a.active { color: var(--app-accent); background: var(--app-accent-soft); }
    main { margin-left: 88px; }
    .bottom-nav { display: none; }
    .update-alert { position: fixed; right: 22px; bottom: 22px; z-index: 40; width: min(430px, calc(100vw - 132px)); min-height: 86px; display: grid; grid-template-columns: 42px minmax(0,1fr) auto; align-items: center; gap: 14px; padding: 16px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 8px; box-shadow: 0 10px 30px rgb(0 0 0 / 16%); }
    .update-icon { width: 42px; height: 42px; border-radius: 8px; background: var(--app-accent-soft); color: var(--app-accent); font-size: 25px; }
    .update-copy { min-width: 0; display: grid; gap: 4px; } .update-copy strong { font-size: 14px; } .update-copy > span { color: var(--app-muted); font-size: 12px; line-height: 1.35; }
    .update-alert button { min-width: 106px; } .update-alert button .material-symbols-rounded { margin-right: 6px; font-size: 18px; }
    .progress-row { display: grid; grid-template-columns: minmax(0,1fr) 34px; align-items: center; gap: 8px; margin-top: 4px; color: var(--app-muted); font-size: 11px; } progress { width: 100%; height: 6px; accent-color: var(--app-accent); }
    @media (max-width: 899px) {
      .rail { display: none; } main { margin-left: 0; }
      .bottom-nav { position: fixed; display: grid; grid-template-columns: repeat(4, 1fr); inset: auto 0 0; z-index: 20; min-height: 72px; padding: 4px max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); background: color-mix(in srgb, var(--app-surface) 94%, transparent); border-top: 1px solid var(--app-border); backdrop-filter: blur(18px); }
      .bottom-nav a { min-height: 62px; }
      .update-alert { right: 12px; bottom: 84px; width: calc(100vw - 24px); grid-template-columns: 38px minmax(0,1fr); } .update-alert button { grid-column: 2; justify-self: start; }
    }
  `,
})
export class ShellComponent implements OnInit {
  private readonly store = inject(LocalStore);
  private readonly vault = inject(CredentialVault);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService);
  private readonly powerSchool = inject(PowerSchoolService);
  readonly updater = inject(UpdateService);
  readonly nav = [
    { path: '/', label: 'Home', icon: 'home' },
    { path: '/schedule', label: 'Schedule', icon: 'calendar_month' },
    { path: '/tools', label: 'Tools', icon: 'build' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];

  async ngOnInit(): Promise<void> {
    const credentials = await this.vault.get();
    if (!credentials) {
      if (!this.store.hasSchedule() && sessionStorage.getItem('wlsaplus:offline') !== 'true') await this.router.navigateByUrl('/connect');
      return;
    }
    if (this.platform.info.supportsPowerSchool) {
      const refreshed = await this.refreshSchedule();
      if (!refreshed && !this.store.hasSchedule() && this.platform.info.kind === 'web') {
        await this.router.navigateByUrl('/connect');
        return;
      }
      window.setInterval(() => void this.refreshSchedule(), 15 * 60 * 1000);
    }
  }

  private async refreshSchedule(): Promise<boolean> {
    try { await this.powerSchool.syncSaved(); return true; }
    catch { return false; /* Keep the last local schedule available offline. */ }
  }
}
