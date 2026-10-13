// The scene model: the source of truth for what is in the scene. The Phaser viewport is only a view of it,
// kept in sync through the sink set by bindView. Every mutation here bumps `rev` (for dirty tracking).
import { create } from 'zustand';
import type { EditorToViewport, LoadSceneObject, SceneObject } from '../../shared/protocol';
import type { ObjectProps } from '../../shared/props';
import { SCENE_VERSION, type SceneDoc, type SceneProblem } from '../../shared/scene';

interface ModelState {
  doc: SceneDoc;
  /** Bumped on every change. */
  rev: number;
  /** The rev last written to disk successfully. */
  savedRev: number;
  problems: SceneProblem[];
  /** The scene file on disk could not be read or understood: the (empty) scene must never be saved over it. */
  blocked: boolean;
}

const emptyDoc = (key: string): SceneDoc => ({ version: SCENE_VERSION, key, overlay: false, objects: [] });

export const useSceneModel = create<ModelState>(() => ({ doc: emptyDoc('main'), rev: 0, savedRev: 0, problems: [], blocked: false }));

const get = () => useSceneModel.getState();
const set = useSceneModel.setState;

let sink: (m: EditorToViewport) => void = () => {};
let projectFolder: string | null = null;
const textures = new Map<string, string>();

/** Connects the model to the viewport and tells it which project its relative asset paths are in. */
export function bindView(send: (m: EditorToViewport) => void, folder: string | null) {
  sink = send;
  if (folder !== projectFolder) textures.clear();
  projectFolder = folder;
}

export const objectById = (id: string): SceneObject | undefined => get().doc.objects.find(o => o.id === id);

/** Path relative to the project folder, with forward slashes, or null if the file is outside it. */
export function relativeAsset(fullPath: string): string | null {
  if (!projectFolder) return null;
  const norm = (p: string) => p.split(String.fromCharCode(92)).join("/");
  const base = norm(projectFolder).replace(/\/$/, '') + '/';
  const p = norm(fullPath);
  return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : null;
}

export function primeTexture(asset: string, dataUrl: string | undefined) {
  if (dataUrl) textures.set(asset, dataUrl);
}

/** Texture data for a sprite asset, cached. Undefined when the file is missing. */
export async function loadTexture(asset: string): Promise<string | undefined> {
  const hit = textures.get(asset);
  if (hit) return hit;
  if (!projectFolder) return undefined;
  const url = await window.electronAPI.fileToDataUrl(`${projectFolder}/${asset}`);
  if (url) textures.set(asset, url);
  return url ?? undefined;
}

const withTexture = (o: SceneObject): LoadSceneObject =>
  o.kind === 'sprite' && textures.has(o.asset) ? { ...o, dataUrl: textures.get(o.asset) } : o;

const bump = (doc: SceneDoc) => set(s => ({ doc, rev: s.rev + 1 }));

/** Replaces the whole scene (open project, reload). Not a change: the result is saved state. */
export async function loadDoc(doc: SceneDoc, problems: SceneProblem[], blocked = false) {
  await Promise.all(doc.objects.flatMap(o => o.kind === 'sprite' ? [loadTexture(o.asset)] : []));
  const missing = doc.objects.flatMap(o =>
    o.kind === 'sprite' && !textures.has(o.asset)
      ? [{ level: 'warning' as const, message: `"${o.name}": asset not found: ${o.asset}` }] : []);
  set(s => ({ doc, rev: s.rev + 1, savedRev: s.rev + 1, problems: [...problems, ...missing], blocked }));
  pushAll();
}

export function resetDoc(key: string) {
  set(s => ({ doc: emptyDoc(key), rev: s.rev + 1, savedRev: s.rev + 1, problems: [], blocked: false }));
}

/** The file exists but cannot be used: show an empty scene, report why, and refuse to save. */
export function blockDoc(key: string, problems: SceneProblem[]) {
  set(s => ({ doc: emptyDoc(key), rev: s.rev + 1, savedRev: s.rev + 1, problems, blocked: true }));
  pushAll();
}

/** Sends the current model to the viewport (after its iframe was recreated). */
export function pushAll() {
  sink({ type: 'LOAD_SCENE', objects: get().doc.objects.map(withTexture) });
}

export function markSaved(rev: number) { set({ savedRev: rev }); }

/** Inserts at `index` (default: the end); returns the index used. */
export function insertObject(obj: SceneObject, index = get().doc.objects.length, select = true): number {
  const { doc } = get();
  const objects = [...doc.objects];
  objects.splice(index, 0, obj);
  bump({ ...doc, objects });
  const send = () => { if (objectById(obj.id)) sink({ type: 'ADD_OBJECT', object: withTexture(obj), select }); };
  if (obj.kind === 'sprite' && !textures.has(obj.asset)) void loadTexture(obj.asset).then(send); else send();
  return index;
}

/** Removes an object; returns what is needed to put it back. */
export function removeObject(id: string): { obj: SceneObject; index: number } | null {
  const { doc } = get();
  const index = doc.objects.findIndex(o => o.id === id);
  if (index < 0) return null;
  bump({ ...doc, objects: doc.objects.filter(o => o.id !== id) });
  sink({ type: 'DELETE_OBJECT', id });
  return { obj: doc.objects[index], index };
}

export function setName(id: string, name: string) {
  bump({ ...get().doc, objects: get().doc.objects.map(o => o.id === id ? { ...o, name } : o) });
}

/** Changes properties in the model; `toView` also tells the viewport (false when the viewport made the change). */
export function setProps(id: string, props: Partial<ObjectProps>, toView = true) {
  if (!objectById(id)) return;
  bump({ ...get().doc, objects: get().doc.objects.map(o => o.id === id ? { ...o, ...props } : o) });
  if (toView) sink({ type: 'SET_PROPERTIES', id, ...props });
}
