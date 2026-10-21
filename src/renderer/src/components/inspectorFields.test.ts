import { describe, expect, it } from 'vitest';
import type { PfObject } from '../../../shared/phaseform/types';
import { advancedKeys, degToRad, fieldsFor, getAt, moveItem, paramKind, parseNumStr, radToDeg, setAt } from './inspectorFields';

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
  it('limits anchors to top-level objects and offers both axes', () => {
    expect(fieldsFor('image', true).filter(d => d.path[0] === 'anchor').map(d => d.path.join('.'))).toEqual(['anchor.x', 'anchor.y']);
    expect(keys('image', false).has('anchor')).toBe(false);
    expect(keys('container', true).has('anchor')).toBe(true);
  });
  it('writes one anchor axis and keeps the other', () => {
    const o: PfObject = { id: 'a', type: 'image', key: 'k', anchor: { y: 'bottom' } };
    expect(setAt(o, ['anchor', 'x'], 'right')).toEqual({ anchor: { y: 'bottom', x: 'right' } });
    expect(setAt(o, ['anchor', 'y'], undefined)).toEqual({ anchor: {} });
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
    const o: PfObject = { id: 'a', type: 'container', x: 1, children: [], filters: [], data: { z: 1 }, extensions: {}, origin: { x: 0, y: 0 }, weird: 3 };
    expect(advancedKeys(o)).toEqual(['filters', 'data', 'extensions', 'origin', 'weird']);
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

describe('placeholder fields', () => {
  const shown = (o: PfObject) => fieldsFor(o.type).filter(d => d.section === 'Placeholder' && (!d.when || d.when(o))).map(d => d.path.join('.') + ':' + d.kind);
  it('offers only the toggle on a graphics object or a scripted object, and nothing on a plain one', () => {
    expect(shown({ id: 'a', type: 'graphics' })).toEqual(['placeholder:presence']);
    expect(shown({ id: 'a', type: 'image', key: 'k', scripts: ['a.js'] })).toEqual(['placeholder:presence']);
    expect(shown({ id: 'a', type: 'image', key: 'k' })).toEqual([]);
  });
  it('shows rect and ellipse fields, but raw JSON for polygon and image', () => {
    expect(shown({ id: 'a', type: 'graphics', placeholder: { kind: 'rect', width: 1, height: 1 } })).toContain('placeholder.width:number');
    expect(shown({ id: 'a', type: 'graphics', placeholder: { kind: 'polygon', width: 1, height: 1, points: [] } })).toEqual(['placeholder:presence', 'placeholder:json']);
    expect(shown({ id: 'a', type: 'graphics', placeholder: { kind: 'image', width: 1, height: 1, path: 'a.png' } })).toEqual(['placeholder:presence', 'placeholder:json']);
  });
  it('keeps placeholder out of Advanced', () => {
    expect(advancedKeys({ id: 'a', type: 'graphics', placeholder: { kind: 'rect' } })).toEqual([]);
  });
});

describe('scripts', () => {
  it('keeps a well-formed scripts list out of Advanced, but a malformed one in', () => {
    expect(advancedKeys({ id: 'a', type: 'graphics', scripts: ['a.js'] })).toEqual([]);
    expect(advancedKeys({ id: 'a', type: 'graphics', scripts: 'a.js' })).toEqual(['scripts']);
    expect(advancedKeys({ id: 'a', type: 'graphics', scripts: ['a.js', 3] })).toEqual(['scripts']);
  });
  it('keeps an object params out of Advanced, but an array or string in', () => {
    expect(advancedKeys({ id: 'a', type: 'graphics', params: { seconds: 5 } })).toEqual([]);
    expect(advancedKeys({ id: 'a', type: 'graphics', params: [1] })).toEqual(['params']);
    expect(advancedKeys({ id: 'a', type: 'graphics', params: 'x' })).toEqual(['params']);
  });
  it('infers an editor for each param value', () => {
    expect(paramKind(5)).toBe('number');
    expect(paramKind(true)).toBe('bool');
    expect(paramKind('#ffcc33')).toBe('color');
    expect(paramKind('ffcc33')).toBe('text');
    expect(paramKind({ a: 1 })).toBe('json');
    expect(paramKind([1])).toBe('json');
    expect(paramKind(null)).toBe('json');
  });
  it('moves items and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
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
