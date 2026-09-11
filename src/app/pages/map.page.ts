import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CampusMapComponent } from '../shared/campus-map.component';

@Component({
  selector: 'app-map-page',
  imports: [CampusMapComponent],
  template: `
    <div class="page">
      <header class="page-header"><div><div class="eyebrow">WLSA Shanghai Academy</div><h1 class="page-title">Campus map</h1></div><button class="close-map" type="button" (click)="back()" aria-label="Back"><span class="material-symbols-rounded">arrow_back</span>Back</button></header>
      @if (selectedBuilding(); as building) { <p class="selected-note"><span class="material-symbols-rounded">location_on</span>Building {{ building }} is highlighted.</p> }
      <section class="surface map-card"><app-campus-map [highlightedBuilding]="selectedBuilding()" (buildingSelected)="selectBuilding($event)" /></section>
      <section class="surface map-legend"><strong>Finding a room</strong><span>The first number in a room identifies its building. For example, 3F 4000 is in Building 3. Select a building on the map to explore the campus.</span></section>
    </div>
  `,
  styles: `
    .eyebrow { margin-bottom: 4px; color: var(--app-muted); font-size: 13px; } .close-map { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface); color: var(--app-text); cursor: pointer; font: inherit; } .close-map:hover { border-color: var(--app-accent); color: var(--app-accent); } .close-map .material-symbols-rounded { font-size: 18px; } .selected-note { display: flex; align-items: center; gap: 7px; margin: 0 0 12px; color: var(--app-accent); font-size: 14px; font-weight: 600; } .selected-note .material-symbols-rounded { font-size: 19px; } .map-card { padding: 14px; } .map-legend { display: grid; gap: 4px; margin-top: 14px; padding: 14px 16px; } .map-legend span { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
    @media (max-width: 650px) { .map-card { padding: 8px; } }
  `,
})
export class MapPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly selectedBuilding = signal<number | null>(this.parseBuilding(this.route.snapshot.queryParamMap.get('building')));
  selectBuilding(building: number): void { this.selectedBuilding.set(building); void this.router.navigate([], { relativeTo: this.route, queryParams: { building }, queryParamsHandling: 'merge', replaceUrl: true }); }
  back(): void { void this.router.navigateByUrl('/tools'); }
  private parseBuilding(value: string | null): number | null { const number = Number(value); return Number.isInteger(number) && number >= 1 && number <= 12 ? number : null; }
}
