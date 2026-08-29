import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CredentialVault } from '../core/credential-vault.service';
import { LocalStore } from '../core/local-store.service';
import { PlatformService } from '../core/platform.service';
import { PowerSchoolService } from '../core/powerschool.service';

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
    @media (max-width: 899px) {
      .rail { display: none; } main { margin-left: 0; }
      .bottom-nav { position: fixed; display: grid; grid-template-columns: repeat(4, 1fr); inset: auto 0 0; z-index: 20; min-height: 72px; padding: 4px max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); background: color-mix(in srgb, var(--app-surface) 94%, transparent); border-top: 1px solid var(--app-border); backdrop-filter: blur(18px); }
      .bottom-nav a { min-height: 62px; }
    }
  `,
})
export class ShellComponent implements OnInit {
  private readonly store = inject(LocalStore);
  private readonly vault = inject(CredentialVault);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService);
  private readonly powerSchool = inject(PowerSchoolService);
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
      await this.refreshSchedule();
      window.setInterval(() => void this.refreshSchedule(), 15 * 60 * 1000);
    }
  }

  private async refreshSchedule(): Promise<void> {
    try { await this.powerSchool.syncSaved(); } catch { /* Keep the last local schedule available offline. */ }
  }
}
