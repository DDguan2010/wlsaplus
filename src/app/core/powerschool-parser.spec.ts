import { describe, expect, it } from 'vitest';
import {
  parseAssignmentLookupRequest,
  parsePowerSchoolCourseDetails,
  parsePowerSchoolProgress,
  parsePowerSchoolSchedule,
} from './powerschool-parser';

describe('parsePowerSchoolSchedule', () => {
  it('parses Chinese AM/PM times, teachers, rooms, and course IDs', () => {
    const week = `
      <table id="tableStudentSchedMatrix">
        <tr><td class="scheduleClass1" name="attCell20260824">Computer Science<br>Jemli, Sofien<br>5218<br>09:00 上午 - 09:40 上午</td></tr>
        <tr><td class="scheduleClass2" name="attCell20260824">Activity<br>Sun, Sherry<br><br>01:15 下午 - 02:00 下午</td></tr>
        <tr><td class="scheduleBreak" name="attCell20260824">Lunch</td></tr>
      </table>`;
    const matrix = `
      <table id="schedMatrixTable"><tbody>
        <tr><td class="matrix_1"><p class="sched-course-name">Computer Science</p><p class="sched-section-number">CS-1</p><p class="sched-teacher-name">Jemli, Sofien</p><p class="sched-room">Room: 5218</p><p class="sched-term">Mon 09:00</p></td>
        <td class="matrix_2"><p class="sched-course-name">Activity</p><p class="sched-section-number">ACT-1</p><p class="sched-teacher-name">Sun, Sherry</p><p class="sched-room">Room: </p><p class="sched-term">Mon 13:15</p></td></tr>
        <tr><td class="matrix_1"><p class="sched-course-name">Computer Science</p><p class="sched-section-number">CS-1</p><p class="sched-teacher-name">Jemli, Sofien</p><p class="sched-room">Room: 5218</p></td></tr>
      </tbody></table>`;
    const result = parsePowerSchoolSchedule(week, matrix);
    expect(result.sessions).toHaveLength(2);
    expect(result.courses).toHaveLength(2);
    expect(result.sessions[0]).toMatchObject({ courseId: 'CS-1', teacher: 'Jemli, Sofien', room: '5218' });
    expect(new Date(result.sessions[0].startsAt).getHours()).toBe(9);
    expect(new Date(result.sessions[1].startsAt).getHours()).toBe(13);
    expect(result.sessions[1].room).toBe('');
  });
});

describe('parsePowerSchoolProgress', () => {
  it('parses grade summaries, totals, and grouped attendance events', () => {
    const home = `
      <table class="linkDescList grid">
        <tr><th>Meeting</th><th>Course</th><th>S1</th><th>Absences</th><th>Tardies</th></tr>
        <tr id="ccid_42">
          <td>P1-P2(Mon)</td>
          <td>Algebra<br><a title="Details about Alex Teacher"></a><a href="mailto:teacher@example.test">Email Alex Teacher</a><span class="display-flex">- Rm: 210</span></td>
          <td><a href="scores.html?frn=0042&amp;fg=S1&amp;schoolid=1">A</a></td><td>2</td><td>1</td>
        </tr>
        <tr id="ccid_43">
          <td>P3(Tue)</td><td>Advisory<br><a href="mailto:advisor@example.test">Email Sam Advisor</a></td>
          <td><span class="screen_readers_only">Not available</span></td><td>0</td><td>0</td>
        </tr>
      </table>
      <span id="termAbsTotal">2</span><span id="termTarTotal">1</span>`;
    const attendance = `
      <table class="grid">
        <tr><th rowspan="2">Course</th><th rowspan="2">Meeting</th><th colspan="2">Week</th></tr>
        <tr><th title="Monday, 24 August 2026">Mon</th><th title="Tuesday, 25 August 2026">Tue</th></tr>
        <tr><td>Algebra<br>Alex Teacher</td><td>P1-P2(Mon)</td><td>X<br>X</td><td>T</td></tr>
        <tr><th rowspan="2">Course</th><th rowspan="2">Meeting</th><th>Week</th></tr>
        <tr><th title="Wednesday, 26 August 2026">Wed</th></tr>
        <tr><td>Algebra<br>Alex Teacher</td><td>P1-P2(Mon)</td><td>-</td></tr>
      </table>`;

    const result = parsePowerSchoolProgress(home, attendance);

    expect(result).toMatchObject({ term: 'S1', absenceTotal: 2, tardyTotal: 1, attendanceStart: '2026-08-24', attendanceEnd: '2026-08-26' });
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0]).toMatchObject({ id: '42', name: 'Algebra', teacher: 'Alex Teacher', room: '210', grade: 'A', absences: 2, tardies: 1, detailsPath: '/guardian/scores.html?frn=0042&fg=S1&schoolid=1' });
    expect(result.courses[1]).toMatchObject({ grade: '', detailsPath: '' });
    expect(result.attendanceEvents).toEqual([
      expect.objectContaining({ date: '2026-08-25', kind: 'tardy', label: 'Tardy', count: 1 }),
      expect.objectContaining({ date: '2026-08-24', kind: 'absence', label: 'Absent', count: 2 }),
    ]);
  });

  it('returns safe empty states when progress tables are unavailable', () => {
    expect(parsePowerSchoolProgress('<html></html>')).toMatchObject({
      term: '', absenceTotal: null, tardyTotal: null, courses: [], attendanceEvents: [],
    });
  });
});

describe('PowerSchool assignment parsing', () => {
  const scorePage = `
    <div class="comment"><pre>Good participation.</pre></div>
    <div class="comment"><pre>Introduction to algebra.</pre></div>
    <div class="xteContentWrapper" data-ng-init="studentFRN = '00177'; beginningDate = '24-08-2026'; endingDate = '30-01-2027'; storecode = 'S1';">
      <div data-pss-student-assignment-scores data-sectionid="2543" data-termid="3600"></div>
    </div>`;

  it('builds the same date-range lookup used by PowerSchool', () => {
    expect(parseAssignmentLookupRequest(scorePage)).toEqual({
      section_ids: [2543], student_ids: [77], start_date: '2026-8-24', end_date: '2027-1-30',
    });
  });

  it('parses assignment scores and status flags', () => {
    const response = JSON.stringify([{
      assignmentid: 9001,
      _assignmentsections: [{
        name: 'Linear equations', description: 'Complete questions 1-5.', duedate: '2026-8-31',
        isscorespublish: true, iscountedinfinalgrade: true, totalpointvalue: 10,
        _assignmentscores: [{ scorepoints: 8, scorepercent: 80, scorelettergrade: 'B', islate: true, ismissing: false, isabsent: false, isexempt: false, isincomplete: false }],
        _assignmentcategoryassociations: [{ _teachercategory: { name: 'Homework' } }],
      }],
    }]);

    const details = parsePowerSchoolCourseDetails(scorePage, response);

    expect(details).toMatchObject({ teacherComment: 'Good participation.', description: 'Introduction to algebra.' });
    expect(details.assignments).toEqual([expect.objectContaining({ id: '9001', name: 'Linear equations', dueDate: '2026-08-31', category: 'Homework', pointsEarned: 8, pointsPossible: 10, percent: 80, letterGrade: 'B', isLate: true })]);
  });

  it('uses an empty assignment list for a valid empty response', () => {
    expect(parsePowerSchoolCourseDetails(scorePage, '[]').assignments).toEqual([]);
  });
});
