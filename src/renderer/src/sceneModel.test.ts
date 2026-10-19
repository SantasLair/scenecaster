import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorToViewport } from '../../shared/protocol';
import type { PfObject } from '../../shared/phaseform/types';
import { newProject, newScene } from '../../shared/phaseform/format';
import * as model from './sceneModel';
import { useSceneModel } from './sceneModel';

const state = () => useSceneModel.getState();
const img = (id: string): PfObject => ({ id, type: 'image', key: 'hero', x: 1, y: 2 });
const ids = () => state().scene.objects.map(o => o.id);

let sent: EditorToViewport[];

beforeEach(async () => {
  vi.useFakeTimers();
  sent = [];
  model.bindView(m => sent.push(m), 'C:/proj');
  model.setProject(newProject('Demo', 'Main', 'scenes/main.phaseform.json'));
  model.loadScene({ ...newScene('Main'), objects: [img('a'), img('b')] }, 'scenes/main.phaseform.json', []);
  await vi.runAllTimersAsync(); // the initial push
  sent = [];
});
afterEach(() => { vi.useRealTimers(); });

describe('scene model', () => {
  it('counts a loaded scene as saved and an edit as unsaved', () => {
    expect(state().rev).toBe(state().savedRev);
    model.update('a', { x: 5 });
    expect(state().rev).not.toBe(state().savedRev);
    model.markSaved(state().rev);
    expect(state().rev).toBe(state().savedRev);
  });

  it('applies transform edits in place without rebuilding the viewport', async () => {
    model.update('a', { x: 9, scale: { x: 2, y: 2 } });
    await vi.runAllTimersAsync();
    expect(sent).toEqual([{ type: 'SET_OBJECT', id: 'a', patch: { x: 9, scale: { x: 2, y: 2 } } }]);
  });

  it('rebuilds the viewport once for other edits, however many keystrokes', async () => {
    model.update('a', { key: 'h' });
    model.update('a', { key: 'he' });
    model.update('a', { key: 'hero2' });
    await vi.runAllTimersAsync();
    expect(sent.map(m => m.type)).toEqual(['LOAD_SCENE']);
    expect((sent[0] as Extract<EditorToViewport, { type: 'LOAD_SCENE' }>).scene.objects[0].key).toBe('hero2');
  });

  it('does not tell the viewport about changes it made itself', async () => {
    model.update('a', { x: 3, y: 4 }, false);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
    expect(state().scene.objects[0].x).toBe(3);
  });

  it('inserts, moves and removes objects and rebuilds', async () => {
    model.insert({ id: 'g', type: 'container', children: [] }, null);
    expect(model.insert(img('c'), 'g')).toBe(true);
    expect(model.insert(img('x'), 'a')).toBe(false); // not a container
    expect(model.move('b', 'g', 0)).toBe(true);
    expect(ids()).toEqual(['a', 'g']);
    expect(model.remove('c')?.parentId).toBe('g');
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.type === 'LOAD_SCENE')).toHaveLength(1);
  });

  it('restores a snapshot (undo) including the project manifest', () => {
    const before = model.snapshot();
    model.addAsset({ key: 'new', type: 'image', url: 'assets/new.png' });
    model.insert(img('c'), null);
    expect(state().project!.assets).toHaveLength(1);
    model.restore(before);
    expect(ids()).toEqual(['a', 'b']);
    expect(state().project!.assets).toHaveLength(0);
  });

  it('keeps fields it does not know and their order', () => {
    model.loadScene({ ...newScene('Main'), extensions: { tool: 1 }, objects: [{ ...img('a'), filters: { internal: [] }, custom: 'kept' }] }, 'scenes/main.phaseform.json', []);
    model.update('a', { x: 7 });
    expect(Object.keys(state().scene.objects[0])).toEqual(['id', 'type', 'key', 'x', 'y', 'filters', 'custom']);
    expect(state().scene.extensions).toEqual({ tool: 1 });
  });

  it('works out which textures a scene needs', () => {
    const project = { ...newProject('d', 'Main', 'p'), animations: [{ key: 'spin', frames: [{ key: 'coin1' }, { key: 'coin2' }] }] };
    const scene = { ...newScene('Main'), objects: [img('a'), { id: 'b', type: 'sprite', key: 'coin1', animation: { key: 'spin' } }, { id: 'c', type: 'rectangle' }] };
    expect([...model.usedTextureKeys(scene, project)].sort()).toEqual(['coin1', 'coin2', 'hero']);
  });

  it('turns a path inside the project into a relative one', () => {
    expect(model.relativePath('C:\\proj\\assets\\a.png')).toBe('assets/a.png');
    expect(model.relativePath('C:/elsewhere/a.png')).toBeNull();
  });
});
