import { Component, Directive, computed, inject, input, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { buildingFromRoom } from '../core/campus-map';
import { CampusMapPanelComponent } from './campus-map-panel.component';

@Component({
  selector: 'app-room-map-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogClose, CampusMapPanelComponent],
  template: `
    <header><h2 mat-dialog-title>Room {{ data.room }}</h2><button type="button" mat-dialog-close aria-label="Close map"><span class="material-symbols-rounded">close</span></button></header>
    <mat-dialog-content><app-campus-map-panel [selectedBuilding]="selectedBuilding()" (buildingSelected)="selectedBuilding.set($event)" /></mat-dialog-content>
  `,
  styles: `
    :host { display: block; background: var(--app-surface); color: var(--app-text); }
    header { display: flex; align-items: center; gap: 12px; padding-right: 12px; } h2 { flex: 1; overflow-wrap: anywhere; color: var(--app-text); font-size: 20px; }
    header button { flex: 0 0 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--app-text); cursor: pointer; }
    header button:hover { background: var(--app-surface-raised); } header button:focus-visible { outline: 2px solid var(--app-accent); }
    mat-dialog-content { padding: 0 18px 20px !important; max-height: calc(100dvh - 105px); }
  `,
})
export class RoomMapDialogComponent {
  readonly data = inject<{ room: string; building: number }>(MAT_DIALOG_DATA);
  readonly selectedBuilding = signal(this.data.building);
}

@Directive({
  selector: 'button[appRoomMap]',
  host: {
    'type': 'button',
    'class': 'room-map-trigger',
    '[disabled]': 'building() === null',
    '[attr.aria-label]': 'building() ? "Show room " + room() + " in Building " + building() + " on map" : null',
    '[attr.aria-haspopup]': 'building() ? "dialog" : null',
    '(click)': 'open($event)',
  },
})
export class RoomMapDirective {
  readonly room = input<string | null | undefined>(null, { alias: 'appRoomMap' });
  readonly building = computed(() => buildingFromRoom(this.room()));
  private readonly dialog = inject(MatDialog);

  open(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const building = this.building();
    if (building === null) return;
    this.dialog.open(RoomMapDialogComponent, {
      data: { room: this.room(), building }, width: '780px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)',
      autoFocus: 'button[aria-label="Close map"]', restoreFocus: true,
    });
  }
}
