import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { inject } from '@angular/core';
import { I18nService } from './i18n.service';

const tools = registerPlugin<{ openPhoneReceiver(): Promise<void> }>('WlsaTools');

@Injectable({ providedIn: 'root' })
export class PhoneReceiverService {
  private readonly snack = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  async open(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    try { await tools.openPhoneReceiver(); }
    catch { this.snack.open(this.i18n.t('Could not open the phone connection. Update the Android app and try again.'), this.i18n.t('Dismiss'), { duration: 7000 }); }
  }
}
