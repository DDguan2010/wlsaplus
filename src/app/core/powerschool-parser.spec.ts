import { describe, expect, it } from 'vitest';
import { parsePowerSchoolSchedule } from './powerschool-parser';

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
