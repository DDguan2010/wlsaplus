export type ThemeMode = 'system' | 'light' | 'dark';
export type DesktopCardType = 'current-class' | 'next-class' | 'today' | 'todo';

export interface PowerSchoolCredentials {
  schoolUrl: string;
  username: string;
  password: string;
}

export interface Course {
  id: string;
  name: string;
  sectionNumber: string;
  teacher: string;
  room: string;
  meetingPattern: string;
}

export interface ClassSession {
  id: string;
  courseId: string | null;
  courseName: string;
  teacher: string;
  room: string;
  startsAt: string;
  endsAt: string;
}

export interface ScheduleSnapshot {
  syncedAt: string;
  weekStart: string;
  weekEnd: string;
  sessions: ClassSession[];
  courses: Course[];
}

export interface TodoItem {
  id: string;
  title: string;
  details: string;
  createdAt: string;
}

export interface AppSettings {
  theme: ThemeMode;
  tuningEnabled: boolean;
  tunedTime: string | null;
}

export interface PlatformInfo {
  kind: 'web' | 'android' | 'electron';
  os: 'web' | 'android' | 'windows' | 'macos' | 'linux';
  supportsPowerSchool: boolean;
  supportsDesktopCards: boolean;
  supportsVpn: boolean;
  supportsScreenTranslation: boolean;
}

export type VpnConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'delegated' | 'error' | 'unavailable';
export type VpnConnectionMode = 'system-proxy' | 'full-tunnel';

export interface VpnStatus {
  state: VpnConnectionState;
  message: string;
  connectedAt: string | null;
  mode: VpnConnectionMode | 'external-client' | 'unavailable';
  requiresElevation?: boolean;
}

export interface TranslationResult {
  text: string;
  detectedLanguage: string;
}

export interface PlatformHttpResponse {
  status: number;
  url: string;
  text: string;
}

export interface DesktopCardInfo {
  id: number;
  type: DesktopCardType;
}

export interface DesktopCardSettings {
  launchAtStartup: boolean;
}
