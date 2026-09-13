export const CAMPUS_BUILDINGS = [
  { id: 1, name: 'Sports hall', chinese: '体育馆', x: 900, y: 550, details: 'Practice rooms and music classrooms, WLSA store, meeting room, PE office (2F), multi-functional center (3F).' },
  { id: 2, name: 'Cloud library & offices', chinese: '云图书馆 / 办公室', x: 1175, y: 770, details: 'Cloud library and IT office (1F), teachers offices (2F), administration (3F), multi-functional center (4F).' },
  { id: 3, name: 'Teaching building', chinese: '教学楼', x: 1340, y: 510, details: 'Classrooms and the lecture hall (4F).' },
  { id: 4, name: 'Golf simulation course', chinese: '高尔夫模拟球场', x: 1055, y: 400, details: 'Beside the sports hall, at the end of the art gallery.' },
  { id: 5, name: 'Seven Cube · Teaching area', chinese: '七立方 · 教学区', x: 1590, y: 715, details: 'Teachers offices, drama classroom, Faculty Commons and dining hall 1.' },
  { id: 6, name: 'Seven Cube · Teaching area', chinese: '七立方 · 教学区', x: 1575, y: 360, details: 'Classrooms, teachers offices and Students Center.' },
  { id: 7, name: 'Girls dormitory', chinese: '女生宿舍', x: 585, y: 340, details: 'On the west side of Qinggang Road, next to building 8.' },
  { id: 8, name: 'Boys dormitory', chinese: '男生宿舍', x: 470, y: 325, details: 'Boys dormitory with an adjoining study hall.' },
  { id: 9, name: 'Teaching building', chinese: '教学楼', x: 125, y: 330, details: 'IT office, conference hall, Faculty Commons (1F), Innovation Center (2F), Students Center (3F), College Counseling Office (4F), Test Center (6F).' },
  { id: 10, name: 'Boys dormitory', chinese: '男生宿舍', x: 585, y: 700, details: 'Next to dining hall 2, west of Qinggang Road.' },
  { id: 11, name: 'Classrooms & girls dormitory', chinese: '教室 / 女生宿舍', x: 445, y: 680, details: 'Classrooms and teachers offices (1F), girls dormitory (2–4F).' },
  { id: 12, name: 'Fitness & pickleball', chinese: '健身房 / 匹克球场', x: 50, y: 620, details: 'Fitness center (1F) and pickleball (2F), along the west side of the running track.' },
] as const;

export function campusBuilding(id: number | null | undefined) {
  return CAMPUS_BUILDINGS.find((building) => building.id === id) ?? null;
}

/** A compact classroom code starts with its building digit: 5218 → 5.
 * Two-digit buildings are accepted as explicit prefixes (12-201, Building 12).
 * Do not interpret a classroom such as 1201 as building 12.
 */
export function buildingFromRoom(room: string | null | undefined): number | null {
  const value = (room ?? '').normalize('NFKC').trim().replace(/^(?:room|rm|教室)\s*[:：.]?\s*/i, '');
  const explicit = value.match(/^(?:building|bldg)\s*([0-9]{1,2})(?=\D|$)/i)
    ?? value.match(/^([0-9]{1,2})\s*(?:号楼|栋|幢|座|楼|[-–—/])/);
  if (explicit) return campusBuilding(Number(explicit[1]))?.id ?? null;
  const number = value.match(/^([0-9]+)(?=\D|$)/)?.[1];
  if (!number || number.startsWith('0')) return null;
  const id = number.length <= 2 ? Number(number) : Number(number[0]);
  return campusBuilding(id)?.id ?? null;
}
