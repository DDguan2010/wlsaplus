import type {
  AssignmentScore,
  AttendanceEvent,
  AttendanceKind,
  ClassSession,
  Course,
  CourseProgressDetails,
  ProgressSnapshot,
  ScheduleSnapshot,
} from './models';

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function htmlToPlainText(value: unknown): string {
  const doc = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  doc.querySelectorAll('script, style, template').forEach((element) => element.remove());
  doc.querySelectorAll('br, p, div, li').forEach((element) => element.append(' '));
  return clean(doc.body.textContent);
}

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

function withoutScreenReaderText(element: Element): Element {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('.screen_readers_only').forEach((item) => item.remove());
  return copy;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? recordValue(value[0]) : {};
}

function powerSchoolPath(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, 'https://powerschool.invalid/guardian/home.html');
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

function dateOnly(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTHS = new Map<string, number>([
  ['一月', 1], ['二月', 2], ['三月', 3], ['四月', 4], ['五月', 5], ['六月', 6],
  ['七月', 7], ['八月', 8], ['九月', 9], ['十月', 10], ['十一月', 11], ['十二月', 12],
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7], ['aug', 8], ['sep', 9],
  ['oct', 10], ['nov', 11], ['dec', 12],
]);

function attendanceDate(title: string): string {
  const normalized = title.replace(/[\u200e\u200f]/g, ' ');
  const match = normalized.match(/(\d{1,2})\s+([^\s,:]+)\s+(\d{4})/);
  if (!match) return '';
  const month = MONTHS.get(match[2].toLowerCase());
  return month ? dateOnly(Number(match[3]), month, Number(match[1])) : '';
}

function attendanceKind(code: string): AttendanceKind {
  const normalized = code.trim().toUpperCase();
  if (normalized === 'X' || normalized === 'A' || normalized === 'ABS'
    || /ABSENT|ABSENCE|缺勤/.test(normalized)) return 'absence';
  if (normalized === 'T' || normalized === 'TDY'
    || /TARDY|LATE|迟到/.test(normalized)) return 'tardy';
  return 'other';
}

function attendanceLabel(kind: AttendanceKind, code: string): string {
  if (kind === 'absence') return 'Absent';
  if (kind === 'tardy') return 'Tardy';
  return code;
}

function parseAttendanceHistory(html: string): { events: AttendanceEvent[]; start: string; end: string } {
  if (!html.trim()) return { events: [], start: '', end: '' };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = Array.from(doc.querySelectorAll('table.grid')).find((item) => item.querySelector('th[title]'));
  if (!table) return { events: [], start: '', end: '' };

  let dates: string[] = [];
  const allDates: string[] = [];
  const grouped = new Map<string, AttendanceEvent>();
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const dateHeaders = Array.from(row.querySelectorAll('th[title]'));
    if (dateHeaders.length) {
      dates = dateHeaders.map((header) => attendanceDate(header.getAttribute('title') ?? ''));
      allDates.push(...dates.filter(Boolean));
      continue;
    }

    const cells = Array.from(row.querySelectorAll(':scope > td'));
    if (!dates.length || cells.length < 3) continue;
    const courseName = elementLines(withoutScreenReaderText(cells[0]))[0] ?? '';
    if (!courseName) continue;
    const meetingPattern = clean(cells[1].textContent);

    cells.slice(2, 2 + dates.length).forEach((cell, index) => {
      const date = dates[index];
      if (!date || cell.classList.contains('notInSession')) return;
      const copy = withoutScreenReaderText(cell);
      const title = clean(copy.querySelector('[title]')?.getAttribute('title'));
      const codes = elementLines(copy)
        .flatMap((line) => line.split(/\s+/))
        .map(clean)
        .filter((code) => code && code !== '.' && code !== '-');
      for (const code of codes) {
        const kind = attendanceKind(`${title} ${code}`);
        const key = `${date}|${courseName}|${kind}|${code}`;
        const previous = grouped.get(key);
        if (previous) {
          previous.count += 1;
        } else {
          grouped.set(key, {
            id: key,
            date,
            courseName,
            meetingPattern,
            kind,
            label: attendanceLabel(kind, title || code),
            count: 1,
          });
        }
      }
    });
  }

  const orderedDates = [...new Set(allDates)].sort();
  const events = [...grouped.values()].sort((left, right) =>
    right.date.localeCompare(left.date) || left.courseName.localeCompare(right.courseName));
  return { events, start: orderedDates[0] ?? '', end: orderedDates.at(-1) ?? '' };
}

