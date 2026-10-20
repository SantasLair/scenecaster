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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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

  describe('asset manifest edits', () => {
    beforeEach(() => {
      vi.stubGlobal('window', { electronAPI: { fileToDataUrl: async () => null } }); // textures are read from disk on rebuild
      model.setProject({
        ...newProject('Demo', 'Main', 'scenes/main.phaseform.json'),
        scenes: [{ key: 'Main', path: 'scenes/main.phaseform.json', assets: ['hero', 'font1'] }],
        assets: [{ key: 'hero', type: 'image', url: 'a/hero.png', note: 'x' }, { key: 'font1', type: 'bitmapFont', url: 'f.png', dataUrl: 'f.xml' }],
        animations: [{ key: 'walk', frames: [{ key: 'hero', frame: 0 }, { key: 'other' }] }],
      });
      model.loadScene({
        ...newScene('Main'),
        objects: [
          img('a'),
          { id: 'g', type: 'container', children: [{ id: 't', type: 'bitmapText', font: 'font1', text: 'hi' }, { ...img('c'), filters: { internal: [{ type: 'mask', texture: 'hero' }] } }] },
        ],
      }, 'scenes/main.phaseform.json', []);
    });

    it('renames an asset everywhere and keeps unknown fields', () => {
      const projectBefore = state().project;
      expect(model.renameAsset('hero', 'knight')).toBe(true);
      const p = state().project!;
      expect(p.assets[0]).toEqual({ key: 'knight', type: 'image', url: 'a/hero.png', note: 'x' });
      expect(p.scenes[0].assets).toEqual(['knight', 'font1']);
      expect((p.animations![0] as { frames: { key: string }[] }).frames.map(f => f.key)).toEqual(['knight', 'other']);
      expect(state().scene.objects[0].key).toBe('knight');
      const c = state().scene.objects[1].children![1];
      expect(c.key).toBe('knight');
      expect((c.filters as { internal: { texture: string }[] }).internal[0].texture).toBe('knight');
      expect(state().scene.objects[1].children![0].font).toBe('font1'); // untouched object keeps identity
      expect(state().project).not.toBe(projectBefore);
    });

    it('refuses a rename to a taken, empty or unknown key', () => {
      expect(model.renameAsset('hero', 'font1')).toBe(false);
      expect(model.renameAsset('hero', '')).toBe(false);
      expect(model.renameAsset('nope', 'x')).toBe(false);
    });

    it('lists the uses of an asset, edits fields and removes it', () => {
      expect(model.usesOfAsset('hero')).toEqual(['object "a"', 'object "c"', 'animation "walk"', 'scene "Main" preload list']);
      expect(model.updateAsset('hero', { url: 'b/hero.png', note: undefined, key: 'ignored' })).toBe(true);
      expect(state().project!.assets[0]).toEqual({ key: 'hero', type: 'image', url: 'b/hero.png' });
      expect(model.removeAsset('hero')).toBe(true);
      expect(state().project!.assets.map(a => a.key)).toEqual(['font1']);
      expect(state().project!.scenes[0].assets).toEqual(['font1']);
      expect(model.removeAsset('hero')).toBe(false);
    });

    it('undoes a rename including the scene', () => {
      const before = model.snapshot();
      model.renameAsset('hero', 'knight');
      model.restore(before);
      expect(state().scene.objects[0].key).toBe('hero');
      expect(state().project!.assets[0].key).toBe('hero');
    });
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
