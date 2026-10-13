import { describe, expect, it } from 'vitest';
import { formatScene, parseScene, uniqueName, toIdentifier, isIdentifier, SCENE_VERSION } from './scene';

const obj = (over: Record<string, unknown> = {}) =>
  ({ id: 'a', name: 'Box', kind: 'primitive', shape: 'rect', anchor: null, interactive: false, ...over });
const scene = (objects: unknown[], over: Record<string, unknown> = {}) =>
  ({ version: SCENE_VERSION, key: 'main', overlay: false, objects, ...over });

describe('parseScene', () => {
  it('loads a valid scene and round-trips through formatScene', () => {
    const { doc, problems, fatal } = parseScene(scene([obj()]), 'main');
    expect(fatal).toBe(false);
    expect(problems).toEqual([]);
    expect(parseScene(JSON.parse(formatScene(doc)), 'main').doc).toEqual(doc);
  });

  it.each([
    ['non-object', 42],
    ['wrong version', scene([], { version: 99 })],
    ['objects not an array', scene([], { objects: {} })],
  ])('treats %s as fatal so it is never saved over the file', (_n, raw) => {
    const r = parseScene(raw, 'main');
    expect(r.fatal).toBe(true);
    expect(r.problems.some(p => p.level === 'error')).toBe(true);
  });

  it('skips bad objects and warns about duplicate names', () => {
    const r = parseScene(scene([obj(), obj(), obj({ id: 'b', kind: 'weird' }), obj({ id: 'c' })]), 'main');
    expect(r.fatal).toBe(false);
    expect(r.doc.objects.map(o => o.id)).toEqual(['a', 'c']);
    expect(r.problems.filter(p => p.level === 'error')).toHaveLength(2);
    expect(r.problems.some(p => p.message.includes('Duplicate name'))).toBe(true);
  });
});

describe('uniqueName', () => {
  it('numbers clashes case-insensitively', () => {
    expect(uniqueName('Box', ['box', 'Box2'])).toBe('Box3');
    expect(uniqueName('Box', [])).toBe('Box');
  });
});

describe('flat engine-neutral model', () => {
  it('defaults depth to list order and keeps explicit depth', () => {
    const r = parseScene(scene([obj({ id: 'a', name: 'A' }), obj({ id: 'b', name: 'B' }), obj({ id: 'c', name: 'C', depth: 7 })]), 'main');
    expect(r.doc.objects.map(o => o.depth)).toEqual([0, 1, 7]);
  });

  it('reads anchor and interactive, and warns on an unknown anchor', () => {
    const r = parseScene(scene([obj({ anchor: 'bottom-right', interactive: true }), obj({ id: 'b', name: 'B', anchor: 'middle' })]), 'main');
    expect(r.doc.objects.map(o => [o.anchor, o.interactive])).toEqual([['bottom-right', true], [null, false]]);
    expect(r.problems.some(p => p.message.includes('unknown anchor'))).toBe(true);
  });

  it('keeps origin in the core, Phaser-specific props under "phaser", and ignores parentId', () => {
    const { doc } = parseScene(scene([obj({ parentId: 'x', originX: 0, phaser: { flipX: true } })]), 'main');
    expect(doc.objects[0]).not.toHaveProperty('parentId');
    expect(doc.objects[0].originX).toBe(0);
    const out = JSON.parse(formatScene(doc).split('\n').find(l => l.includes('"id"'))!.replace(/,$/, ''));
    expect(out.phaser).toMatchObject({ flipX: true });
    expect(out.phaser).not.toHaveProperty('originX');
    expect(out).toMatchObject({ originX: 0, originY: 0.5 });
    expect(out).not.toHaveProperty('parentId');
  });

  it('warns about names that are not code identifiers', () => {
    const r = parseScene(scene([obj({ name: 'Play Button' }), obj({ id: 'b', name: 'playButton' })]), 'main');
    expect(r.problems.filter(p => p.message.includes('code identifier'))).toHaveLength(1);
    expect(isIdentifier('9lives')).toBe(false);
    expect(toIdentifier('my-sprite 2')).toBe('my_sprite_2');
    expect(toIdentifier('9lives')).toBe('_9lives');
  });
});
