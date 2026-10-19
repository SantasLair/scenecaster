// The editor's model: the open PHASEFORM scene and project, and the single source of truth for what is in them.
// The Phaser viewport is only a view, kept in sync through the sink set by bindView: structural changes rebuild it
// (debounced), plain transform edits are applied in place. Documents are kept as plain JSON, so fields the editor does
// not know survive a load and save. Every mutation bumps a revision for dirty tracking.
import { create } from 'zustand';
import type { EditorToViewport, LiveField, ViewAsset } from '../../shared/protocol';
import { LIVE_FIELDS } from '../../shared/protocol';
import type { PfAsset, PfObject, PfProject, PfScene, Problem } from '../../shared/phaseform/types';
import { newScene } from '../../shared/phaseform/format';
import { insertObject, moveObject, removeObject, updateObject, walk, findById, type Removed } from '../../shared/phaseform/tree';
import { checkSceneAgainstProject, validateScene } from '../../shared/phaseform/validate';
import { useEditorStore } from './store';

export type SceneStatus = 'none' | 'loading' | 'open' | 'blocked';

interface ModelState {
  scene: PfScene;
  /** The project manifest; null until a project file exists or has been created in memory. */
  project: PfProject | null;
  /** Scene file path relative to the project root (null for a scene that has no file yet). */
  scenePath: string | null;
  rev: number;
  savedRev: number;
  projectRev: number;
  projectSavedRev: number;
  /** Validation of the loaded document, plus what the viewport reported when it built the scene. */
  problems: Problem[];
  viewWarnings: string[];
  /** The file exists but could not be read or understood: the (empty) scene must never be saved over it. */
  blocked: boolean;
  status: SceneStatus;
}

const emptyScene = (key = 'Main'): PfScene => newScene(key);

export const useSceneModel = create<ModelState>(() => ({
  scene: emptyScene(), project: null, scenePath: null, rev: 0, savedRev: 0, projectRev: 0, projectSavedRev: 0,
  problems: [], viewWarnings: [], blocked: false, status: 'none',
}));

const get = () => useSceneModel.getState();
const set = useSceneModel.setState;

let sink: (m: EditorToViewport) => void = () => {};
let projectFolder: string | null = null;

/** Data URLs already read from disk, by file path (relative to the project). */
const dataUrls = new Map<string, string>();
/** key -> url of the textures the current viewport already has; reset whenever the viewport is recreated. */
let viewHas = new Map<string, string>();
let pushVersion = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;

/** Connects the model to the viewport and tells it which project its relative asset paths are in. */
export function bindView(send: (m: EditorToViewport) => void, folder: string | null) {
  sink = send;
  if (folder !== projectFolder) { dataUrls.clear(); viewHas = new Map(); }
  projectFolder = folder;
}

/** The viewport (iframe) was created or reloaded: it has no textures yet. */
export function viewportReady() { viewHas = new Map(); }

export const sceneObject = (id: string): PfObject | undefined => findById(get().scene, id)?.obj;

export const textureAssets = (project: PfProject | null): PfAsset[] => (project?.assets ?? []).filter(a => a.type === 'image' || a.type === 'spritesheet' || a.type === 'atlas');

/** Path relative to the project folder, with forward slashes, or null if the file is outside it. */
export function relativePath(fullPath: string): string | null {
  if (!projectFolder) return null;
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/');
  const base = norm(projectFolder).replace(/\/$/, '') + '/';
  const p = norm(fullPath);
  return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : null;
}

async function dataUrlOf(url: string): Promise<string | undefined> {
  const hit = dataUrls.get(url);
  if (hit) return hit;
  if (!projectFolder) return undefined;
  const data = await window.electronAPI.fileToDataUrl(`${projectFolder}/${url}`);
  if (data) dataUrls.set(url, data);
  return data ?? undefined;
}

