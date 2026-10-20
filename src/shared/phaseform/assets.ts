// Pure operations on the project's asset manifest and the places that refer to an asset by key: scene objects (image,
// sprite and tileSprite `key`, bitmapText `font`, filter textures), animation frames and a scene entry's `assets` list.
// Like tree.ts, nothing is mutated; untouched objects keep their identity and unknown fields survive.
import type { PfAsset, PfObject, PfProject, PfScene } from './types';

const FILTER_TEXTURE_FIELDS = ['texture', 'normalMap', 'environmentMap'] as const;
const TEXTURE_TYPES = new Set(['image', 'sprite', 'tileSprite']);

type Filters = { internal?: Record<string, unknown>[]; external?: Record<string, unknown>[] };

/** Applies `fn` to every key field of one object: returns the changed object, or the same one if nothing changed. */
function mapObjectRefs(o: PfObject, fn: (key: string) => string): PfObject {
  let next = o;
  const set = (field: string, value: unknown) => { if (next === o) next = { ...o }; next[field] = value; };
  if (TEXTURE_TYPES.has(o.type) && typeof o.key === 'string' && fn(o.key) !== o.key) set('key', fn(o.key));
  if (o.type === 'bitmapText' && typeof o.font === 'string' && fn(o.font) !== o.font) set('font', fn(o.font));
  const filters = o.filters as Filters | undefined;
  if (filters) {
    const mapList = (list?: Record<string, unknown>[]) => {
      let changed = false;
      const out = list?.map(f => {
        let g = f;
        for (const field of FILTER_TEXTURE_FIELDS) {
          const v = f[field];
          if (typeof v === 'string' && fn(v) !== v) { if (g === f) g = { ...f }; g[field] = fn(v); changed = true; }
        }
        return g;
      });
      return changed ? out : list;
    };
    const internal = mapList(filters.internal);
    const external = mapList(filters.external);
    if (internal !== filters.internal || external !== filters.external) {
      const merged: Filters = { ...filters };
      if (internal) merged.internal = internal;
      if (external) merged.external = external;
      set('filters', merged);
    }
  }
  if (o.children) {
    const children = o.children.map(c => mapObjectRefs(c, fn));
    if (children.some((c, i) => c !== o.children![i])) set('children', children);
  }
  return next;
}

function mapProjectRefs(project: PfProject, fn: (key: string) => string): PfProject {
  let next = project;
  const animations = project.animations?.map(a => {
    const anim = a as { frames?: { key?: unknown }[] };
    if (!Array.isArray(anim.frames)) return a;
    const frames = anim.frames.map(f => typeof f.key === 'string' && fn(f.key) !== f.key ? { ...f, key: fn(f.key) } : f);
    return frames.some((f, i) => f !== anim.frames![i]) ? { ...anim, frames } : a;
  });
  if (animations && animations.some((a, i) => a !== project.animations![i])) next = { ...next, animations };
  const scenes = project.scenes.map(s => {
    if (!s.assets) return s;
    const list = s.assets.map(fn);
    return list.some((k, i) => k !== s.assets![i]) ? { ...s, assets: list } : s;
  });
  if (scenes.some((s, i) => s !== project.scenes[i])) next = { ...next, scenes };
  return next;
}

/** Human-readable places that use `key`: for the delete warning and the rename report. */
export function assetUses(scene: PfScene, project: PfProject | null, key: string): string[] {
  const flat: string[] = [];
  // Mapping `key` to a marker and checking for a changed object finds a reference without a second field list.
  const marker = (k: string) => (k === key ? '\0' : k);
  const visit = (objects: PfObject[]) => {
    for (const o of objects) {
      const { children, ...own } = o;
      if (mapObjectRefs(own as PfObject, marker) !== own) flat.push(`object "${o.id}"`);
      if (children) visit(children);
    }
  };
  visit(scene.objects);
  if (project) {
    for (const a of project.animations ?? []) {
      const anim = a as { key?: string; frames?: { key?: unknown }[] };
      if (anim.frames?.some(f => f.key === key)) flat.push(`animation "${anim.key ?? '?'}"`);
    }
    for (const s of project.scenes) if (s.assets?.includes(key)) flat.push(`scene "${s.key}" preload list`);
  }
  return flat;
}

/** Renames an asset and every reference in the open scene and the project. Null if the old key is missing or the new one is taken or empty. */
export function renameAssetKey(scene: PfScene, project: PfProject, oldKey: string, newKey: string): { scene: PfScene; project: PfProject } | null {
  if (!newKey || newKey === oldKey) return null;
  if (!project.assets.some(a => a.key === oldKey) || project.assets.some(a => a.key === newKey)) return null;
  const fn = (k: string) => (k === oldKey ? newKey : k);
  const objects = scene.objects.map(o => mapObjectRefs(o, fn));
  const nextScene = objects.some((o, i) => o !== scene.objects[i]) ? { ...scene, objects } : scene;
  const refs = mapProjectRefs(project, fn);
  return { scene: nextScene, project: { ...refs, assets: refs.assets.map(a => (a.key === oldKey ? { ...a, key: newKey } : a)) } };
}

/** Merges `patch` into one asset (`undefined` removes a field). The key is not changed here: use renameAssetKey. */
export function updateAssetFields(project: PfProject, key: string, patch: Record<string, unknown>): PfProject | null {
  const index = project.assets.findIndex(a => a.key === key);
  if (index < 0) return null;
  const next: PfAsset = { ...project.assets[index] };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'key') continue;
    if (v === undefined) delete next[k]; else next[k] = v;
  }
  const assets = [...project.assets];
  assets[index] = next;
  return { ...project, assets };
}

/** Removes an asset from the manifest and from every scene entry's preload list. Scene objects that use it are left alone (they get a warning). */
export function removeAssetKey(project: PfProject, key: string): PfProject | null {
  if (!project.assets.some(a => a.key === key)) return null;
  const scenes = project.scenes.map(s => (s.assets?.includes(key) ? { ...s, assets: s.assets.filter(k => k !== key) } : s));
  return { ...project, assets: project.assets.filter(a => a.key !== key), scenes };
}
