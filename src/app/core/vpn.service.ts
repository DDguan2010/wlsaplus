import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';
import { WlsaTools } from './native-tools';
import type { VpnConnectionMode, VpnStatus } from './models';

const SUBSCRIPTION_URL = 'https://vpn.02studio.xyz/api/subscribe?format=clash';
const IDLE: VpnStatus = { state: 'idle', message: 'Ready', connectedAt: null, mode: 'unavailable' };

@Injectable({ providedIn: 'root' })
export class VpnService {
  private readonly platform = inject(PlatformService);
  readonly status = signal<VpnStatus>(this.platform.info.supportsVpn ? IDLE : { ...IDLE, state: 'unavailable', message: 'Available in the desktop and Android apps.' });
  readonly mode = signal<VpnConnectionMode>(this.readMode());

  constructor() {
    if (window.wlsaplus) {
      void window.wlsaplus.vpn.status().then((status) => this.applyStatus(status));
      window.wlsaplus.vpn.onStatus((status) => this.applyStatus(status));
    } else if (this.platform.info.kind === 'android') {
      this.status.set({ ...IDLE, mode: 'external-client', message: 'Ready to open a compatible VPN client.' });
    }
  }

  async connect(): Promise<void> {
    if (window.wlsaplus) {
      this.status.set({ ...this.status(), state: 'connecting', message: 'Connecting to 02VPN...', mode: this.mode(), requiresElevation: false });
      try {
        this.applyStatus(await window.wlsaplus.vpn.connect(this.mode()));
      } catch (error) {
        this.status.set({
          ...this.status(),
          state: 'error',
          message: error instanceof Error ? error.message : 'Could not request administrator access.',
          requiresElevation: this.mode() === 'full-tunnel',
        });
      }
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
    this.applyStatus(await window.wlsaplus.vpn.disconnect());
  }

  setMode(mode: VpnConnectionMode): void {
    this.mode.set(mode);
    localStorage.setItem('wlsaplus:vpn-mode', mode);
  }

  async restartElevated(): Promise<void> {
    if (!window.wlsaplus) return;
    this.status.set({ ...this.status(), state: 'connecting', message: 'Requesting administrator access...', mode: this.mode(), requiresElevation: false });
    try {
      this.applyStatus(await window.wlsaplus.vpn.restartElevated(this.mode()));
    } catch (error) {
      this.status.set({ ...this.status(), state: 'error', message: error instanceof Error ? error.message : 'Could not restart with administrator access.', requiresElevation: true });
    }
  }

  private applyStatus(status: VpnStatus): void {
    this.status.set(status);
    if (status.state !== 'idle' && (status.mode === 'system-proxy' || status.mode === 'full-tunnel')) this.mode.set(status.mode);
  }

  private readMode(): VpnConnectionMode {
    if (this.platform.info.os !== 'windows') return 'system-proxy';
    return localStorage.getItem('wlsaplus:vpn-mode') === 'full-tunnel' ? 'full-tunnel' : 'system-proxy';
  }
}
