import { describe, expect, it } from 'vitest';
import { buildingFromRoom } from './campus-map';

describe('classroom building lookup', () => {
  it('uses the first digit of compact PowerSchool classroom codes', () => {
    expect(buildingFromRoom('5218')).toBe(5);
    expect(buildingFromRoom('210')).toBe(2);
    expect(buildingFromRoom('1201')).toBe(1);
    expect(buildingFromRoom('Room: ６２０１')).toBe(6);
    expect(buildingFromRoom('9F 201')).toBe(9);
  });

  it('supports explicit building numbers including buildings 10 through 12', () => {
    expect(buildingFromRoom('12')).toBe(12);
    expect(buildingFromRoom('12-201')).toBe(12);
    expect(buildingFromRoom('Building 10 Room 201')).toBe(10);
    expect(buildingFromRoom('11号楼 201')).toBe(11);
  });

  it('does not invent buildings for missing or unrecognised locations', () => {
    for (const value of [null, undefined, '', 'TBA', 'Gym', 'PE 2', '0', '0123', '13', 'Building 13', '13-201']) {
      expect(buildingFromRoom(value)).toBeNull();
    }
  });
});
