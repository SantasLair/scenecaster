import { describe, expect, it } from 'vitest';
import { addRename, animationAssetKeys, applyRenamesToScene, assetFiles, buildAssetReport, sceneAssetKeys } from './assets';
import type { PfProject, PfScene } from './types';

const scene = (objects: PfScene['objects']): PfScene => ({ format: 'phaseform', version: '0.1', key: 'S', size: { width: 10, height: 10 }, objects } as PfScene);

describe('asset renames across scene files', () => {
  it('rewrites keys in nested objects and leaves unrelated objects and fields alone', () => {
    const keep = { id: 'b', type: 'image', key: 'other', extra: 1 };
    const s = scene([
      { id: 'a', type: 'container', children: [{ id: 'c', type: 'sprite', key: 'old', mystery: true }] },
      keep,
      { id: 't', type: 'bitmapText', font: 'old', text: 'x' },
    ] as PfScene['objects']);
    const out = applyRenamesToScene(s, [{ from: 'old', to: 'new' }]);
    expect(out.objects[0].children![0]).toMatchObject({ key: 'new', mystery: true });
    expect(out.objects[1]).toBe(keep);
    expect(out.objects[2].font).toBe('new');
  });

  it('returns the same scene when nothing uses the old key', () => {
    const s = scene([{ id: 'a', type: 'image', key: 'x' }] as PfScene['objects']);
    expect(applyRenamesToScene(s, [{ from: 'old', to: 'new' }])).toBe(s);
  });

  it('applies a chain of renames in order', () => {
    const s = scene([{ id: 'a', type: 'image', key: 'a' }] as PfScene['objects']);
    expect(applyRenamesToScene(s, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]).objects[0].key).toBe('c');
  });

  it('folds pending renames so a round trip cancels out', () => {
    expect(addRename([{ from: 'a', to: 'b' }], 'b', 'c')).toEqual([{ from: 'a', to: 'c' }]);
    expect(addRename([{ from: 'a', to: 'b' }], 'b', 'a')).toEqual([]);
    expect(addRename([{ from: 'a', to: 'b' }], 'x', 'y')).toEqual([{ from: 'a', to: 'b' }, { from: 'x', to: 'y' }]);
  });
});

describe('asset report', () => {
  const project = {
    format: 'phaseform-project', version: '0.1.0', name: 'p', entry: 'S', scenes: [{ key: 'S', path: 's', assets: ['preloaded'] }],
    assets: [
      { key: 'hero', type: 'image', url: 'a/hero.png' },
      { key: 'atlas', type: 'atlas', url: 'a/at.png', atlasUrl: 'a/at.json' },
      { key: 'boom', type: 'audio', urls: ['a/boom.mp3', 'a/boom.ogg'] },
      { key: 'preloaded', type: 'image', url: 'a/p.png' },
      { key: 'walkSheet', type: 'spritesheet', url: 'a/w.png' },
    ],
    animations: [{ key: 'walk', frames: [{ key: 'walkSheet' }] }],
  } as unknown as PfProject;

  it('collects keys from nested objects, fonts and animation frames, not from preload lists', () => {
    const s = scene([{ id: 'c', type: 'container', children: [{ id: 'i', type: 'image', key: 'hero' }] }, { id: 't', type: 'bitmapText', font: 'atlas' }] as PfScene['objects']);
    expect([...sceneAssetKeys(s)].sort()).toEqual(['atlas', 'hero']);
    expect([...animationAssetKeys(project)]).toEqual(['walkSheet']);
  });

  it('lists every file of an entry', () => {
    expect(assetFiles(project.assets[1])).toEqual(['a/at.png', 'a/at.json']);
    expect(assetFiles(project.assets[2])).toEqual(['a/boom.mp3', 'a/boom.ogg']);
  });

  it('reports unused entries and the missing files per entry', () => {
    const r = buildAssetReport(project, new Set(['hero', 'atlas', 'walkSheet']), new Set(['a/at.json', 'a/boom.ogg']));
    expect(r.unused).toEqual(['boom', 'preloaded']);
    expect(r.missing).toEqual([{ key: 'atlas', files: ['a/at.json'] }, { key: 'boom', files: ['a/boom.ogg'] }]);
  });
});
