// Pure operations on a scene's object tree. Every function returns a new scene and never mutates its input; objects
// off the changed path keep their identity, so React and zustand selectors stay cheap on large scenes.
import type { PfObject, PfScene } from './types';
import { isContainer } from './types';

export interface Found {
  obj: PfObject;
  /** null for a top-level object. */
  parent: PfObject | null;
  siblings: PfObject[];
  index: number;
}

export function* walk(objects: PfObject[], parent: PfObject | null = null, depth = 0): Generator<{ obj: PfObject; parent: PfObject | null; depth: number }> {
  for (const obj of objects) {
    yield { obj, parent, depth };
    if (obj.children) yield* walk(obj.children, obj, depth + 1);
  }
}

export function findById(scene: PfScene, id: string): Found | null {
  const search = (siblings: PfObject[], parent: PfObject | null): Found | null => {
    for (let index = 0; index < siblings.length; index++) {
      const obj = siblings[index];
      if (obj.id === id) return { obj, parent, siblings, index };
      if (obj.children) { const hit = search(obj.children, obj); if (hit) return hit; }
    }
    return null;
  };
  return search(scene.objects, null);
}

export const allIds = (scene: PfScene): Set<string> => new Set([...walk(scene.objects)].map(e => e.obj.id));

/** Ids and names of the whole subtree, for uniqueness checks. */
export const subtreeIds = (obj: PfObject): string[] => [...walk([obj])].map(e => e.obj.id);

/** A readable id from any text: lower-case words joined by dashes. */
export function slug(s: string): string {
  const t = s.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return t || 'object';
}

/** `base`, or `base-2`, `base-3`... the first id not in `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const b = slug(base);
  if (!used.has(b)) return b;
  for (let i = 2; ; i++) if (!used.has(`${b}-${i}`)) return `${b}-${i}`;
}

/** Rebuilds the list along the path to `id`, applying `edit` to the sibling list that contains it. */
function editSiblings(objects: PfObject[], parentId: string | null, edit: (siblings: PfObject[]) => PfObject[]): PfObject[] | null {
  if (parentId === null) return edit(objects);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.id === parentId) {
      if (!isContainer(o)) return null;
      const children = edit(o.children ?? []);
      const next = [...objects];
      next[i] = { ...o, children };
      return next;
    }
    if (o.children) {
      const inner = editSiblings(o.children, parentId, edit);
      if (inner) { const next = [...objects]; next[i] = { ...o, children: inner }; return next; }
    }
  }
  return null;
}

/** Inserts under `parentId` (null = top level) at `index` (default: the end). Null if the parent is missing or not a container. */
export function insertObject(scene: PfScene, obj: PfObject, parentId: string | null, index?: number): PfScene | null {
  const objects = editSiblings(scene.objects, parentId, siblings => {
    const next = [...siblings];
    next.splice(index ?? next.length, 0, obj);
    return next;
  });
  return objects && { ...scene, objects };
}

export interface Removed { scene: PfScene; removed: PfObject; parentId: string | null; index: number }

export function removeObject(scene: PfScene, id: string): Removed | null {
  const hit = findById(scene, id);
  if (!hit) return null;
  const parentId = hit.parent?.id ?? null;
  const objects = editSiblings(scene.objects, parentId, siblings => siblings.filter(o => o.id !== id));
  return objects && { scene: { ...scene, objects }, removed: hit.obj, parentId, index: hit.index };
}

/** Moves an object under another parent or to another position. Null when impossible (into itself, into a non-container). */
export function moveObject(scene: PfScene, id: string, newParentId: string | null, index: number): PfScene | null {
  const hit = findById(scene, id);
  if (!hit) return null;
  if (newParentId !== null && subtreeIds(hit.obj).includes(newParentId)) return null;
  const sameParent = (hit.parent?.id ?? null) === newParentId;
  const removed = removeObject(scene, id);
  if (!removed) return null;
  // Removing an earlier sibling shifts the target index down by one.
  const at = sameParent && hit.index < index ? index - 1 : index;
  return insertObject(removed.scene, hit.obj, newParentId, at);
}

/** Shallow-merges `patch` into one object; a value of `undefined` removes the field. Key order of existing fields is kept. */
export function updateObject(scene: PfScene, id: string, patch: Record<string, unknown>): PfScene | null {
  const hit = findById(scene, id);
  if (!hit) return null;
  const next: PfObject = { ...hit.obj };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]; else next[k] = v;
  }
  const objects = editSiblings(scene.objects, hit.parent?.id ?? null, siblings => siblings.map(o => o.id === id ? next : o));
  return objects && { ...scene, objects };
}

/** A deep copy with fresh ids for the whole subtree. A `name` is kept (names need not be unique; ids must). */
export function cloneWithNewIds(obj: PfObject, taken: Iterable<string>): PfObject {
  const used = new Set(taken);
  const copy = (o: PfObject): PfObject => {
    const id = uniqueId(o.id, used);
    used.add(id);
    const out: PfObject = { ...structuredClone({ ...o, children: undefined }), id };
    if (o.children) out.children = o.children.map(copy); else delete out.children;
    return out;
  };
  return copy(obj);
}

/** Visible label: the name when there is one, else the id. */
export const labelOf = (o: PfObject) => (typeof o.name === 'string' && o.name ? o.name : o.id);
