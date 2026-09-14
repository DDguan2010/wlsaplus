import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';
import { WlsaTools } from './native-tools';
import type { VpnConnectionMode, VpnStatus } from './models';
import { VPN_SOURCES, vpnSource } from './vpn-sources';

const IDLE: VpnStatus = { state: 'idle', message: 'Ready', connectedAt: null, mode: 'unavailable' };

@Injectable({ providedIn: 'root' })
export class VpnService {
  private readonly platform = inject(PlatformService);
  readonly status = signal<VpnStatus>(this.platform.info.supportsVpn ? IDLE : { ...IDLE, state: 'unavailable', message: 'Available in the desktop and Android apps.' });
  readonly mode = signal<VpnConnectionMode>(this.readMode());
  readonly sources = VPN_SOURCES;
  readonly sourceId = signal<string>(this.readSource());

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
      this.status.set({ ...this.status(), state: 'connecting', message: `Connecting to ${vpnSource(this.sourceId()).name}...`, mode: this.mode(), sourceId: this.sourceId(), requiresElevation: false });
      try {
        this.applyStatus(await window.wlsaplus.vpn.connect(this.mode(), this.sourceId()));
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
        const source = vpnSource(this.sourceId());
        const url = `${source.endpoint}?format=clash`;
        await WlsaTools.importVpn({ url, name: source.name });
        this.status.set({ state: 'delegated', message: `${source.name} opened in your VPN client.`, connectedAt: null, mode: 'external-client', sourceId: source.id });
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

  setSource(sourceId: string): void {
    const source = vpnSource(sourceId);
    this.sourceId.set(source.id);
    localStorage.setItem('wlsaplus:vpn-source', source.id);
  }

  async restartElevated(): Promise<void> {
    if (!window.wlsaplus) return;
    this.status.set({ ...this.status(), state: 'connecting', message: 'Requesting administrator access...', mode: this.mode(), requiresElevation: false });
    try {
      this.applyStatus(await window.wlsaplus.vpn.restartElevated(this.mode(), this.sourceId()));
    } catch (error) {
      this.status.set({ ...this.status(), state: 'error', message: error instanceof Error ? error.message : 'Could not restart with administrator access.', requiresElevation: true });
    }
  }

  private applyStatus(status: VpnStatus): void {
    this.status.set(status);
    if (status.state !== 'idle' && status.mode === 'full-tunnel') this.mode.set(status.mode);
  }

  private readMode(): VpnConnectionMode {
    return 'full-tunnel';
  }

  private readSource(): string {
    return vpnSource('relay').id;
  }
}
