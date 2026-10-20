import { I18nService, TranslatePipe } from '../core/i18n.service';
import { inject, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { CAMPUS_BUILDINGS, campusBuilding } from '../core/campus-map';
import { CampusMapComponent } from './campus-map.component';

@Component({
  selector: 'app-campus-map-panel',
  imports: [TranslatePipe, CampusMapComponent],
  template: `
    <div class="map-toolbar">
      <span>{{ 'Tap a building to see its details' | t }}</span>
      <div class="zoom-controls" [attr.aria-label]="'Map zoom' | t">
        <button type="button" (click)="setZoom(zoom() - .5)" [disabled]="zoom() <= 1" [attr.aria-label]="'Zoom map out' | t"><span class="material-symbols-rounded">remove</span></button>
        <button class="fit" type="button" (click)="setZoom(1)" [attr.aria-label]="'Show whole campus' | t">{{ zoom() === 1 ? ('Fit' | t) : (zoom() * 100) + '%' }}</button>
        <button type="button" (click)="setZoom(zoom() + .5)" [disabled]="zoom() >= 4" [attr.aria-label]="'Zoom map in' | t"><span class="material-symbols-rounded">add</span></button>
      </div>
    </div>
    <div class="map-viewport" #viewport tabindex="0" [attr.aria-label]="'Campus map. Zoom in for detail, then scroll or swipe to move.' | t">
      <app-campus-map [style.width.%]="zoom() * 100" [highlightedBuilding]="selectedBuilding()" (buildingSelected)="buildingSelected.emit($event)" />
    </div>
    <div class="building-picker" [attr.aria-label]="'Select a campus building' | t">
      @for (building of buildings; track building.id) {
        <button type="button" [class.selected]="selectedBuilding() === building.id" [attr.aria-pressed]="selectedBuilding() === building.id" [attr.aria-label]="'Building {number}: {name}' | t:{number: building.id, name: (building.name | t)}" (click)="select(building.id)">{{ building.id }}</button>
      }
    </div>
    @if (selected(); as building) {
      <div class="building-detail" aria-live="polite">
        <span class="detail-number">{{ building.id }}</span>
        <div><strong>{{ 'Building {p0} · {p1}' | t:{p0: building.id, p1: (building.name | t)} }}</strong>@if (i18n.language() === 'en') { <span class="chinese">{{ building.chinese }}</span> }<p>{{ building.details | t }}</p></div>
      </div>
    } @else {
      <p class="map-hint">{{ 'Find a classroom by its first digit: 5218 is in Building 5. Zoom in to read the smaller labels.' | t }}</p>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .map-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--app-muted); font-size: 12px; }
    .zoom-controls { display: flex; align-items: center; flex-shrink: 0; border: 1px solid var(--app-border); border-radius: 7px; }
    .zoom-controls button { display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; background: transparent; color: var(--app-text); cursor: pointer; font: inherit; }
    .zoom-controls .fit { width: 48px; font-variant-numeric: tabular-nums; } .zoom-controls .material-symbols-rounded { font-size: 20px; }
    button:disabled { opacity: .35; cursor: default; } button:focus-visible, .map-viewport:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 2px; }
    .map-viewport { width: 100%; max-height: min(62dvh, 660px); overflow: auto; overscroll-behavior: contain; border: 1px solid var(--app-border); border-radius: 8px; background: #f8f5ee; scrollbar-width: thin; }
    app-campus-map { display: block; min-width: 100%; }
    .building-picker { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 5px; margin-top: 12px; }
    .building-picker button { min-width: 0; min-height: 40px; padding: 0; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface); color: var(--app-text); cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; }
    .building-picker button:hover { background: var(--app-surface-raised); } .building-picker .selected { border-color: #a45b0d; background: #ffdf89; color: #50330c; }
    .building-detail { display: flex; gap: 12px; margin-top: 14px; font-size: 14px; } .detail-number { display: grid; place-items: center; flex: 0 0 36px; height: 36px; border-radius: 50%; background: #ffdf89; color: #50330c; font-weight: 700; }
    .building-detail strong { display: block; line-height: 1.4; } .chinese { display: block; margin-top: 2px; color: var(--app-muted); font-size: 12px; }
    .building-detail p, .map-hint { margin: 8px 0 0; color: var(--app-muted); font-size: 12px; line-height: 1.6; }
    @media (max-width: 600px) { .building-picker { grid-template-columns: repeat(6, minmax(0, 1fr)); } .building-picker button { min-height: 42px; } }
  `,
})
export class CampusMapPanelComponent {
  readonly i18n = inject(I18nService);
  readonly selectedBuilding = input<number | null>(null);
  readonly buildingSelected = output<number>();
  readonly buildings = CAMPUS_BUILDINGS;
  readonly selected = computed(() => campusBuilding(this.selectedBuilding()));
  readonly zoom = signal(1);
  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');

  setZoom(value: number): void {
    const viewport = this.viewport()?.nativeElement;
    if (!viewport) return;
    const building = this.selected();
    const x = building ? building.x / 1700 : (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth;
    const y = building ? (building.y - 160) / 800 : (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight;
    this.zoom.set(Math.max(1, Math.min(4, value)));
    requestAnimationFrame(() => viewport.scrollTo({ left: x * viewport.scrollWidth - viewport.clientWidth / 2, top: y * viewport.scrollHeight - viewport.clientHeight / 2 }));
  }

  select(id: number): void {
    this.buildingSelected.emit(id);
    if (this.zoom() > 1) requestAnimationFrame(() => this.setZoom(this.zoom()));
  }
}
