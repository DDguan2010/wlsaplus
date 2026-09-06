import type { ClassSession, TodoColor, TodoItem } from './models';

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOME_TIMELINE_RANGE_MS = 7 * DAY_MS;

export interface HomeTimelineEntry {
  id: string;
  title: string;
  tooltip: string;
  kind: 'schedule' | 'deadline' | 'time';
  left: number;
  width: number;
  color: TodoColor | null;
  colorIndex: number;
  startsAt: number;
  endsAt: number;
}

export interface HomeTimelineLayout {
  startsAt: number;
  endsAt: number;
  ticks: { at: number; left: number }[];
  scheduleLanes: HomeTimelineEntry[][];
  deadlineLanes: HomeTimelineEntry[][];
  timeLanes: HomeTimelineEntry[][];
}

export function buildHomeTimeline(sessions: ClassSession[], todos: TodoItem[], now: number): HomeTimelineLayout {
  const endsAt = now + HOME_TIMELINE_RANGE_MS;
  const position = (value: number) => (value - now) / HOME_TIMELINE_RANGE_MS * 100;
  const scheduleEntries = sessions.flatMap((session): HomeTimelineEntry[] => {
    const sourceStart = Date.parse(session.startsAt);
    const sourceEnd = Date.parse(session.endsAt);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= now || sourceStart >= endsAt) return [];
    const startsAt = Math.max(now, sourceStart);
    const clippedEnd = Math.min(endsAt, sourceEnd);
    return [{
      id: `schedule-${session.id}`,
      title: session.courseName,
      tooltip: joinDetails(session.courseName, formatRange(sourceStart, sourceEnd), session.teacher, session.room),
      kind: 'schedule',
      left: position(startsAt),
      width: position(clippedEnd) - position(startsAt),
      color: null,
      colorIndex: stableIndex(session.courseId || session.courseName),
      startsAt,
      endsAt: clippedEnd,
    }];
  });

  const deadlineEntries: HomeTimelineEntry[] = [];
  const timeEntries: HomeTimelineEntry[] = [];
  for (const todo of todos) {
    if (!todo.endAt) continue;
    const taskTime = Date.parse(todo.endAt);
    if (!Number.isFinite(taskTime) || taskTime < now || taskTime > endsAt) continue;
    const tooltip = joinDetails(todo.title, `${todo.timeType === 'deadline' ? 'Due' : 'Scheduled'} ${formatDateTime(taskTime)}`, todo.details);
    if (todo.timeType === 'deadline') {
      const createdAt = Date.parse(todo.createdAt);
      const startsAt = Number.isFinite(createdAt) && createdAt > now && createdAt < taskTime ? createdAt : now;
      deadlineEntries.push({
        id: `deadline-${todo.id}`,
        title: todo.title,
        tooltip,
        kind: 'deadline',
        left: position(startsAt),
        width: Math.max(0, position(taskTime) - position(startsAt)),
        color: todo.color,
        colorIndex: 0,
        startsAt,
        endsAt: taskTime,
      });
    } else {
      timeEntries.push({
        id: `time-${todo.id}`,
        title: todo.title,
        tooltip,
        kind: 'time',
        left: position(taskTime),
        width: 0,
        color: todo.color,
        colorIndex: 0,
        startsAt: taskTime,
        endsAt: taskTime,
      });
    }
  }

  return {
    startsAt: now,
    endsAt,
    ticks: Array.from({ length: 8 }, (_, index) => ({ at: now + index * DAY_MS, left: index / 7 * 100 })),
    scheduleLanes: packLanes(scheduleEntries),
    deadlineLanes: packLanes(deadlineEntries),
    timeLanes: packLanes(timeEntries, 45 * 60 * 1000),
  };
}

export function packLanes(entries: HomeTimelineEntry[], pointSpacing = 0): HomeTimelineEntry[][] {
  const lanes: HomeTimelineEntry[][] = [];
  const laneEnds: number[] = [];
  for (const entry of [...entries].sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)) {
    const lane = laneEnds.findIndex((endsAt) => endsAt <= entry.startsAt);
    const laneIndex = lane === -1 ? lanes.length : lane;
    if (!lanes[laneIndex]) lanes[laneIndex] = [];
    lanes[laneIndex].push(entry);
    laneEnds[laneIndex] = Math.max(entry.endsAt, entry.startsAt + pointSpacing);
  }
  return lanes;
}

function stableIndex(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 7;
}

function formatRange(start: number, end: number): string {
  return `${formatDateTime(start)} to ${new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(end)}`;
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
}

function joinDetails(...values: (string | null | undefined)[]): string {
  return values.map((value) => value?.trim()).filter(Boolean).join(' · ');
}
