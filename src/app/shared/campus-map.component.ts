import { Component, input, output } from '@angular/core';
import { campusBuilding } from '../core/campus-map';

@Component({
  selector: 'app-campus-map',
  templateUrl: './campus-map.svg',
  styleUrl: './campus-map.component.css',
  host: {
    '[attr.data-selected-building]': 'highlightedBuilding()',
    '(click)': 'selectFromEvent($event)',
    '(keydown)': 'selectFromKeyboard($event)',
  },
})
export class CampusMapComponent {
  readonly highlightedBuilding = input<number | null>(null);
  readonly buildingSelected = output<number>();

  selectFromEvent(event: Event): void {
    const element = event.target instanceof Element ? event.target.closest('[data-building]') : null;
    const building = campusBuilding(Number(element?.getAttribute('data-building')));
    if (building) this.buildingSelected.emit(building.id);
  }

  selectFromKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.selectFromEvent(event);
  }
}
