import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LocalStore } from './core/local-store.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  private readonly store = inject(LocalStore);

  constructor() {
    this.store.applyTheme();
  }
}