function courseCellDetails(cell: Element): { name: string; teacher: string; room: string } {
  const name = elementLines(withoutScreenReaderText(cell))[0] ?? '';
  const contact = cell.querySelector('a[href^="mailto:"]');
  const contactTitle = cell.querySelector('a[title^="Details about "]')?.getAttribute('title') ?? '';
  const teacher = clean(contactTitle.replace(/^Details about\s+/i, ''))
    || clean(contact?.textContent).replace(/^Email\s+/i, '');
  const room = clean(cell.querySelector('.display-flex')?.textContent).replace(/^[-\s]*Rm:\s*/i, '');
  return { name, teacher, room };
}

export function parsePowerSchoolProgress(homeHtml: string, attendanceHtml = ''): ProgressSnapshot {
  const doc = new DOMParser().parseFromString(homeHtml, 'text/html');
  const table = Array.from(doc.querySelectorAll('table.linkDescList, table.grid'))
    .find((item) => item.querySelector('tr[id^="ccid_"]'));
  const courses = table ? Array.from(table.querySelectorAll('tr[id^="ccid_"]')).flatMap((row, index) => {
    const cells = Array.from(row.querySelectorAll(':scope > td'));
    if (cells.length < 5) return [];
    const courseCell = cells.at(-4)!;
    const gradeCell = cells.at(-3)!;
    const details = courseCellDetails(courseCell);
    const detailsPath = powerSchoolPath(gradeCell.querySelector('a[href*="scores.html"]')?.getAttribute('href') ?? '');
    if (!details.name) return [];
    const gradeText = clean(withoutScreenReaderText(gradeCell).textContent);
    let term = '';
    try { term = new URL(detailsPath, 'https://powerschool.invalid').searchParams.get('fg') ?? ''; } catch { /* Keep it empty. */ }
    return [{
      id: row.id.replace(/^ccid_/, '') || `progress-course-${index}`,
      name: details.name,
      teacher: details.teacher,
      room: details.room,
      meetingPattern: clean(cells[0].textContent),
      term,
      grade: /^\[\s*i\s*\]$/i.test(gradeText) ? '' : gradeText,
      absences: numberOrNull(cells.at(-2)?.textContent),
      tardies: numberOrNull(cells.at(-1)?.textContent),
      detailsPath,
      details: null,
    }];
  }) : [];
  const attendance = parseAttendanceHistory(attendanceHtml);
  return {
    syncedAt: new Date().toISOString(),
    term: courses.find((course) => course.term)?.term ?? '',
    absenceTotal: numberOrNull(doc.querySelector('#termAbsTotal')?.textContent),
    tardyTotal: numberOrNull(doc.querySelector('#termTarTotal')?.textContent),
    attendanceStart: attendance.start,
    attendanceEnd: attendance.end,
    courses,
    attendanceEvents: attendance.events,
  };
}

export interface AssignmentLookupRequest {
  section_ids: number[];
  student_ids: number[];
  start_date?: string;
  end_date?: string;
  store_codes?: string[];
  term_ids?: number[];
}

