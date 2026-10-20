import { describe, expect, it } from 'vitest';
import type { PfProject } from './types';
import { newProject, newScene } from './format';
import {
  addAnimation, animationUses, frameMs, removeAnimationKey, renameAnimationKey, uniqueAnimationKey, updateAnimationFields,
} from './animations';

const project = (): PfProject => ({
  ...newProject('d', 'Main', 'p'),
  animations: [{ key: 'walk', frames: [{ key: 'hero', frame: 0 }, { key: 'hero', frame: 1, duration: 100 }], frameRate: 10, note: 'kept' }],
});

describe('animation list', () => {
  it('adds, rejects duplicates and makes unique keys', () => {
    const p = project();
    expect(addAnimation(p, { key: 'walk', frames: [] })).toBeNull();
    expect(addAnimation(p, { key: '', frames: [] })).toBeNull();
    expect(addAnimation(p, { key: 'idle', frames: [{ key: 'hero' }] })!.animations).toHaveLength(2);
    expect(uniqueAnimationKey(p, 'walk')).toBe('walk_2');
    expect(uniqueAnimationKey(p, 'run')).toBe('run');
  });

  it('edits fields, keeps unknown ones and ignores a key change', () => {
    const next = updateAnimationFields(project(), 'walk', { repeat: -1, frameRate: undefined, key: 'x' })!;
    expect(next.animations![0]).toEqual({ key: 'walk', frames: [{ key: 'hero', frame: 0 }, { key: 'hero', frame: 1, duration: 100 }], repeat: -1, note: 'kept' });
    expect(updateAnimationFields(project(), 'nope', {})).toBeNull();
  });

  it('removes an animation', () => {
    expect(removeAnimationKey(project(), 'walk')!.animations).toEqual([]);
    expect(removeAnimationKey(project(), 'nope')).toBeNull();
  });

  it('renames an animation and the objects that play it, at any depth', () => {
    const scene = {
      ...newScene('Main'),
      objects: [
        { id: 'a', type: 'sprite', key: 'hero', animation: { key: 'walk', repeat: 2 } },
        { id: 'g', type: 'container', children: [{ id: 'b', type: 'sprite', key: 'hero', animation: { key: 'walk' } }, { id: 'c', type: 'sprite', key: 'hero', animation: { key: 'other' } }] },
      ],
    };
    expect(animationUses(scene, 'walk')).toEqual(['a', 'b']);
    const r = renameAnimationKey(scene, project(), 'walk', 'run')!;
    expect(r.project.animations![0]).toMatchObject({ key: 'run', note: 'kept' });
    expect(r.scene.objects[0].animation).toEqual({ key: 'run', repeat: 2 });
    expect(r.scene.objects[1].children![0].animation).toEqual({ key: 'run' });
    expect(r.scene.objects[1].children![1]).toBe(scene.objects[1].children![1]);
    expect(renameAnimationKey(scene, project(), 'walk', 'walk')).toBeNull();
    expect(renameAnimationKey(scene, project(), 'nope', 'x')).toBeNull();
  });

  it('works out how long a frame shows', () => {
    const anim = project().animations![0] as Parameters<typeof frameMs>[0];
    expect(frameMs(anim, 0)).toBe(100);
    expect(frameMs(anim, 1)).toBe(200);
    expect(frameMs({ key: 'a', frames: [{ key: 'h' }, { key: 'h' }], duration: 1000 }, 0)).toBe(500);
    expect(frameMs({ key: 'a', frames: [{ key: 'h' }] }, 0)).toBeCloseTo(41.67, 1);
  });
});
