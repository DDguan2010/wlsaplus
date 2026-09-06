import { describe, expect, it } from 'vitest';
import { buildHomeTimeline, HOME_TIMELINE_RANGE_MS, packLanes } from './home-timeline';
import type { ClassSession, TodoItem } from './models';

const NOW = Date.parse('2026-09-06T08:00:00.000Z');

describe('home timeline', () => {
  it('clips classes to the next seven days and excludes later classes', () => {
    const sessions: ClassSession[] = [
      { id: 'current', courseId: 'math', courseName: 'Math', teacher: '', room: '', startsAt: '2026-09-06T07:30:00.000Z', endsAt: '2026-09-06T08:30:00.000Z' },
      { id: 'later', courseId: 'art', courseName: 'Art', teacher: '', room: '', startsAt: '2026-09-14T08:00:00.000Z', endsAt: '2026-09-14T09:00:00.000Z' },
    ];

    const layout = buildHomeTimeline(sessions, [], NOW);

    expect(layout.endsAt).toBe(NOW + HOME_TIMELINE_RANGE_MS);
    expect(layout.ticks).toHaveLength(8);
    expect(layout.scheduleLanes.flat().map((entry) => entry.title)).toEqual(['Math']);
    expect(layout.scheduleLanes[0][0].left).toBe(0);
  });

  it('uses bars for deadlines and points for normal task times', () => {
    const tasks: TodoItem[] = [
      { id: 'deadline', title: 'Essay', details: '', createdAt: '2026-09-05T08:00:00.000Z', endAt: '2026-09-08T08:00:00.000Z', color: 'red', icon: null, timeType: 'deadline' },
      { id: 'time', title: 'Meeting', details: '', createdAt: '2026-09-05T08:00:00.000Z', endAt: '2026-09-09T08:00:00.000Z', color: 'blue', icon: null, timeType: 'time' },
    ];

    const layout = buildHomeTimeline([], tasks, NOW);

    expect(layout.deadlineLanes.flat()[0]).toMatchObject({ title: 'Essay', kind: 'deadline', left: 0, color: 'red' });
    expect(layout.deadlineLanes.flat()[0].width).toBeGreaterThan(0);
    expect(layout.timeLanes.flat()[0]).toMatchObject({ title: 'Meeting', kind: 'time', width: 0, color: 'blue' });
  });

  it('places overlapping entries on separate lanes', () => {
    const entry = (id: string, startsAt: number, endsAt: number) => ({ id, title: id, tooltip: id, kind: 'schedule' as const, left: 0, width: 1, color: null, colorIndex: 0, startsAt, endsAt });

    const lanes = packLanes([entry('one', 0, 20), entry('two', 10, 30), entry('three', 20, 40)]);

    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((item) => item.id)).toEqual(['one', 'three']);
    expect(lanes[1].map((item) => item.id)).toEqual(['two']);
  });
});
