import { describe, expect, it } from 'vitest';
import { formatScene, parseScene, uniqueName, SCENE_VERSION } from './scene';

const obj = (over: Record<string, unknown> = {}) =>
  ({ id: 'a', name: 'Box', kind: 'primitive', shape: 'rect', parentId: null, ...over });
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
    expect(uniqueName('Box', ['box', 'Box 2'])).toBe('Box 3');
    expect(uniqueName('Box', [])).toBe('Box');
  });
});
