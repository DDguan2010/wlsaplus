import type { Routes } from '@angular/router';
import { ConnectPage } from './pages/connect.page';
import { HomePage } from './pages/home.page';
import { SchedulePage } from './pages/schedule.page';
import { SettingsPage } from './pages/settings.page';
import { ShellComponent } from './shell/shell.component';
import { WidgetPage } from './pages/widget.page';
import { ToolsPage } from './pages/tools.page';
import { TranslatorPage } from './pages/translator.page';
import { VpnPage } from './pages/vpn.page';

export const routes: Routes = [
  { path: 'connect', component: ConnectPage },
  { path: 'widget/:type', component: WidgetPage },
  {
    path: '', component: ShellComponent, children: [
      { path: '', component: HomePage },
      { path: 'schedule', component: SchedulePage },
      { path: 'tools/vpn', component: VpnPage },
      { path: 'tools/translate', component: TranslatorPage },
      { path: 'tools', component: ToolsPage },
      { path: 'settings', component: SettingsPage },
    ],
  },
  { path: '**', redirectTo: '' },
];
