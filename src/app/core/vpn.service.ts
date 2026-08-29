import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';
import { WlsaTools } from './native-tools';
import type { VpnStatus } from './models';

const SUBSCRIPTION_URL = 'https://vpn.02studio.xyz/api/subscribe?format=clash';
const IDLE: VpnStatus = { state: 'idle', message: 'Ready', connectedAt: null, mode: 'unavailable' };

@Injectable({ providedIn: 'root' })
export class VpnService {
  private readonly platform = inject(PlatformService);
  readonly status = signal<VpnStatus>(this.platform.info.supportsVpn ? IDLE : { ...IDLE, state: 'unavailable', message: 'Available in the desktop and Android apps.' });

  constructor() {
    if (window.wlsaplus) {
      void window.wlsaplus.vpn.status().then((status) => this.status.set(status));
      window.wlsaplus.vpn.onStatus((status) => this.status.set(status));
    } else if (this.platform.info.kind === 'android') {
      this.status.set({ ...IDLE, mode: 'external-client', message: 'Ready to open a compatible VPN client.' });
    }
  }

  async connect(): Promise<void> {
    if (window.wlsaplus) {
      this.status.set({ ...this.status(), state: 'connecting', message: 'Connecting to 02VPN...' });
      this.status.set(await window.wlsaplus.vpn.connect());
      return;
    }
    if (this.platform.info.kind === 'android') {
      this.status.set({ ...this.status(), state: 'connecting', message: 'Opening VPN client...' });
      try {
        await WlsaTools.importVpn({ url: SUBSCRIPTION_URL, name: '02VPN' });
        this.status.set({ state: 'delegated', message: '02VPN opened in your VPN client.', connectedAt: null, mode: 'external-client' });
      } catch (error) {
        this.status.set({ state: 'error', message: error instanceof Error ? error.message : 'No compatible VPN client is installed.', connectedAt: null, mode: 'external-client' });
      }
    }
  }

  async disconnect(): Promise<void> {
    if (!window.wlsaplus) return;
    this.status.set({ ...this.status(), state: 'disconnecting', message: 'Disconnecting...' });
    this.status.set(await window.wlsaplus.vpn.disconnect());
  }
}
