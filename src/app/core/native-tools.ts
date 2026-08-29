import { registerPlugin } from '@capacitor/core';

interface WlsaToolsPlugin {
  importVpn(options: { url: string; name: string }): Promise<{ opened: boolean }>;
}

export const WlsaTools = registerPlugin<WlsaToolsPlugin>('WlsaTools');
