import type { ClassSession, Course, ScheduleSnapshot } from './models';

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function localIso(dateCode: string, time: string): string {
  const match = clean(time).match(/(\d{1,2}):(\d{2})\s*(上午|下午|AM|PM)?/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const period = match[3]?.toUpperCase();
  if ((period === 'PM' || period === '下午') && hour < 12) hour += 12;
  if ((period === 'AM' || period === '上午') && hour === 12) hour = 0;
  const year = Number(dateCode.slice(0, 4));
  const month = Number(dateCode.slice(4, 6)) - 1;
  const day = Number(dateCode.slice(6, 8));
  return new Date(year, month, day, hour, Number(match[2]), 0, 0).toISOString();
}

function elementLines(element: Element): string[] {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (copy.textContent ?? '').split('\n').map(clean).filter(Boolean);
}

export function parsePowerSchoolSchedule(weekHtml: string, matrixHtml: string): ScheduleSnapshot {
  const parser = new DOMParser();
  const weekDoc = parser.parseFromString(weekHtml, 'text/html');
  const matrixDoc = parser.parseFromString(matrixHtml, 'text/html');
  const parsedCourses: Course[] = Array.from(matrixDoc.querySelectorAll('#schedMatrixTable .sched-course-name'))
    .map((nameElement, index) => {
      const cell = nameElement.closest('td') ?? nameElement.parentElement;
      const name = clean(nameElement.textContent);
      const sectionNumber = clean(cell?.querySelector('.sched-section-number')?.textContent);
      const matrixId = Array.from(cell?.classList ?? []).find((className) => /^matrix_\d+$/.test(className));
      return {
        id: sectionNumber || matrixId || `course-${index}`,
        name,
        sectionNumber,
        teacher: clean(cell?.querySelector('.sched-teacher-name')?.textContent),
        room: clean(cell?.querySelector('.sched-room')?.textContent).replace(/^Room:\s*/i, ''),
        meetingPattern: clean(cell?.querySelector('.sched-term')?.textContent),
      } satisfies Course;
    });
  const courses = [...new Map(parsedCourses.map((course) => [course.id, course])).values()];

  const sessions: ClassSession[] = [];
  weekDoc.querySelectorAll('#tableStudentSchedMatrix [name^="attCell"]')
    .forEach((cell, index) => {
      if (!Array.from(cell.classList).some((name) => name.startsWith('scheduleClass'))) return;
      const dateCode = cell.getAttribute('name')?.match(/(\d{8})/)?.[1];
      const lines = elementLines(cell);
      const timeIndex = lines.findIndex((line) => /\d{1,2}:\d{2}.*-.*\d{1,2}:\d{2}/.test(line));
      if (!dateCode || timeIndex < 0 || !lines[0]) return;
      const times = lines[timeIndex].split(/\s+-\s+/);
      const startsAt = localIso(dateCode, times[0] ?? '');
      const endsAt = localIso(dateCode, times[1] ?? '');
      if (!startsAt || !endsAt) return;
      const course = courses.find((item) => clean(item.name).toLowerCase() === clean(lines[0]).toLowerCase());
      const details = lines.slice(1, timeIndex);
      sessions.push({
        id: `${dateCode}-${index}-${startsAt}`,
        courseId: course?.id ?? null,
        courseName: lines[0],
        teacher: course?.teacher || details[0] || '',
        room: course?.room || details[1] || '',
        startsAt,
        endsAt,
      });
    });

  sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const dates = sessions.map((session) => session.startsAt.slice(0, 10));
  return {
    syncedAt: new Date().toISOString(),
    weekStart: dates[0] ?? '',
    weekEnd: dates.at(-1) ?? '',
    sessions,
    courses,
  };
}
