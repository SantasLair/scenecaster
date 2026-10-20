import { describe, expect, it } from 'vitest';
import type { PfObject, PfProject, PfScene } from './types';
import { allIds, cloneWithNewIds, findById, insertObject, moveObject, removeObject, slug, uniqueId, updateObject } from './tree';
import { checkSceneAgainstProject, validateProject, validateScene } from './validate';
import { formatJson, newProject, newScene, scenePathFor } from './format';

const img = (id: string, extra: Partial<PfObject> = {}): PfObject => ({ id, type: 'image', key: 'hero', x: 1, y: 2, ...extra });
const box = (id: string, children: PfObject[] = []): PfObject => ({ id, type: 'container', x: 10, y: 10, children });

function scene(): PfScene {
  return { ...newScene('Main'), objects: [img('a'), box('group', [img('b'), box('inner', [img('c')])]), img('d')] };
}

describe('tree operations', () => {
  it('finds objects at any depth with their parent', () => {
    const hit = findById(scene(), 'c')!;
    expect(hit.parent?.id).toBe('inner');
    expect(hit.index).toBe(0);
    expect(findById(scene(), 'zzz')).toBeNull();
  });

  it('inserts under a container and refuses a non-container parent', () => {
    const s = insertObject(scene(), img('e'), 'group', 1)!;
    expect(findById(s, 'group')!.obj.children!.map(o => o.id)).toEqual(['b', 'e', 'inner']);
    expect(insertObject(scene(), img('e'), 'a')).toBeNull();
    expect(insertObject(scene(), img('e'), 'missing')).toBeNull();
  });

  it('removes an object and reports where it was', () => {
    const r = removeObject(scene(), 'b')!;
    expect(r.parentId).toBe('group');
    expect(r.index).toBe(0);
    expect(allIds(r.scene).has('b')).toBe(false);
    expect(removeObject(scene(), 'nope')).toBeNull();
  });

  it('moves between parents and within one list', () => {
    const s = moveObject(scene(), 'd', 'inner', 0)!;
    expect(findById(s, 'inner')!.obj.children!.map(o => o.id)).toEqual(['d', 'c']);
    expect(s.objects.map(o => o.id)).toEqual(['a', 'group']);
    const t = moveObject(scene(), 'a', null, 3)!; // to the end: the removal shifts the index
    expect(t.objects.map(o => o.id)).toEqual(['group', 'd', 'a']);
  });

  it('refuses to move a container into itself or its descendants', () => {
    expect(moveObject(scene(), 'group', 'inner', 0)).toBeNull();
    expect(moveObject(scene(), 'group', 'group', 0)).toBeNull();
  });

  it('updates fields, keeps key order and removes fields set to undefined', () => {
    const s = updateObject(scene(), 'a', { x: 99, alpha: 0.5, y: undefined })!;
    const a = findById(s, 'a')!.obj;
    expect(Object.keys(a)).toEqual(['id', 'type', 'key', 'x', 'alpha']);
    expect(a.x).toBe(99);
  });

  it('does not mutate its input and shares untouched objects', () => {
    const before = scene();
    const after = updateObject(before, 'b', { x: 5 })!;
    expect(findById(before, 'b')!.obj.x).toBe(1);
    expect(after.objects[0]).toBe(before.objects[0]);
    expect(after.objects[2]).toBe(before.objects[2]);
  });

  it('clones a subtree with fresh unique ids', () => {
    const s = scene();
    const copy = cloneWithNewIds(findById(s, 'group')!.obj, allIds(s));
    const ids = [copy.id, ...copy.children!.map(c => c.id), copy.children![1].children![0].id];
    expect(new Set([...ids, ...allIds(s)]).size).toBe(ids.length + allIds(s).size);
    expect(copy.id).toBe('group-2');
  });

  it('builds readable unique ids', () => {
    expect(slug('Play Button!')).toBe('play-button');
    expect(uniqueId('cloud', ['cloud', 'cloud-2'])).toBe('cloud-3');
    expect(uniqueId('', [])).toBe('object');
  });
});

describe('validation', () => {
  const project: PfProject = { ...newProject('Demo', 'Main', 'scenes/main.phaseform.json'), assets: [{ key: 'hero', type: 'image', url: 'assets/hero.png' }] };

  it('accepts a new scene and project', () => {
    expect(validateScene(newScene('Main'))).toEqual([]);
    expect(validateProject(project)).toEqual([]);
  });

  it('reports schema errors with the object id instead of an index', () => {
    const bad = { ...scene(), objects: [{ id: 'oops', type: 'image', key: 'hero', alpha: 'high' }] };
    const problems = validateScene(bad);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some(p => p.message.includes('"oops"'))).toBe(true);
  });

  it('reports duplicate ids', () => {
    const dup = { ...scene(), objects: [img('x'), img('x')] };
    expect(validateScene(dup).map(p => p.message)).toContain('Duplicate id "x".');
  });

  it('accepts anchors on root objects, warns on a container child and rejects unknown edges', () => {
    const root = { ...newScene('Main'), objects: [{ id: 'hud', type: 'container', anchor: { x: 'right' }, children: [img('kid', { anchor: { y: 'bottom' } })] }] };
    expect(validateScene(root)).toEqual([{ level: 'warning', message: '"kid": anchor is ignored on a child of "hud" (anchors apply to root objects).' }]);
    const bad = { ...newScene('Main'), objects: [img('a', { anchor: { x: 'middle' } })] };
    expect(validateScene(bad).some(p => p.level === 'error')).toBe(true);
  });

  it('reports project problems the schema cannot express', () => {
    const p = { ...project, entry: 'Missing', scenes: [...project.scenes, { key: 'Main', path: 'scenes/other.phaseform.json' }] };
    const msgs = validateProject(p).map(x => x.message);
    expect(msgs).toContain('Duplicate scene key "Main".');
    expect(msgs).toContain('Entry "Missing" is not a scene key.');
  });

  it('warns about textures missing from the manifest', () => {
    const s = { ...scene(), objects: [img('lost', { key: 'nowhere' }), img('ok')] };
    const warns = checkSceneAgainstProject(s, project).map(w => w.message);
    expect(warns).toEqual(['"lost" uses texture "nowhere" which is not in the manifest.']);
  });
});

describe('formatting', () => {
  it('writes two-space JSON with a final newline and is stable', () => {
    const s = scene();
    const text = formatJson(s);
    expect(text.endsWith('}\n')).toBe(true);
    expect(formatJson(JSON.parse(text))).toBe(text);
  });
  it('derives scene file paths from keys', () => {
    expect(scenePathFor('Main Menu')).toBe('scenes/main-menu.phaseform.json');
  });
});