function initValue(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`));
  return match?.[1] ?? '';
}

function lookupDate(value: string): string {
  const match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return match ? `${Number(match[3])}-${Number(match[2])}-${Number(match[1])}` : '';
}

export function parseAssignmentLookupRequest(scoreHtml: string): AssignmentLookupRequest | null {
  const doc = new DOMParser().parseFromString(scoreHtml, 'text/html');
  const wrapper = doc.querySelector('.xteContentWrapper[data-ng-init]');
  const target = wrapper?.querySelector('[data-pss-student-assignment-scores]');
  if (!wrapper || !target) return null;
  const init = wrapper.getAttribute('data-ng-init') ?? '';
  const studentMatch = initValue(init, 'studentFRN').match(/^001(\d+)$/);
  const sectionId = numberOrNull(target.getAttribute('data-sectionid'));
  const studentId = studentMatch ? Number(studentMatch[1]) : null;
  if (sectionId === null || studentId === null) return null;

  const request: AssignmentLookupRequest = { section_ids: [sectionId], student_ids: [studentId] };
  const startDate = lookupDate(initValue(init, 'beginningDate'));
  const endDate = lookupDate(initValue(init, 'endingDate'));
  if (startDate && endDate) {
    request.start_date = startDate;
    request.end_date = endDate;
    return request;
  }
  const storeCode = initValue(init, 'storecode');
  if (storeCode) {
    request.store_codes = [storeCode];
    return request;
  }
  const termId = numberOrNull(target.getAttribute('data-termid'));
  if (termId !== null) request.term_ids = [termId];
  return request;
}

function normalizeAssignmentDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return match ? dateOnly(Number(match[1]), Number(match[2]), Number(match[3])) || null : null;
}

function parseAssignments(value: unknown): AssignmentScore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawAssignment, index) => {
    const assignment = recordValue(rawAssignment);
    const section = firstRecord(assignment['_assignmentsections']);
    if (!Object.keys(section).length || section['isscorespublish'] === false) return [];
    const score = firstRecord(section['_assignmentscores']);
    const categoryAssociation = firstRecord(section['_assignmentcategoryassociations']);
    const teacherCategory = recordValue(categoryAssociation['_teachercategory']);
    const name = clean(String(section['name'] ?? assignment['_name'] ?? ''));
    if (!name) return [];
    return [{
      id: String(assignment['assignmentid'] ?? assignment['_id'] ?? `assignment-${index}`),
      name,
      description: htmlToPlainText(section['description']),
      dueDate: normalizeAssignmentDate(section['duedate']),
      category: clean(String(teacherCategory['name'] ?? teacherCategory['_name'] ?? '')),
      pointsEarned: numberOrNull(score['scorepoints']),
      pointsPossible: numberOrNull(section['totalpointvalue']),
      percent: numberOrNull(score['scorepercent']),
      letterGrade: clean(String(score['scorelettergrade'] ?? '')),
      isLate: booleanValue(score['islate']),
      isMissing: booleanValue(score['ismissing']),
      isAbsent: booleanValue(score['isabsent']),
      isExempt: booleanValue(score['isexempt']),
      isIncomplete: booleanValue(score['isincomplete']),
      countsInFinalGrade: section['iscountedinfinalgrade'] !== false,
    }];
  }).sort((left, right) =>
    (right.dueDate ?? '').localeCompare(left.dueDate ?? '') || left.name.localeCompare(right.name));
}

export function parsePowerSchoolCourseDetails(scoreHtml: string, assignmentJson: string): CourseProgressDetails {
  const doc = new DOMParser().parseFromString(scoreHtml, 'text/html');
  const comments = Array.from(doc.querySelectorAll('.comment')).map((item) => clean(item.textContent));
  let assignments: AssignmentScore[] = [];
  try { assignments = parseAssignments(JSON.parse(assignmentJson) as unknown); } catch { /* Use an empty state. */ }
  return {
    teacherComment: comments[0] ?? '',
    description: comments[1] ?? '',
    assignments,
    loadedAt: new Date().toISOString(),
  };
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
