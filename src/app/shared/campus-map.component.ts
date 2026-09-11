import { Component, input, output } from '@angular/core';

export interface CampusBuilding {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate?: number;
}

export function buildingFromRoom(room: string | null | undefined): number | null {
  const value = String(room ?? '').trim();
  if (!value) return null;
  const compact = value.replace(/\s+/g, '');
  const firstTwo = compact.match(/^(10|11|12)(?:\D|$)/);
  if (firstTwo) return Number(firstTwo[1]);
  const first = compact.match(/^([1-9])(?:\D|$)/);
  if (first) return Number(first[1]);
  const leading = compact.match(/^([1-9])/);
  return leading ? Number(leading[1]) : null;
}

@Component({
  selector: 'app-campus-map',
  template: `
    <div class="map-wrap">
      <svg class="campus-map" viewBox="0 0 1200 700" role="img" aria-labelledby="campus-map-title campus-map-desc">
        <title id="campus-map-title">WLSA Shanghai campus map</title>
        <desc id="campus-map-desc">A simplified campus map with buildings numbered 1 through 12. The selected building is highlighted.</desc>
        <rect class="ground" x="0" y="0" width="1200" height="700" rx="18" />
        <path class="road" d="M0 650H1200" /><text class="road-label" x="32" y="680">Tongji Road</text>
        <path class="road vertical" d="M572 110V650" /><text class="road-label vertical-label" x="586" y="420" transform="rotate(-90 586 420)">Qinggang Road</text>
        <rect class="lawn" x="28" y="42" width="310" height="162" rx="14" /><rect class="field" x="56" y="68" width="254" height="110" rx="10" /><path class="field-line" d="M183 68v110M56 123h254" />
        <rect class="lawn" x="830" y="314" width="314" height="248" rx="14" /><rect class="field" x="850" y="337" width="132" height="94" rx="8" /><rect class="field" x="995" y="337" width="132" height="94" rx="8" /><rect class="field" x="850" y="449" width="277" height="92" rx="8" /><path class="field-line" d="M916 337v94M1061 337v94M989 449v92" />
        <text class="campus-label" x="1010" y="594">WLSA SHANGHAI ACADEMY</text>
        @for (building of buildings; track building.id) {
          <g class="building" [class.highlighted]="highlightedBuilding() === building.id" [attr.transform]="buildingTransform(building)" tabindex="0" role="button" [attr.aria-label]="'Building ' + building.id + ': ' + building.name" (click)="buildingSelected.emit(building.id)" (keydown.enter)="buildingSelected.emit(building.id)" (keydown.space)="buildingSelected.emit(building.id); $event.preventDefault()">
            <rect [attr.width]="building.width" [attr.height]="building.height" rx="8" />
            <circle [attr.cx]="building.width / 2" [attr.cy]="building.height / 2 - 7" r="22" />
            <text class="building-number" [attr.x]="building.width / 2" [attr.y]="building.height / 2 + 1">{{ building.id }}</text>
            <text class="building-name" [attr.x]="building.width / 2" [attr.y]="building.height / 2 + 28">{{ building.name }}</text>
          </g>
        }
      </svg>
      <p class="map-help">Tap a building to highlight it. Room numbers start with the building number, such as 3F 4000 → Building 3.</p>
    </div>
  `,
  styles: `
    :host { display: block; } .map-wrap { display: grid; gap: 10px; } .campus-map { width: 100%; height: auto; display: block; border: 1px solid var(--app-border); border-radius: 12px; background: #dbe8dc; } .ground { fill: #e7eee5; } .road { fill: none; stroke: #6d6b6a; stroke-width: 46; } .road.vertical { stroke-width: 28; } .road-label { fill: #eeeae4; font: 600 17px sans-serif; letter-spacing: 2px; } .vertical-label { letter-spacing: 1px; } .lawn { fill: #b8d3ae; stroke: #78a275; stroke-width: 2; } .field { fill: #4e8f54; stroke: #e5f0dc; stroke-width: 3; } .field-line { fill: none; stroke: #e5f0dc; stroke-width: 2; opacity: .8; } .campus-label { fill: #6d6b6a; font: 600 14px sans-serif; letter-spacing: 2px; } .building { cursor: pointer; outline: none; } .building rect { fill: #ead8c2; stroke: #b39b83; stroke-width: 2; transition: fill 120ms ease, stroke 120ms ease, filter 120ms ease; } .building circle { fill: #263f59; stroke: #fff; stroke-width: 3; } .building-number { fill: #fff; font: 700 22px sans-serif; text-anchor: middle; } .building-name { fill: #5b5148; font: 600 12px sans-serif; text-anchor: middle; } .building.highlighted rect { fill: #f2c45c; stroke: #9a5b12; stroke-width: 5; filter: drop-shadow(0 4px 4px rgb(50 40 20 / 28%)); } .building.highlighted circle { fill: var(--app-accent); } .building:focus-visible rect { stroke: var(--app-accent); stroke-width: 5; } .map-help { margin: 0; color: var(--app-muted); font-size: 13px; line-height: 1.45; }
    @media (max-width: 650px) { .campus-map { min-height: 300px; object-fit: contain; } .building-name { font-size: 10px; } }
  `,
})
export class CampusMapComponent {
  readonly highlightedBuilding = input<number | null>(null);
  readonly buildingSelected = output<number>();
  readonly buildings: CampusBuilding[] = [
    { id: 9, name: 'Teaching', x: 40, y: 30, width: 130, height: 175 },
    { id: 8, name: 'Dormitory', x: 190, y: 30, width: 110, height: 175 },
    { id: 7, name: 'Dormitory', x: 320, y: 30, width: 92, height: 175 },
    { id: 12, name: 'Teaching', x: 40, y: 245, width: 118, height: 270 },
    { id: 11, name: 'Classroom', x: 190, y: 270, width: 110, height: 230 },
    { id: 10, name: 'Dining', x: 330, y: 295, width: 100, height: 180 },
    { id: 4, name: 'Arts', x: 626, y: 32, width: 155, height: 112 },
    { id: 1, name: 'Sports Hall', x: 610, y: 172, width: 210, height: 245 },
    { id: 2, name: 'Cloud Library', x: 620, y: 452, width: 170, height: 112 },
    { id: 3, name: 'Teaching', x: 850, y: 30, width: 135, height: 112 },
    { id: 6, name: 'Teaching', x: 1010, y: 30, width: 145, height: 175 },
    { id: 5, name: 'Teaching', x: 1010, y: 220, width: 145, height: 160 },
  ];
  buildingTransform(building: CampusBuilding): string { return `translate(${building.x} ${building.y}) rotate(${building.rotate ?? 0} ${building.width / 2} ${building.height / 2})`; }
}
