import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { PlatformHttpResponse, PlatformInfo } from './models';

export const WEB_POWERSCHOOL_ORIGIN = 'https://ps.wlsash.org.cn';
export const WEB_POWERSCHOOL_GATEWAY = 'https://apiwlsaplus.02studio.xyz';

export interface NativeRequest {
  baseUrl: string;
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly info: PlatformInfo = this.detect();

  async request(options: NativeRequest): Promise<PlatformHttpResponse> {
    if (window.wlsaplus) return window.wlsaplus.powerschool.request(options);

    if (Capacitor.isNativePlatform()) {
      const url = new URL(options.path, options.baseUrl).toString();
      const response = await CapacitorHttp.request({
        url,
        method: options.method,
        headers: options.headers,
        data: options.body,
        responseType: 'text',
        webFetchExtra: { credentials: 'include' },
      });
      return { status: response.status, url: response.url, text: String(response.data ?? '') };
    }

    const url = this.webGatewayUrl(options);
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      credentials: 'include',
      redirect: 'follow',
    });
    return { status: response.status, url: response.url, text: await response.text() };
  }

  async clearSession(baseUrl: string): Promise<void> {
    if (window.wlsaplus) {
      await window.wlsaplus.powerschool.clearSession(baseUrl);
      return;
    }
    if (Capacitor.isNativePlatform()) return;

    this.assertWebPowerSchoolOrigin(baseUrl);
    const response = await fetch(`${WEB_POWERSCHOOL_GATEWAY}/api/powerschool/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new Error(await this.gatewayError(response));
  }

  private detect(): PlatformInfo {
    if (window.wlsaplus) {
      const os = window.wlsaplus.platform.os;
      return { kind: 'electron', os, supportsPowerSchool: true, supportsDesktopCards: os === 'windows', supportsVpn: os === 'windows' || os === 'macos', supportsScreenTranslation: os === 'windows' };
    }
    if (Capacitor.isNativePlatform()) {
      return { kind: 'android', os: 'android', supportsPowerSchool: true, supportsDesktopCards: false, supportsVpn: true, supportsScreenTranslation: false };
    }
    return { kind: 'web', os: 'web', supportsPowerSchool: true, supportsDesktopCards: false, supportsVpn: false, supportsScreenTranslation: false };
  }

  private webGatewayUrl(options: NativeRequest): string {
    this.assertWebPowerSchoolOrigin(options.baseUrl);
    const upstreamUrl = new URL(options.path, `${WEB_POWERSCHOOL_ORIGIN}/`);
    if (upstreamUrl.origin !== WEB_POWERSCHOOL_ORIGIN) {
      throw new Error('The web version cannot request a different PowerSchool server.');
    }

    const gatewayUrl = new URL(`/api/powerschool${upstreamUrl.pathname}`, WEB_POWERSCHOOL_GATEWAY);
    gatewayUrl.search = upstreamUrl.search;
    return gatewayUrl.toString();
  }

  private assertWebPowerSchoolOrigin(baseUrl: string): void {
    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      throw new Error('Enter a valid PowerSchool address.');
    }
    if (origin !== WEB_POWERSCHOOL_ORIGIN) {
      throw new Error(`The web version supports only ${WEB_POWERSCHOOL_ORIGIN}.`);
    }
  }

  private async gatewayError(response: Response): Promise<string> {
    try {
      const value = await response.json() as { error?: unknown };
      if (typeof value.error === 'string' && value.error.trim()) return value.error;
    } catch {
      // Fall back to the HTTP status below.
    }
    return `PowerSchool gateway returned HTTP ${response.status}.`;
  }
}
