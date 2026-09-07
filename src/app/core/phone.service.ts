import { Injectable, signal } from '@angular/core';
import type { PhoneControlAction, PhoneStatus, PhoneNetworkStatus } from './models';

const UNSUPPORTED: PhoneStatus = {
  state: 'unsupported',
  message: 'Phone control is available in the Windows desktop app.',
  deviceName: null,
  serial: null,
  ip: null,
  androidVersion: null,
  audioAvailable: null,
  screenOff: true,
};

@Injectable({ providedIn: 'root' })
export class PhoneService {
  readonly status = signal<PhoneStatus>(UNSUPPORTED);
  readonly network = signal<PhoneNetworkStatus>({ state: 'stopped', active: 0 });

  constructor() {
    if (!window.wlsaplus) return;
    void window.wlsaplus.phone.status().then((status) => this.status.set(status));
    window.wlsaplus.phone.onStatus((status) => this.status.set(status));
    void window.wlsaplus.phone.networkStatus().then(status => this.network.set(status)).catch(() => {});
    window.wlsaplus.phone.onNetworkStatus(status => this.network.set(status));
  }

  async connect(turnScreenOff: boolean): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.phone.connect({ turnScreenOff }));
  }

  async start(turnScreenOff: boolean): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.phone.start({ turnScreenOff }));
  }

  async stop(): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.phone.stop());
  }

  async disconnect(): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.phone.disconnect());
  }

  async control(action: PhoneControlAction): Promise<void> {
    if (window.wlsaplus) this.status.set(await window.wlsaplus.phone.control(action));
  }

}
