import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { PlatformHttpResponse, PlatformInfo } from './models';

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

    const url = new URL(options.path, options.baseUrl).toString();
    if (Capacitor.isNativePlatform()) {
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
    if (window.wlsaplus) await window.wlsaplus.powerschool.clearSession(baseUrl);
  }

  private detect(): PlatformInfo {
    if (window.wlsaplus) {
      const os = window.wlsaplus.platform.os;
      return { kind: 'electron', os, supportsPowerSchool: true, supportsDesktopCards: os === 'windows', supportsVpn: os === 'windows' || os === 'macos', supportsScreenTranslation: os === 'windows' };
    }
    if (Capacitor.isNativePlatform()) {
      return { kind: 'android', os: 'android', supportsPowerSchool: true, supportsDesktopCards: false, supportsVpn: true, supportsScreenTranslation: false };
    }
    return { kind: 'web', os: 'web', supportsPowerSchool: false, supportsDesktopCards: false, supportsVpn: false, supportsScreenTranslation: false };
  }
}
