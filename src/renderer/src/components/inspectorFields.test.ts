import { describe, expect, it } from 'vitest';
import type { PfObject } from '../../../shared/phaseform/types';
import { advancedKeys, degToRad, fieldsFor, getAt, parseNumStr, radToDeg, setAt } from './inspectorFields';

const keys = (type: string, top = true) => new Set(fieldsFor(type, top).map(d => d.path[0]));

describe('fieldsFor', () => {
  it('gives containers no origin, tint or flip', () => {
    const k = keys('container');
    for (const absent of ['origin', 'tint', 'tintMode', 'flipX', 'flipY', 'key']) expect(k.has(absent)).toBe(false);
    for (const present of ['x', 'rotation', 'scale', 'alpha', 'blendMode']) expect(k.has(present)).toBe(true);
  });
  it('gives images key, frame and tint', () => {
    const k = keys('image');
    for (const present of ['key', 'frame', 'tint', 'tintMode', 'origin', 'flipX']) expect(k.has(present)).toBe(true);
  });
  it('gives shapes fill and stroke but no tint or flip; lines have no fill', () => {
    expect(keys('rectangle').has('fill')).toBe(true);
    expect(keys('rectangle').has('tint')).toBe(false);
    expect(keys('rectangle').has('flipX')).toBe(false);
    expect(keys('line').has('stroke')).toBe(true);
    expect(keys('line').has('fill')).toBe(false);
  });
  it('limits depth to top-level objects', () => {
    expect(keys('image', true).has('depth')).toBe(true);
    expect(keys('image', false).has('depth')).toBe(false);
  });
  it('gives bitmap text no flip', () => {
    expect(keys('bitmapText').has('font')).toBe(true);
    expect(keys('bitmapText').has('flipX')).toBe(false);
  });
});

describe('rotation conversion', () => {
  it('converts between degrees and radians', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(radToDeg(Math.PI / 2)).toBe(90);
    expect(radToDeg(degToRad(37.5))).toBeCloseTo(37.5);
  });
});

describe('advancedKeys', () => {
  it('lists fields the table does not cover, never children', () => {
    const o: PfObject = { id: 'a', type: 'container', x: 1, children: [], filters: [], params: { a: 1 }, extensions: {}, origin: { x: 0, y: 0 }, weird: 3 };
    expect(advancedKeys(o)).toEqual(['filters', 'params', 'extensions', 'origin', 'weird']);
  });
  it('does not list covered fields', () => {
    const o: PfObject = { id: 'a', type: 'image', key: 'k', x: 1, tint: '#ffffff', data: { z: 1 } };
    expect(advancedKeys(o)).toEqual(['data']);
  });
  it('lists depth on a nested object', () => {
    const o: PfObject = { id: 'a', type: 'image', key: 'k', depth: 3 };
    expect(advancedKeys(o, true)).toEqual([]);
    expect(advancedKeys(o, false)).toEqual(['depth']);
  });
});

describe('setAt / getAt / parseNumStr', () => {
  it('sends the whole nested value', () => {
    const o: PfObject = { id: 'a', type: 'image', scale: { x: 1, y: 3 }, style: { color: '#fff', wordWrap: { width: 5, useAdvancedWrap: true } } };
    expect(setAt(o, ['scale', 'x'], 2)).toEqual({ scale: { x: 2, y: 3 } });
    expect(setAt(o, ['style', 'wordWrap', 'width'], 9)).toEqual({ style: { color: '#fff', wordWrap: { width: 9, useAdvancedWrap: true } } });
    expect(setAt(o, ['style', 'color'], undefined)).toEqual({ style: { wordWrap: { width: 5, useAdvancedWrap: true } } });
    expect(setAt(o, ['alpha'], undefined)).toEqual({ alpha: undefined });
    expect(getAt(o, ['style', 'wordWrap', 'width'])).toBe(5);
  });
  it('parses frames', () => {
    expect(parseNumStr('3')).toBe(3);
    expect(parseNumStr('walk_1')).toBe('walk_1');
    expect(parseNumStr('')).toBeUndefined();
  });
});
