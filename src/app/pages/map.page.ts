import { TranslatePipe } from '../core/i18n.service';
import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CampusMapPanelComponent } from '../shared/campus-map-panel.component';

@Component({
  selector: 'app-map-page',
  imports: [TranslatePipe, RouterLink, CampusMapPanelComponent],
  template: `
    <div class="page map-page">
      <header class="page-header"><a class="back icon-button" routerLink="/tools" [attr.aria-label]="'Back to tools' | t"><span class="material-symbols-rounded">arrow_back</span></a><h1 class="page-title">{{ 'Map' | t }}</h1><span class="spacer"></span><span class="campus-name">{{ 'WLSA Shanghai' | t }}</span></header>
      <section class="surface map-card"><app-campus-map-panel [selectedBuilding]="selectedBuilding()" (buildingSelected)="selectedBuilding.set($event)" /></section>
    </div>
  `,
  styles: `
    .map-page { width: min(100%, 1480px); } .page-header { justify-content: flex-start; } .back { margin-left: -10px; color: var(--app-text); text-decoration: none; }
    .campus-name { color: var(--app-muted); font-size: 13px; } .map-card { padding: 16px; } @media (max-width: 600px) { .map-card { padding: 10px; } }
  `,
})
export class MapPage {
  readonly selectedBuilding = signal<number | null>(null);
}
