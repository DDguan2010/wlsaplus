import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { HomePage } from '../pages/home.page';
import { LocalStore } from '../core/local-store.service';
import { ClockService } from '../core/clock.service';
import { CampusMapComponent } from './campus-map.component';
import { RoomMapDirective, RoomMapDialogComponent } from './room-map.directive';

@Component({ imports: [RoomMapDirective], template: '<button [appRoomMap]="room()">{{ room() }}</button>' })
class RoomHost {
  readonly room = signal('5218');
}

afterEach(() => {
  TestBed.inject(MatDialog).closeAll();
  localStorage.clear();
});

describe('campus room map', () => {
  it('opens a dialog for the room, supports building selection and closes normally', async () => {
    const fixture = TestBed.createComponent(RoomHost);
    await fixture.whenStable();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    trigger.focus();
    trigger.click();
    await fixture.whenStable();
    const ref = TestBed.inject(MatDialog).openDialogs[0];
    expect(ref.componentInstance).toBeInstanceOf(RoomMapDialogComponent);
    expect(ref.componentInstance.selectedBuilding()).toBe(5);
    expect(document.querySelector('app-campus-map')?.getAttribute('data-selected-building')).toBe('5');
    expect(getComputedStyle(document.querySelector('g[data-building="5"] .footprint')!).fill).toBe('rgb(255, 223, 137)');
    const building = document.querySelector('g[data-building="2"]')!;
    building.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(ref.componentInstance.selectedBuilding()).toBe(2);
    expect(getComputedStyle(document.querySelector('g[data-building="2"] .footprint')!).fill).toBe('rgb(255, 223, 137)');
    expect(getComputedStyle(document.querySelector('g[data-building="5"] .footprint')!).fill).not.toBe('rgb(255, 223, 137)');
    const closed = firstValueFrom(ref.afterClosed());
    (document.querySelector('button[aria-label="Close map"]') as HTMLButtonElement).click();
    await closed;
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
  });

  it('leaves unknown locations unavailable instead of highlighting a wrong building', async () => {
    const fixture = TestBed.createComponent(RoomHost);
    fixture.componentInstance.room.set('TBA');
    await fixture.whenStable();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.disabled).toBe(true);
    button.click();
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
  });

  it('opens the home-card room without navigating to the schedule', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ClockService, useValue: { now: signal(new Date('2026-09-14T09:10:00')) } }] });
    const store = TestBed.inject(LocalStore);
    store.schedule.set({ syncedAt: '', weekStart: '', weekEnd: '', courses: [], sessions: [{ id: 'map-test', courseId: 'math', courseName: 'Math', room: '5218', teacher: '', startsAt: '2026-09-14T09:00:00', endsAt: '2026-09-14T09:40:00' }] });
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('.facts button');
    expect(trigger.closest('a')).toBeNull();
    trigger.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/');
    expect(TestBed.inject(MatDialog).openDialogs[0].componentInstance.selectedBuilding()).toBe(5);
  });

  it('exposes all 12 buildings in the actual SVG, including touch and keyboard targets', async () => {
    const fixture = TestBed.createComponent(CampusMapComponent);
    await fixture.whenStable();
    const targets = [...fixture.nativeElement.querySelectorAll('g[data-building]')] as SVGGElement[];
    expect(targets.map((g) => Number(g.dataset['building'])).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(targets.every((g) => g.getAttribute('tabindex') === '0')).toBe(true);
  });
});
