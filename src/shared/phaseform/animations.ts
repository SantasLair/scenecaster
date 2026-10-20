// Pure operations on the project's `animations` list. Animations are global to the game: a sprite refers to one by
// `animation.key`. Like assets.ts, nothing is mutated and fields the editor does not know are kept.
import type { PfObject, PfProject, PfScene } from './types';
import { walk } from './tree';

export interface PfAnimFrame { key: string; frame?: number | string; duration?: number; [field: string]: unknown }
export interface PfAnimation {
  key: string;
  frames: PfAnimFrame[];
  frameRate?: number;
  duration?: number;
  delay?: number;
  repeat?: number;
  repeatDelay?: number;
  yoyo?: boolean;
  [field: string]: unknown;
}

export const animationList = (project: PfProject | null): PfAnimation[] => (project?.animations ?? []) as PfAnimation[];

/** `base`, or `base_2`, `base_3`... the first animation key not in use. */
export function uniqueAnimationKey(project: PfProject, base: string): string {
  const used = new Set(animationList(project).map(a => a.key));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Appends an animation. Null if the key is empty or already used. */
export function addAnimation(project: PfProject, anim: PfAnimation): PfProject | null {
  if (!anim.key || animationList(project).some(a => a.key === anim.key)) return null;
  return { ...project, animations: [...animationList(project), anim] };
}

/** Merges `patch` into one animation (`undefined` removes a field). The key changes only through renameAnimation. */
export function updateAnimationFields(project: PfProject, key: string, patch: Record<string, unknown>): PfProject | null {
  const list = animationList(project);
  const index = list.findIndex(a => a.key === key);
  if (index < 0) return null;
  const next: PfAnimation = { ...list[index] };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'key') continue;
    if (v === undefined) delete next[k]; else next[k] = v;
  }
  const animations = [...list];
  animations[index] = next;
  return { ...project, animations };
}

export function removeAnimationKey(project: PfProject, key: string): PfProject | null {
  const list = animationList(project);
  if (!list.some(a => a.key === key)) return null;
  return { ...project, animations: list.filter(a => a.key !== key) };
}

const playsKey = (o: PfObject, key: string) => !!o.animation && typeof o.animation === 'object' && (o.animation as { key?: unknown }).key === key;

/** Ids of the objects in the scene that play `key`. */
export function animationUses(scene: PfScene, key: string): string[] {
  return [...walk(scene.objects)].filter(e => playsKey(e.obj, key)).map(e => e.obj.id);
}

function mapObjects(objects: PfObject[], fn: (o: PfObject) => PfObject): PfObject[] {
  return objects.map(o => {
    const mapped = fn(o);
    if (!o.children) return mapped;
    const children = mapObjects(o.children, fn);
    return children.some((c, i) => c !== o.children![i]) ? { ...mapped, children } : mapped;
  });
}

/** Renames an animation and the `animation.key` of every object in the open scene that plays it. Null if the key is missing, empty or taken. */
export function renameAnimationKey(scene: PfScene, project: PfProject, oldKey: string, newKey: string): { scene: PfScene; project: PfProject } | null {
  const list = animationList(project);
  if (!newKey || newKey === oldKey || !list.some(a => a.key === oldKey) || list.some(a => a.key === newKey)) return null;
  const objects = mapObjects(scene.objects, o => (playsKey(o, oldKey) ? { ...o, animation: { ...(o.animation as object), key: newKey } } : o));
  const nextScene = objects.some((o, i) => o !== scene.objects[i]) ? { ...scene, objects } : scene;
  return { scene: nextScene, project: { ...project, animations: list.map(a => (a.key === oldKey ? { ...a, key: newKey } : a)) } };
}

/** Milliseconds each frame stays on screen: from `frameRate`, else `duration`, else Phaser's default of 24 fps, plus the frame's own `duration`. */
export function frameMs(anim: PfAnimation, index: number): number {
  const count = Math.max(anim.frames.length, 1);
  const base = typeof anim.frameRate === 'number' && anim.frameRate > 0 ? 1000 / anim.frameRate
    : typeof anim.duration === 'number' && anim.duration > 0 ? anim.duration / count
    : 1000 / 24;
  const extra = anim.frames[index]?.duration;
  return base + (typeof extra === 'number' && extra > 0 ? extra : 0);
}
