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
        <desc id="campus-map-desc">A clean vector redraw of the WLSA Shanghai Academy campus map. Buildings numbered 1 through 12 can be selected and highlighted.</desc>
        <rect class="ground" x="0" y="0" width="1200" height="700" rx="18" />
        <path class="road" d="M0 650H1200" /><text class="road-label" x="26" y="680">同 济 路&nbsp;&nbsp; Tongji Road</text>
        <path class="road vertical" d="M520 0V650" /><text class="road-label vertical-label" x="536" y="430" transform="rotate(-90 536 430)">青 岗 路&nbsp;&nbsp; Qinggang Road</text>
        <path class="walkway" d="M65 224H480M650 224H1138M650 440H1138" />
        <rect class="lawn" x="95" y="28" width="205" height="188" rx="10" /><rect class="field" x="115" y="50" width="165" height="140" rx="7" /><path class="field-line" d="M197 50v140M115 120h165" /><path class="field-line" d="M137 50v140M258 50v140" />
        <rect class="lawn" x="95" y="250" width="202" height="365" rx="12" /><rect class="track" x="114" y="272" width="166" height="321" rx="82" /><rect class="field football" x="135" y="320" width="124" height="225" rx="6" /><path class="field-line" d="M197 320v225M135 432h124M135 344h124M135 520h124" /><circle class="field-mark" cx="197" cy="432" r="24" />
        <rect class="lawn" x="730" y="285" width="350" height="330" rx="12" /><rect class="field" x="750" y="305" width="145" height="108" rx="6" /><rect class="field" x="915" y="305" width="145" height="108" rx="6" /><rect class="field football" x="750" y="440" width="310" height="142" rx="6" /><path class="field-line" d="M822 305v108M987 305v108M750 359h145M915 359h145M905 440v142M750 470h310M750 552h310" /><circle class="field-mark" cx="905" cy="511" r="22" />
        <g class="academy-mark" aria-hidden="true"><circle cx="914" cy="110" r="35" /><circle cx="914" cy="110" r="27" /><text x="914" y="105">WLSA</text><text x="914" y="120">上海</text></g><text class="academy-title" x="970" y="98">WLSA 上海学校</text><text class="academy-subtitle" x="970" y="119">WLSA SHANGHAI ACADEMY</text>
        <g class="north" aria-hidden="true"><text x="1150" y="30">N</text><path d="M1150 38l-10 35 10-6 10 6z" /></g>
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
    :host { display: block; } .map-wrap { display: grid; gap: 10px; } .campus-map { width: 100%; height: auto; display: block; border: 1px solid var(--app-border); border-radius: 12px; background: #d9e7d7; } .ground { fill: #edf1e8; } .road { fill: none; stroke: #656463; stroke-width: 54; } .road.vertical { stroke-width: 32; } .road-label { fill: #eeeae4; font: 600 15px sans-serif; letter-spacing: 1px; } .vertical-label { letter-spacing: 2px; } .walkway { fill: none; stroke: #789b70; stroke-width: 7; stroke-dasharray: 2 8; opacity: .7; } .lawn { fill: #b9d5ae; stroke: #7ca274; stroke-width: 2; } .field { fill: #4c8b52; stroke: #e6f1df; stroke-width: 3; } .track { fill: #5f9855; stroke: #e6f1df; stroke-width: 8; } .field-line { fill: none; stroke: #e6f1df; stroke-width: 2; opacity: .85; } .field-mark { fill: none; stroke: #e6f1df; stroke-width: 2; } .academy-mark circle { fill: #fff; stroke: #67736f; stroke-width: 2; } .academy-mark text { fill: #4c5b59; font: 700 8px sans-serif; text-anchor: middle; } .academy-title { fill: #626965; font: 600 21px sans-serif; } .academy-subtitle { fill: #777d79; font: 11px sans-serif; letter-spacing: 1px; } .north text { fill: #53605b; font: 700 14px sans-serif; text-anchor: middle; } .north path { fill: #53605b; } .building { cursor: pointer; outline: none; } .building rect { fill: #ead8c2; stroke: #b39b83; stroke-width: 2; transition: fill 120ms ease, stroke 120ms ease, filter 120ms ease; } .building circle { fill: #263f59; stroke: #fff; stroke-width: 3; } .building-number { fill: #fff; font: 700 22px sans-serif; text-anchor: middle; } .building-name { fill: #5b5148; font: 600 11px sans-serif; text-anchor: middle; } .building.highlighted rect { fill: #f2c45c; stroke: #9a5b12; stroke-width: 5; filter: drop-shadow(0 4px 4px rgb(50 40 20 / 28%)); } .building.highlighted circle { fill: var(--app-accent); } .building:focus-visible rect { stroke: var(--app-accent); stroke-width: 5; } .map-help { margin: 0; color: var(--app-muted); font-size: 13px; line-height: 1.45; }
    @media (max-width: 650px) { .campus-map { min-height: 300px; object-fit: contain; } .building-name { font-size: 10px; } }
  `,
})
export class CampusMapComponent {
  readonly highlightedBuilding = input<number | null>(null);
  readonly buildingSelected = output<number>();
  readonly buildings: CampusBuilding[] = [
    { id: 9, name: 'Teaching Building', x: 18, y: 35, width: 67, height: 180 },
    { id: 8, name: 'Boys Dormitory', x: 330, y: 35, width: 82, height: 180 },
    { id: 7, name: 'Girls Dormitory', x: 445, y: 35, width: 82, height: 180 },
    { id: 12, name: 'Teaching Building', x: 18, y: 260, width: 67, height: 345 },
    { id: 11, name: 'Classroom', x: 330, y: 430, width: 82, height: 185 },
    { id: 10, name: 'Dining Hall', x: 445, y: 430, width: 82, height: 185 },
    { id: 4, name: 'Arts Building', x: 552, y: 45, width: 78, height: 170 },
    { id: 1, name: 'Sports Hall', x: 650, y: 145, width: 190, height: 290 },
    { id: 2, name: 'Cloud Library', x: 915, y: 430, width: 145, height: 185 },
    { id: 3, name: 'Teaching Building', x: 850, y: 145, width: 175, height: 105 },
    { id: 6, name: 'Teaching Area', x: 1080, y: 45, width: 105, height: 220 },
    { id: 5, name: 'Teaching Area', x: 1080, y: 300, width: 105, height: 315 },
  ];
  buildingTransform(building: CampusBuilding): string { return `translate(${building.x} ${building.y}) rotate(${building.rotate ?? 0} ${building.width / 2} ${building.height / 2})`; }
}
