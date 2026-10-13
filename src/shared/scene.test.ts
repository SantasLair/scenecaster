import { describe, expect, it } from 'vitest';
import { formatScene, parseScene, uniqueName, toIdentifier, isIdentifier, SCENE_VERSION } from './scene';
import { extensionKeys, profileKeys } from './props';

const obj = (over: Record<string, unknown> = {}) =>
  ({ id: 'a', name: 'Box', kind: 'primitive', shape: 'rect', anchor: null, interactive: false, ...over });
const scene = (objects: unknown[], over: Record<string, unknown> = {}) =>
  ({ version: SCENE_VERSION, key: 'main', overlay: false, objects, ...over });

describe('parseScene', () => {
  it('loads a valid scene and round-trips through formatScene', () => {
    const { doc, problems, fatal } = parseScene(scene([obj()]), 'main', 'phaser');
    expect(fatal).toBe(false);
    expect(problems).toEqual([]);
    expect(parseScene(JSON.parse(formatScene(doc, 'phaser')), 'main', 'phaser').doc).toEqual(doc);
  });

  it.each([
    ['non-object', 42],
    ['wrong version', scene([], { version: 99 })],
    ['objects not an array', scene([], { objects: {} })],
  ])('treats %s as fatal so it is never saved over the file', (_n, raw) => {
    const r = parseScene(raw, 'main', 'phaser');
    expect(r.fatal).toBe(true);
    expect(r.problems.some(p => p.level === 'error')).toBe(true);
  });

  it('skips bad objects and warns about duplicate names', () => {
    const r = parseScene(scene([obj(), obj(), obj({ id: 'b', kind: 'weird' }), obj({ id: 'c' })]), 'main', 'phaser');
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
    const r = parseScene(scene([obj({ id: 'a', name: 'A' }), obj({ id: 'b', name: 'B' }), obj({ id: 'c', name: 'C', depth: 7 })]), 'main', 'phaser');
    expect(r.doc.objects.map(o => o.depth)).toEqual([0, 1, 7]);
  });

  it('reads anchor and interactive, and warns on an unknown anchor', () => {
    const r = parseScene(scene([obj({ anchor: 'bottom-right', interactive: true }), obj({ id: 'b', name: 'B', anchor: 'middle' })]), 'main', 'phaser');
    expect(r.doc.objects.map(o => [o.anchor, o.interactive])).toEqual([['bottom-right', true], [null, false]]);
    expect(r.problems.some(p => p.message.includes('unknown anchor'))).toBe(true);
  });

  it('keeps origin in the core, Phaser-specific props under "phaser", and ignores parentId', () => {
    const { doc } = parseScene(scene([obj({ parentId: 'x', originX: 0, phaser: { flipX: true } })]), 'main', 'phaser');
    expect(doc.objects[0]).not.toHaveProperty('parentId');
    expect(doc.objects[0].originX).toBe(0);
    const out = JSON.parse(formatScene(doc, 'phaser').split('\n').find(l => l.includes('"id"'))!.replace(/,$/, ''));
    expect(out.phaser).toMatchObject({ flipX: true });
    expect(out.phaser).not.toHaveProperty('originX');
    expect(out).toMatchObject({ originX: 0, originY: 0.5 });
    expect(out).not.toHaveProperty('parentId');
  });

  it('warns about names that are not code identifiers', () => {
    const r = parseScene(scene([obj({ name: 'Play Button' }), obj({ id: 'b', name: 'playButton' })]), 'main', 'phaser');
    expect(r.problems.filter(p => p.message.includes('code identifier'))).toHaveLength(1);
    expect(isIdentifier('9lives')).toBe(false);
    expect(toIdentifier('my-sprite 2')).toBe('my_sprite_2');
    expect(toIdentifier('9lives')).toBe('_9lives');
  });
});

describe('engine profile', () => {
  it('warns on extension fields and namespaces not in the active profile', () => {
    const r = parseScene(scene([obj({ phaser: { flipX: true, bogus: 1 }, godot: { x: 1 } })]), 'main', 'phaser');
    const msgs = r.problems.map(p => p.message);
    expect(msgs.some(m => m.includes('"bogus"'))).toBe(true);
    expect(msgs.some(m => m.includes('"godot"'))).toBe(true);
    expect(r.doc.objects[0].flipX).toBe(true);
  });

  it('lists extension keys per profile', () => {
    expect(extensionKeys('phaser')).toEqual(['tint', 'flipX', 'flipY', 'scrollFactorX', 'scrollFactorY']);
    expect(profileKeys('phaser')).toContain('originX');
  });
});
