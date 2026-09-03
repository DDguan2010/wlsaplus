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
  endAt: string | null;
}

export function normalizeTodoEndAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function todoDeadlineProgress(todo: Pick<TodoItem, 'createdAt' | 'endAt'>, now = Date.now()): number {
  if (!todo.endAt) return 0;
  const start = Date.parse(todo.createdAt);
  const end = Date.parse(todo.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) return now >= end ? 100 : 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
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

export type UpdateState = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'up-to-date' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  message: string;
  currentVersion: string;
  version: string | null;
  percent: number | null;
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
