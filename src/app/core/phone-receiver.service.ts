import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { inject } from '@angular/core';

const tools = registerPlugin<{ openPhoneReceiver(): Promise<void> }>('WlsaTools');

@Injectable({ providedIn: 'root' })
export class PhoneReceiverService {
  private readonly snack = inject(MatSnackBar);
  async open(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    try { await tools.openPhoneReceiver(); }
    catch { this.snack.open('Could not open the phone connection. Update the Android app and try again.', 'Dismiss', { duration: 7000 }); }
  }
}