/** Texture keys a scene needs: object textures, filter textures and the frames of the animations it plays. */
export function usedTextureKeys(scene: PfScene, project: PfProject | null): Set<string> {
  const keys = new Set<string>();
  const anims = new Map<string, unknown[]>();
  for (const a of (project?.animations ?? []) as { key?: string; frames?: unknown[] }[]) if (a.key) anims.set(a.key, a.frames ?? []);
  for (const { obj } of walk(scene.objects)) {
    if ((obj.type === 'image' || obj.type === 'sprite' || obj.type === 'tileSprite') && typeof obj.key === 'string') keys.add(obj.key);
    const anim = obj.animation as { key?: string } | undefined;
    if (anim?.key) for (const f of anims.get(anim.key) ?? []) if (typeof (f as { key?: string }).key === 'string') keys.add((f as { key: string }).key);
    const filters = obj.filters as { internal?: unknown[]; external?: unknown[] } | undefined;
    for (const f of [...(filters?.internal ?? []), ...(filters?.external ?? [])] as Record<string, unknown>[]) {
      for (const field of ['texture', 'normalMap', 'environmentMap']) if (typeof f[field] === 'string') keys.add(f[field] as string);
    }
  }
  return keys;
}

/** The textures the viewport does not have yet, read from disk. Missing files are reported as problems. */
async function newViewAssets(scene: PfScene, project: PfProject | null): Promise<{ assets: ViewAsset[]; missing: string[] }> {
  const assets: ViewAsset[] = [];
  const missing: string[] = [];
  const wanted = usedTextureKeys(scene, project);
  await Promise.all(textureAssets(project).filter(a => wanted.has(a.key)).map(async a => {
    if ((a.type !== 'image' && a.type !== 'spritesheet') || typeof a.url !== 'string') return;
    if (viewHas.get(a.key) === `${a.url}|${a.frameWidth}|${a.frameHeight}`) return;
    const dataUrl = await dataUrlOf(a.url);
    if (!dataUrl) { missing.push(`Texture file not found: ${a.url} (asset "${a.key}").`); return; }
    const base = { key: a.key, dataUrl };
    assets.push(a.type === 'image' ? { ...base, type: 'image' }
      : { ...base, type: 'spritesheet', frameWidth: a.frameWidth as number, frameHeight: a.frameHeight as number,
          margin: a.margin as number | undefined, spacing: a.spacing as number | undefined, startFrame: a.startFrame as number | undefined, endFrame: a.endFrame as number | undefined });
    viewHas.set(a.key, `${a.url}|${a.frameWidth}|${a.frameHeight}`);
  }));
  return { assets, missing };
}

/** Sends the whole scene to the viewport now. Superseded pushes (a newer one started meanwhile) are dropped. */
export async function pushAll() {
  const version = ++pushVersion;
  const { scene, project } = get();
  const { assets, missing } = await newViewAssets(scene, project);
  if (version !== pushVersion) return;
  if (missing.length) set(s => ({ problems: [...s.problems.filter(p => !missing.includes(p.message)), ...missing.map(message => ({ level: 'warning' as const, message }))] }));
  sink({ type: 'LOAD_SCENE', scene, assets, animations: (project?.animations as unknown[]) ?? [], selectedId: useEditorStore.getState().selectedId });
}

/** Rebuilds the viewport soon; typing in a field must not rebuild a large scene on every keystroke. */
function schedulePush(delay = 120) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; void pushAll(); }, delay);
}

function revalidateSoon() {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = null;
    const { scene, project, status, blocked, scenePath } = get();
    if (status !== 'open' || blocked) return;
    const entry = project?.scenes.find(e => e.path === scenePath);
    const problems = [...validateScene(scene), ...(project ? checkSceneAgainstProject(scene, project, entry) : [])];
    set({ problems });
  }, 400);
}

export function setViewWarnings(warnings: string[]) { set({ viewWarnings: warnings }); }

/** All problems to show: the document's, then the viewport's. */
export const allProblems = (s: Pick<ModelState, 'problems' | 'viewWarnings'>): Problem[] =>
  [...s.problems, ...s.viewWarnings.map(message => ({ level: 'warning' as const, message }))];

const touched = (patch: Record<string, unknown>) => Object.keys(patch).every(k => (LIVE_FIELDS as readonly string[]).includes(k));

function bump(scene: PfScene) { set(s => ({ scene, rev: s.rev + 1 })); revalidateSoon(); }

// ---- Loading ---------------------------------------------------------------------------------------------------

/** Replaces the open scene (open project, switch scene, reload from disk). The result counts as saved state. */
export function loadScene(scene: PfScene, scenePath: string | null, problems: Problem[], blocked = false) {
  set(s => ({ scene, scenePath, rev: s.rev + 1, savedRev: s.rev + 1, problems, viewWarnings: [], blocked, status: blocked ? 'blocked' : 'open' }));
  void pushAll();
}

