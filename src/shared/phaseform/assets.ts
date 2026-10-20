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

/** Every asset key a scene's objects refer to (images, fonts, filter textures), nested objects included. */
export function sceneAssetKeys(scene: PfScene): Set<string> {
  const keys = new Set<string>();
  for (const o of scene.objects) mapObjectRefs(o, k => { keys.add(k); return k; });
  return keys;
}

/** Keys used by the project's animation frames. Preload lists do not count: listing an asset is not using it. */
export function animationAssetKeys(project: PfProject): Set<string> {
  const keys = new Set<string>();
  mapProjectRefs({ ...project, scenes: [] }, k => { keys.add(k); return k; });
  return keys;
}

/** Every file an asset entry points to, as project-relative paths. */
export function assetFiles(a: PfAsset): string[] {
  const out: string[] = [];
  for (const f of ['url', 'atlasUrl', 'dataUrl'] as const) if (typeof a[f] === 'string' && a[f]) out.push(a[f] as string);
  if (Array.isArray(a.urls)) for (const u of a.urls) if (typeof u === 'string' && u) out.push(u);
  return out;
}

export interface AssetReport {
  /** Entries no scene object or animation uses. The game's own code may still use them. */
  unused: string[];
  /** Entries whose file is not on disk: key and the missing paths. */
  missing: { key: string; files: string[] }[];
}

/** Compares the manifest with what the scenes use (`used`) and with the files that exist (`missingFiles`). */
export function buildAssetReport(project: PfProject, used: Set<string>, missingFiles: Set<string>): AssetReport {
  const unused = project.assets.filter(a => !used.has(a.key)).map(a => a.key);
  const missing = project.assets
    .map(a => ({ key: a.key, files: assetFiles(a).filter(f => missingFiles.has(f)) }))
    .filter(m => m.files.length > 0);
  return { unused, missing };
}

export interface AssetRename { from: string; to: string }

/** Applies recorded renames, in order, to the objects of a scene that is not open. The same scene back if nothing changed. */
export function applyRenamesToScene(scene: PfScene, renames: AssetRename[]): PfScene {
  let objects = scene.objects;
  for (const r of renames) {
    const fn = (k: string) => (k === r.from ? r.to : k);
    const mapped = objects.map(o => mapObjectRefs(o, fn));
    if (mapped.some((o, i) => o !== objects[i])) objects = mapped;
  }
  return objects === scene.objects ? scene : { ...scene, objects };
}

/** Adds a rename to a pending list, folding chains: a->b then b->c is a->c, and a->b then b->a cancels out. */
export function addRename(list: AssetRename[], from: string, to: string): AssetRename[] {
  const i = list.findIndex(r => r.to === from);
  if (i < 0) return [...list, { from, to }];
  const merged = { from: list[i].from, to };
  const rest = list.filter((_, j) => j !== i);
  return merged.from === merged.to ? rest : [...rest, merged];
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
