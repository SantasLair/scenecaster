import { describe, expect, it } from 'vitest';
import { addRename, applyRenamesToScene } from './assets';
import type { PfScene } from './types';

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
