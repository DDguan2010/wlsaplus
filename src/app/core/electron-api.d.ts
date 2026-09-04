import type {
  DesktopCardInfo,
  DesktopCardType,
  DesktopCardSettings,
  PlatformHttpResponse,
  PhoneControlAction,
  PhoneStatus,
  PowerSchoolCredentials,
  TranslationResult,
  UpdateStatus,
  VpnConnectionMode,
  VpnStatus,
} from './models';

declare global {
  interface Window {
    wlsaplus?: {
      platform: { os: 'windows' | 'macos' | 'linux' };
      credentials: {
        get(): Promise<PowerSchoolCredentials | null>;
        set(value: PowerSchoolCredentials): Promise<void>;
        clear(): Promise<void>;
      };
      powerschool: {
        request(options: {
          baseUrl: string;
          path: string;
          method: 'GET' | 'POST';
          body?: string;
          headers?: Record<string, string>;
          referrerPath?: string;
        }): Promise<PlatformHttpResponse>;
        clearSession(baseUrl: string): Promise<void>;
      };
      desktopCards: {
        list(): Promise<DesktopCardInfo[]>;
        add(type: DesktopCardType): Promise<DesktopCardInfo>;
        remove(id: number): Promise<void>;
        closeAll(): Promise<number>;
        getSettings(): Promise<DesktopCardSettings>;
        setSettings(value: DesktopCardSettings): Promise<void>;
      };
      vpn: {
        status(): Promise<VpnStatus>;
        connect(mode: VpnConnectionMode): Promise<VpnStatus>;
        disconnect(): Promise<VpnStatus>;
        restartElevated(mode: VpnConnectionMode): Promise<VpnStatus>;
        onStatus(callback: (status: VpnStatus) => void): () => void;
      };
      updater: {
        status(): Promise<UpdateStatus>;
        check(): Promise<UpdateStatus>;
        download(): Promise<UpdateStatus>;
        install(): Promise<UpdateStatus>;
        onStatus(callback: (status: UpdateStatus) => void): () => void;
      };
      translator: {
        translate(text: string, source: string, target: string): Promise<TranslationResult>;
        captureRegion(): Promise<string | null>;
      };
      phone: {
        status(): Promise<PhoneStatus>;
        connect(options: { turnScreenOff: boolean }): Promise<PhoneStatus>;
        start(options: { turnScreenOff: boolean }): Promise<PhoneStatus>;
        stop(): Promise<PhoneStatus>;
        disconnect(): Promise<PhoneStatus>;
        control(action: PhoneControlAction): Promise<PhoneStatus>;
        onStatus(callback: (status: PhoneStatus) => void): () => void;
      };
    };
  }
}

export {};