/** An empty scene: status 'none' when there is no scene, 'open' for one just created (dirty until saved). */
export function resetScene(key: string, status: SceneStatus = 'none', scenePath: string | null = null, size?: { width: number; height: number }) {
  set(s => ({
    scene: newScene(key, size), scenePath, rev: s.rev + 1, savedRev: status === 'open' ? s.rev : s.rev + 1,
    problems: [], viewWarnings: [], blocked: false, status,
  }));
  if (status === 'open') void pushAll();
}

/** The file exists but cannot be used: show an empty scene, report why, and refuse to save. */
export function blockScene(key: string, scenePath: string | null, problems: Problem[]) {
  set(s => ({ scene: emptyScene(key), scenePath, rev: s.rev + 1, savedRev: s.rev + 1, problems, viewWarnings: [], blocked: true, status: 'blocked' }));
}

export const setLoading = () => set({ status: 'loading' });

export function setProject(project: PfProject | null, dirty = false) {
  set(s => ({ project, projectRev: s.projectRev + 1, projectSavedRev: dirty ? s.projectRev : s.projectRev + 1 }));
}

export function markSaved(rev: number) { set({ savedRev: rev }); }
export function markProjectSaved(rev: number) { set({ projectSavedRev: rev }); }

/** Both documents as they are now, for undo snapshots. */
export interface Snapshot { scene: PfScene; project: PfProject | null }
export const snapshot = (): Snapshot => ({ scene: get().scene, project: get().project });

/** Puts a snapshot back (undo/redo): the viewport is rebuilt. */
export function restore(snap: Snapshot) {
  // The project counts as changed only if the snapshot holds a different manifest (undoing a scene edit must not rewrite it).
  set(s => ({ scene: snap.scene, project: snap.project, rev: s.rev + 1, projectRev: snap.project !== s.project ? s.projectRev + 1 : s.projectRev }));
  revalidateSoon();
  void pushAll();
}

// ---- Edits -----------------------------------------------------------------------------------------------------

/** Inserts under `parentId` at `index`; false if the parent is missing or not a container. */
export function insert(obj: PfObject, parentId: string | null, index?: number): boolean {
  const next = insertObject(get().scene, obj, parentId, index);
  if (!next) return false;
  bump(next);
  schedulePush(0);
  return true;
}

export function remove(id: string): Removed | null {
  const r = removeObject(get().scene, id);
  if (!r) return null;
  bump(r.scene);
  schedulePush(0);
  return r;
}

export function move(id: string, parentId: string | null, index: number): boolean {
  const next = moveObject(get().scene, id, parentId, index);
  if (!next) return false;
  bump(next);
  schedulePush(0);
  return true;
}

/**
 * Edits one object's fields (`undefined` removes a field). `toView` is false when the viewport made the change itself.
 * Edits touching only transform-like fields are applied in place; anything else rebuilds the viewport (debounced).
 */
export function update(id: string, patch: Record<string, unknown>, toView = true): boolean {
  const next = updateObject(get().scene, id, patch);
  if (!next) return false;
  bump(next);
  if (!toView) return true;
  if (touched(patch)) sink({ type: 'SET_OBJECT', id, patch: patch as Partial<Record<LiveField, unknown>> });
  else schedulePush();
  return true;
}

/** Changes the scene document itself (size, background). */
export function updateSceneFields(patch: Record<string, unknown>) {
  const scene = { ...get().scene };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete scene[k]; else scene[k] = v; }
  bump(scene);
  schedulePush(0);
}

/** Adds an asset to the project manifest (for example after dropping an image file). */
export function addAsset(asset: PfAsset) {
  const project = get().project;
  if (!project) return;
  set(s => ({ project: { ...project, assets: [...project.assets, asset] }, projectRev: s.projectRev + 1 }));
}

/** Registers a new scene file in the project. */
export function addSceneEntry(key: string, path: string) {
  const project = get().project;
  if (!project) return;
  set(s => ({ project: { ...project, scenes: [...project.scenes, { key, path }] }, projectRev: s.projectRev + 1 }));
}
