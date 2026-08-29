import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.org.wlsash.wlsaplus',
  appName: 'WLSAPlus',
  webDir: 'dist/wlsaplus/browser',
  server: { androidScheme: 'https' },
  plugins: {
    CapacitorHttp: { enabled: true },
    SecureStorage: { group: 'wlsaplus' },
  },
};

export default config;
