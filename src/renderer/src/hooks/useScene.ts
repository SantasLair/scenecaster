import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import {
  isMessage, isForge, unhandled,
  type ToolMode, type EditorToViewport, type BridgeToEditor, type AssetPayload,
} from '../../../shared/protocol';
import type { PfObject, PfProject, PfScene, Problem } from '../../../shared/phaseform/types';
import type { PfAnimation } from '../../../shared/phaseform/animations';
import { DEFAULT_FIRST_SCENE, PROJECT_FILE, formatJson, isSceneKey, newProject, scenePathFor } from '../../../shared/phaseform/format';
import { allIds, cloneWithNewIds, findById, uniqueId } from '../../../shared/phaseform/tree';
import { checkSceneAgainstProject, validateProject, validateScene } from '../../../shared/phaseform/validate';
import { planManifestEntries, suggestKey } from '../../../shared/assetImport';
import { animationAssetKeys, applyRenamesToScene, assetFiles, assetUses, buildAssetReport, sceneAssetKeys, type AssetReport } from '../../../shared/phaseform/assets';
import type { PfAsset } from '../../../shared/phaseform/types';
import { ADD_LABELS, createImage, createObject, type AddKind } from '../newObjects';
import * as history from '../history';
import * as model from '../sceneModel';
import { allProblems, useSceneModel } from '../sceneModel';
import { useLatest } from './useLatest';

type ShortcutKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
import type { IconName } from '../components/Icon';
export type SaveStatus = 'saved' | 'unsaved' | 'saving';
export type BeginResult = 'ready' | 'needs-setup';

const api = window.electronAPI;

export const TOOLS: { mode: ToolMode; icon: IconName; label: string; key: string }[] = [
  { mode: 'select', icon: 'ToolSelect', label: 'Select', key: 'q' },
  { mode: 'move', icon: 'ToolMove', label: 'Move', key: 'w' },
  { mode: 'rotate', icon: 'ToolRotate', label: 'Rotate', key: 'e' },
  { mode: 'scale', icon: 'ToolScale', label: 'Scale', key: 'r' },
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

const err = (message: string): Problem => ({ level: 'error', message });
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
function parseJson<T>(text: string): Parsed<T> {
  try { return { ok: true, value: JSON.parse(text) as T }; } catch (e) { return { ok: false, error: (e as Error).message }; }
}

interface Options {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  send: (msg: EditorToViewport) => void;
  projectFolder: string | null;
  appendLog: (text: string) => void;
  showConsole: () => void;
  /** True while the viewport shows something other than the editable scene (live mode): shortcuts and saving are off. */
  readOnly: boolean;
  /** Messages from the live-mode bridge, when live mode is on. */
  onForgeMessage: (m: BridgeToEditor) => void;
}

/** The scene being edited: tool, save state, undo/redo, and the viewport message protocol. The documents live in sceneModel. */
export function useScene({ iframeRef, send, projectFolder, appendLog, showConsole, readOnly, onForgeMessage }: Options) {
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [saving, setSaving] = useState(false);
  const [lockedIds, setLockedIds] = useState<ReadonlySet<string>>(new Set());
  const [sceneKey, setSceneKey] = useState('Main');
  const keyRef = useRef('Main');
  /** Line endings of the files as read, so saving an unchanged document reproduces it byte for byte. */
  const eolRef = useRef({ scene: '\n', project: '\n' });

  model.bindView(send, projectFolder);
  const { scene, project, rev, savedRev, projectRev, projectSavedRev, blocked, sceneStatus, scenePath } = useSceneModel(useShallow(s => ({
    scene: s.scene, project: s.project, rev: s.rev, savedRev: s.savedRev, projectRev: s.projectRev, projectSavedRev: s.projectSavedRev,
    blocked: s.blocked, sceneStatus: s.status, scenePath: s.scenePath,
  })));
  // Select the two stored lists, not allProblems(): it builds new objects on every call, which makes the selector never settle.
  const docProblems = useSceneModel(s => s.problems);
  const viewWarnings = useSceneModel(s => s.viewWarnings);
  const problems = useMemo(() => allProblems({ problems: docProblems, viewWarnings }), [docProblems, viewWarnings]);
  const dirty = rev !== savedRev || projectRev !== projectSavedRev;
  const saveStatus: SaveStatus = saving ? 'saving' : dirty ? 'unsaved' : 'saved';
  const scenes = project?.scenes ?? [];
  const canvasSize = { w: scene.size.width, h: scene.size.height };

  useEffect(() => { send({ type: 'SET_LOCKED_IDS', ids: [...lockedIds] }); }, [lockedIds, send]);

  const setTool = (mode: ToolMode) => { setToolMode(mode); send({ type: 'SET_TOOL_MODE', mode }); };

  const toggleSnap = () => {
    send({ type: 'SET_SNAP', enabled: !useEditorStore.getState().snapEnabled });
    useEditorStore.getState().toggleSnap();
  };

  const select = (id: string | null) => useEditorStore.getState().setSelected(id);
  const selectObject = (id: string) => { select(id); send({ type: 'SELECT_OBJECT', id }); };

  // ---- Undo: edits made one after another (a drag, typing in a field) become one step, as snapshots of both documents.
  const gestureRef = useRef<model.Snapshot | null>(null);
  const beginGesture = () => { if (!gestureRef.current) gestureRef.current = model.snapshot(); };
  const commitEdit = () => {
    const before = gestureRef.current;
    gestureRef.current = null;
    if (!before) return;
    const after = model.snapshot();
    if (before.scene === after.scene && before.project === after.project) return;
    history.push({ undo: () => model.restore(before), redo: () => model.restore(after) });
  };
  /** One discrete change as its own undo step. */
  const step = <T,>(fn: () => T): T => { commitEdit(); beginGesture(); const r = fn(); commitEdit(); return r; };

  const undo = () => { commitEdit(); history.undo(); };
  const redo = () => { commitEdit(); history.redo(); };

  /** After undo/redo or a delete the selected object may be gone. */
  useEffect(() => {
    const id = useEditorStore.getState().selectedId;
    if (id && !findById(scene, id)) select(null);
  }, [scene]);

  // ---- Editing the selected object
  const updateField = (patch: Record<string, unknown>, commit = false) => {
    const id = useEditorStore.getState().selectedId;
    if (!id) return;
    beginGesture();
    model.update(id, patch);
    if (commit) commitEdit();
  };

  // ---- Editing the project's asset manifest (each change is part of the same undo history as scene edits)
  const updateAssetField = (key: string, patch: Record<string, unknown>, commit = false) => {
    beginGesture();
    model.updateAsset(key, patch);
    if (commit) commitEdit();
  };
  const renameAsset = (oldKey: string, newKey: string) => step(() => model.renameAsset(oldKey, newKey));
  const removeAsset = (key: string) => step(() => model.removeAsset(key));

  /** The project's other scene files as they will be after the next save (renames pending since the last save are applied). */
  const readOtherScenes = async (): Promise<{ key: string; doc: PfScene }[]> => {
    const s = useSceneModel.getState();
    const out: { key: string; doc: PfScene }[] = [];
    if (!projectFolder || !s.project) return out;
    for (const entry of s.project.scenes) {
      if (entry.path === s.scenePath) continue;
      const r = await api.readScene(projectFolder, entry.path);
      const parsed = r.ok && r.found ? parseJson<PfScene>(r.text ?? '') : null;
      if (parsed?.ok && Array.isArray(parsed.value?.objects)) out.push({ key: entry.key, doc: applyRenamesToScene(parsed.value, s.pendingRenames) });
    }
    return out;
  };

  /** Where an asset is used: the open scene and the project (animations, preload lists), plus every other scene file on disk. */
  const findAssetUses = async (key: string): Promise<string[]> => {
    const uses = model.usesOfAsset(key);
    for (const { key: sceneKey, doc } of await readOtherScenes()) for (const u of assetUses(doc, null, key)) uses.push(`${u} in scene "${sceneKey}"`);
    return uses;
  };

  /** Manifest entries nothing in the scenes uses, and entries whose files are not on disk. */
  const checkAssets = async (): Promise<AssetReport | null> => {
    const s = useSceneModel.getState();
    if (!projectFolder || !s.project) return null;
    const used = new Set([...sceneAssetKeys(s.scene), ...animationAssetKeys(s.project)]);
    for (const { doc } of await readOtherScenes()) for (const k of sceneAssetKeys(doc)) used.add(k);
    const files = [...new Set(s.project.assets.flatMap(assetFiles))];
    const missing = new Set(await api.missingAssetFiles(projectFolder, files));
    return buildAssetReport(s.project, used, missing);
  };

  const addAnimation = (anim: PfAnimation) => step(() => model.addAnimation(anim));
  const updateAnimationField = (key: string, patch: Record<string, unknown>, commit = false) => {
    beginGesture();
    model.updateAnimation(key, patch);
    if (commit) commitEdit();
  };
  const renameAnimation = (oldKey: string, newKey: string) => step(() => model.renameAnimation(oldKey, newKey));
  const removeAnimation = (key: string) => step(() => model.removeAnimation(key));

  const nextId = (base: string) => uniqueId(base, allIds(model.useSceneModel.getState().scene));

  /** Adds into `parentId` (null = top level); a top-level object lands at the canvas centre, a child at its parent's origin. */
  const addObject = (kind: AddKind, parentId: string | null = null) => {
    const sc = useSceneModel.getState().scene;
    const at = parentId ? { x: 0, y: 0 } : { x: Math.round(sc.size.width / 2), y: Math.round(sc.size.height / 2) };
    const obj = createObject(kind, nextId(ADD_LABELS[kind]), at.x, at.y);
    step(() => model.insert(obj, parentId));
    selectObject(obj.id);
  };

  /** Adds an image object for a file inside the project, registering it in the manifest first when it is new. */
  const addImageFile = (file: AssetPayload, at?: { x: number; y: number }) => {
    const url = file.fullPath ? model.relativePath(file.fullPath) : null;
    const state = useSceneModel.getState();
    if (!url || !state.project) {
      return appendLog(`\n[Cannot add "${file.name}": it is outside the project folder.]\n`);
    }
    const sc = state.scene;
    step(() => {
      let asset = state.project!.assets.find(a => a.url === url && (a.type === 'image' || a.type === 'spritesheet'));
      if (!asset) {
        asset = { key: suggestKey(file.name, state.project!.assets.map(a => a.key), 'image'), type: 'image', url };
        model.addAsset(asset);
      }
      const obj = createImage(nextId(asset.key), asset.key, Math.round(at?.x ?? sc.size.width / 2), Math.round(at?.y ?? sc.size.height / 2));
      model.insert(obj, null);
      select(obj.id);
    });
    const id = useEditorStore.getState().selectedId;
    if (id) send({ type: 'SELECT_OBJECT', id });
  };

  /**
   * Copies files into the project folder `destRel` and registers each image and audio file in the manifest (one undo step).
   * A data file (atlas json, font xml/fnt) imported with an image of the same name makes an atlas or bitmapFont entry;
   * alone it is only copied. Audio files of the same name (boom.mp3 + boom.ogg) share one entry.
   * Returns the project-relative paths that were copied.
   */
  const importAssets = async (sources: string[], destRel: string): Promise<string[]> => {
    const note = (text: string) => appendLog(`\n[${text}]\n`);
    if (!projectFolder || !useSceneModel.getState().project) {
      note('Open or create a scene before importing: the asset list lives in the project file.');
      showConsole();
      return [];
    }
    const r = await api.importAssets(projectFolder, destRel, sources);
    if (!r.ok || !r.results) { note(`Import failed: ${r.error ?? 'unknown error'}`); showConsole(); return []; }
    const failed = r.results.filter(x => x.error);
    for (const x of failed) note(`Cannot import "${x.name}": ${x.error}`);
    if (failed.length) showConsole();
    const copied = r.results.filter(x => x.rel && x.kind);
    step(() => {
      for (const p of planManifestEntries(copied.map(x => ({ name: x.name, kind: x.kind!, rel: x.rel! })))) {
        const keys = (useSceneModel.getState().project?.assets ?? []).map(a => a.key);
        model.addAsset({ key: suggestKey(p.fileName, keys, String(p.entry.type)), ...p.entry } as PfAsset);
      }
    });
    if (copied.length) void api.watchAssets(projectFolder); // the folder may have just been created
    if (copied.length) note(`Imported ${copied.length} file${copied.length === 1 ? '' : 's'} into ${destRel}.`);
    return copied.map(x => x.rel!);
  };

  /** Drop at iframe pixels: the viewport converts them to scene coordinates and answers with DROP_LOCATED. */
  const dropAsset = (file: AssetPayload, screenX?: number, screenY?: number) => {
    if (screenX === undefined || screenY === undefined) addImageFile(file);
    else send({ type: 'LOCATE_DROP', file, screenX, screenY });
  };

  const deleteObject = (id: string) => {
    if (!step(() => model.remove(id))) return;
    if (useEditorStore.getState().selectedId === id) select(null);
  };

  const duplicateObject = (id: string) => {
    const hit = findById(useSceneModel.getState().scene, id);
    if (!hit) return;
    const copy = cloneWithNewIds(hit.obj, allIds(useSceneModel.getState().scene));
    if (typeof copy.x === 'number') copy.x += 20;
    if (typeof copy.y === 'number') copy.y += 20;
    step(() => model.insert(copy, hit.parent?.id ?? null, hit.index + 1));
    selectObject(copy.id);
  };

  const renameObject = (id: string, label: string) => {
    const name = label.trim();
    const cur = model.sceneObject(id);
    if (!cur || (cur.name ?? '') === name) return;
    step(() => model.update(id, { name: name || undefined }));
  };

  const toggleVisible = (id: string) => {
    const o = model.sceneObject(id);
    if (o) step(() => model.update(id, { visible: o.visible === false ? undefined : false }));
  };

  const moveObject = (id: string, parentId: string | null, index: number) => { step(() => model.move(id, parentId, index)); };

  const toggleLocked = (id: string) => setLockedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // ---- Saving
  const fail = (error?: string) => { appendLog(`\n[Save failed: ${error ?? 'Unknown error'}]\n`); showConsole(); };

  /** Writes the scene, and the project file when it changed; a failed write keeps its document dirty. */
  const saveFiles = async (folder: string) => {
    const s = useSceneModel.getState();
    if (!s.scenePath) return fail('This scene has no file path.');
    const sceneRev = s.rev, projRev = s.projectRev;
    // Other scene files first: if one cannot be rewritten, the project file keeps the old keys and the next save retries.
    if (s.project && s.pendingRenames.length && !(await rewriteOtherScenes(folder, s.project, s.scenePath, s.pendingRenames))) return;
    const r = await api.writeScene(folder, s.scenePath, formatJson(s.scene).replace(/\n/g, eolRef.current.scene));
    if (!r.ok) return fail(r.error);
    model.markSaved(sceneRev);
    if (s.project && projRev !== s.projectSavedRev) {
      const p = await api.writeProject(folder, formatJson(s.project).replace(/\n/g, eolRef.current.project));
      if (!p.ok) return fail(p.error);
      model.markProjectSaved(projRev);
      if (useSceneModel.getState().pendingRenames === s.pendingRenames) model.clearPendingRenames();
    }
  };

  /** Applies asset renames to every other scene file in the project; false (after logging why) if any could not be updated. */
  const rewriteOtherScenes = async (folder: string, project: PfProject, openPath: string, renames: model.Snapshot['renames']) => {
    let ok = true;
    let changed = 0;
    for (const entry of project.scenes) {
      if (entry.path === openPath) continue;
      const r = await api.readScene(folder, entry.path);
      if (!r.ok) { fail(`Cannot read ${entry.path} to update the renamed assets: ${r.error ?? 'unknown error'}`); ok = false; continue; }
      if (!r.found) continue;
      const parsed = parseJson<PfScene>(r.text ?? '');
      if (!parsed.ok || !parsed.value || !Array.isArray(parsed.value.objects)) {
        fail(`${entry.path} is not a readable PHASEFORM scene, so assets renamed in it were not updated. Fix the file and save again.`);
        ok = false;
        continue;
      }
      const next = applyRenamesToScene(parsed.value, renames);
      if (next === parsed.value) continue;
      const eol = r.text!.includes('\r\n') ? '\r\n' : '\n';
      const w = await api.writeScene(folder, entry.path, formatJson(next).replace(/\n/g, eol));
      if (!w.ok) { fail(w.error); ok = false; continue; }
      changed++;
    }
    if (changed) appendLog(`\n[Updated renamed assets in ${changed} other scene file${changed === 1 ? '' : 's'}.]\n`);
    return ok;
  };

  const handleSave = async () => {
    if (!projectFolder || readOnly || useSceneModel.getState().status === 'none') return;
    if (useSceneModel.getState().blocked) {
      appendLog('\n[Not saved: the file could not be loaded, so saving would overwrite it. Fix the file and reopen the project.]\n');
      return showConsole();
    }
    commitEdit();
    setSaving(true);
    await saveFiles(projectFolder);
    setSaving(false);
  };

  // ---- Loading
  const selectKey = (key: string) => { keyRef.current = key; setSceneKey(key); };

  /** Reads and validates one scene file listed in the project. */
  const loadSceneFile = async (folder: string, key: string) => {
    const proj = useSceneModel.getState().project;
    const entry = proj?.scenes.find(e => e.key === key);
    if (!proj || !entry) return model.resetScene(key);
    const r = await api.readScene(folder, entry.path);
    if (!r.ok) return model.blockScene(key, entry.path, [err(`${r.error ?? 'Cannot read the scene file.'} The file was left untouched and saving is disabled.`)]);
    if (!r.found) {
      // Listed but missing: start an empty scene that Save will create.
      model.resetScene(key, 'open', entry.path);
      useSceneModel.setState({ problems: [{ level: 'warning', message: `${entry.path} does not exist yet; saving will create it.` }] });
      return;
    }
    eolRef.current.scene = r.text?.includes('\r\n') ? '\r\n' : '\n';
    const parsed = parseJson<PfScene>(r.text ?? '');
    if (!parsed.ok) return model.blockScene(key, entry.path, [err(`${entry.path} is not valid JSON: ${parsed.error}`), err('The file was left untouched and saving is disabled.')]);
    const doc = parsed.value;
    if (!doc || doc.format !== 'phaseform' || !Array.isArray(doc.objects) || typeof doc.size !== 'object') {
      return model.blockScene(key, entry.path, [err(`${entry.path} is not a PHASEFORM scene (expected "format": "phaseform", a size and an objects list).`), err('The file was left untouched and saving is disabled.')]);
    }
    const problems = [...validateScene(doc), ...checkSceneAgainstProject(doc, proj, entry)];
    if (doc.key !== entry.key) problems.push({ level: 'warning', message: `The scene's key "${doc.key}" differs from its entry "${entry.key}" in the project file.` });
    model.loadScene(doc, entry.path, problems);
  };

  /** Reads the project file; the first scene the project lists (its entry scene first) is opened by the caller. */
  const loadProjectFile = async (folder: string): Promise<'ok' | 'missing' | 'invalid'> => {
    const r = await api.readProject(folder);
    if (!r.ok) { model.setProject(null); model.blockScene(keyRef.current, null, [err(`${r.error ?? 'Cannot read phaseform.project.json.'} The file was left untouched and saving is disabled.`)]); return 'invalid'; }
    if (!r.found) return 'missing';
    eolRef.current.project = r.text?.includes('\r\n') ? '\r\n' : '\n';
    const parsed = parseJson<PfProject>(r.text ?? '');
    if (!parsed.ok) { model.setProject(null); model.blockScene(keyRef.current, null, [err(`phaseform.project.json is not valid JSON: ${parsed.error}`), err('The file was left untouched and saving is disabled.')]); return 'invalid'; }
    const found = validateProject(parsed.value);
    if (found.some(p => p.level === 'error')) {
      model.setProject(null);
      model.blockScene(keyRef.current, null, [...found, err('phaseform.project.json was left untouched and saving is disabled.')]);
      return 'invalid';
    }
    model.setProject(parsed.value);
    return 'ok';
  };

  /** The file changed on disk (the AI, git, an editor): reload it, asking first if there are unsaved edits. */
  const reloadFromDisk = useLatest(async (relPath: string) => {
    if (!projectFolder || readOnly) return;
    const s = useSceneModel.getState();
    const isProject = relPath === PROJECT_FILE;
    const unsaved = isProject ? s.projectRev !== s.projectSavedRev : s.rev !== s.savedRev;
    if (unsaved && !window.confirm(`${relPath} changed on disk, but the open document has unsaved edits. Reload from disk and discard them?`)) {
      return appendLog(`\n[${relPath} changed on disk; kept your unsaved edits. Saving will overwrite the external change.]\n`);
    }
    gestureRef.current = null;
    history.clear();
    if (isProject) {
      if ((await loadProjectFile(projectFolder)) === 'ok') await loadSceneFile(projectFolder, keyRef.current);
    } else {
      await loadSceneFile(projectFolder, keyRef.current);
    }
  });

  useEffect(() => {
    if (!projectFolder) return;
    void api.watchFiles(projectFolder, scenePath ? [PROJECT_FILE, scenePath] : [PROJECT_FILE]);
    return api.onFileChanged(rel => { void reloadFromDisk.current(rel); });
  }, [projectFolder, scenePath, reloadFromDisk]);

  // The page re-reads the assets folder when this fires (AssetBrowser and the Check assets report listen for it).
  useEffect(() => {
    void api.watchAssets(projectFolder ?? '');
    return () => { void api.watchAssets(''); };
  }, [projectFolder]);

  const resetEditing = () => { gestureRef.current = null; history.clear(); select(null); };

  /** Reads a newly opened project and opens its entry scene. 'needs-setup': the folder has no PHASEFORM project yet. */
  const beginProject = async (folder: string): Promise<BeginResult> => {
    resetEditing();
    setLockedIds(new Set());
    model.setProject(null);
    model.resetScene('Main');
    model.setLoading();
    const state = await loadProjectFile(folder);
    if (state === 'missing') { model.resetScene('Main'); return 'needs-setup'; }
    if (state === 'invalid') return 'ready';
    const proj = useSceneModel.getState().project!;
    const key = (proj.scenes.find(e => e.key === proj.entry) ?? proj.scenes[0]).key;
    selectKey(key);
    await loadSceneFile(folder, key);
    return 'ready';
  };

  /** No project file exists: start one in memory (written on the first save) with an empty first scene. */
  const createProject = (folder: string, w: number, h: number, key = DEFAULT_FIRST_SCENE) => {
    resetEditing();
    const path = scenePathFor(key);
    selectKey(key);
    model.setProject(newProject(baseName(folder), key, path), true);
    model.resetScene(key, 'open', path, { width: w, height: h });
  };

  /** Asks what to do with unsaved edits before they are replaced; false means the user cancelled. */
  const settleUnsaved = async () => {
    if (readOnly || (rev === savedRev && projectRev === projectSavedRev)) return true;
    const choice = await api.confirmUnsaved(`${keyRef.current} has unsaved changes. Save before switching scenes?`);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      await handleSave();
      const s = useSceneModel.getState();
      if (s.rev !== s.savedRev || s.projectRev !== s.projectSavedRev) return false;
    }
    return true;
  };

  /** Switches to another of the project's scenes. */
  const openScene = async (key: string) => {
    if (!projectFolder || key === keyRef.current || !(await settleUnsaved())) return;
    resetEditing();
    selectKey(key);
    model.setLoading();
    await loadSceneFile(projectFolder, key);
  };

  /** Opens the scene whose file is `relPath` (a double-click in the FileSystem panel). */
  const openSceneFile = (relPath: string) => {
    const entry = useSceneModel.getState().project?.scenes.find(e => e.path === relPath);
    if (entry) return void openScene(entry.key);
    appendLog(`\n[${relPath} is not listed in ${PROJECT_FILE}. Add it to the project's scenes to open it here.]\n`);
    showConsole();
  };

  /** Creates a scene (a new entry in the project and an empty file) and opens it. */
  const createScene = async (key = keyRef.current) => {
    const proj = useSceneModel.getState().project;
    if (!projectFolder || !proj || !isSceneKey(key) || proj.scenes.some(e => e.key === key) || !(await settleUnsaved())) return;
    resetEditing();
    const size = useSceneModel.getState().scene.size;
    const path = scenePathFor(key);
    model.addSceneEntry(key, path);
    selectKey(key);
    model.resetScene(key, 'open', path, size);
    await saveFiles(projectFolder);
  };

  /** Clears all scene state (model, history, selection, problems) and stops the file watcher. */
  const endProject = () => {
    void api.watchFiles('', []);
    selectKey('Main');
    resetEditing();
    setLockedIds(new Set());
    model.setProject(null);
    model.resetScene('Main');
  };

  /** Arrow-key nudge: 1 px, 10 px with Shift. Held keys and quick presses share one undo step, closed after a pause. */
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const NUDGE: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  const nudgeSelected = (dir: [number, number], shift: boolean): boolean => {
    const id = useEditorStore.getState().selectedId;
    const found = id ? findById(useSceneModel.getState().scene, id) : null;
    if (!id || !found || lockedIds.has(id)) return false;
    const d = shift ? 10 : 1;
    beginGesture();
    model.update(id, {
      x: Math.round(((found.obj.x as number | undefined) ?? 0) + dir[0] * d),
      y: Math.round(((found.obj.y as number | undefined) ?? 0) + dir[1] * d),
    });
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => { nudgeTimer.current = null; commitEdit(); }, 500);
    return true;
  };

  /** Returns true when the key was an editor shortcut. */
  const handleShortcut = useLatest((k: ShortcutKey) => {
    if (readOnly || sceneStatus !== 'open') return false;
    const key = k.key.toLowerCase();
    if (k.ctrlKey || k.metaKey) {
      if (key === 's') void handleSave();
      else if (key === 'z' && !k.shiftKey) undo();
      else if (key === 'y' || (key === 'z' && k.shiftKey)) redo();
      else return false;
      return true;
    }
    const tool = TOOLS.find(t => t.key === key);
    const sel = useEditorStore.getState().selectedId;
    if (tool) setTool(tool.mode);
    else if (key === 'f') send({ type: 'RESET_CAMERA' });
    else if (key === 'delete' && sel) deleteObject(sel);
    else if (key === 'escape') { send({ type: 'DESELECT_ALL' }); select(null); }
    else if (key in NUDGE) return nudgeSelected(NUDGE[key], k.shiftKey);
    else return false;
    return true;
  });

  const onMessage = useLatest((data: unknown) => {
    if (!isMessage(data)) return;
    if (isForge(data)) return onForgeMessage(data);
    const m = data;
    switch (m.type) {
      case 'KEYDOWN':
        handleShortcut.current(m);
        break;
      case 'SCENE_READY':
        send({ type: 'SET_TOOL_MODE', mode: toolMode });
        send({ type: 'SET_SNAP', enabled: useEditorStore.getState().snapEnabled });
        send({ type: 'SET_LOCKED_IDS', ids: [...lockedIds] });
        // The viewport (re)appears without textures: it gets the whole model, so unsaved edits survive a recreated iframe.
        model.viewportReady();
        void model.pushAll();
        break;
      case 'SCENE_LOADED':
        model.setViewWarnings(m.warnings);
        break;
      case 'OBJECT_SELECTED':
        select(m.id);
        break;
      case 'OBJECT_DESELECTED':
        select(null);
        break;
      case 'OBJECT_TRANSFORMED': {
        beginGesture();
        const patch: Record<string, unknown> = { x: m.x, y: m.y };
        if (m.rotation !== undefined) patch.rotation = m.rotation;
        if (m.scale !== undefined) patch.scale = m.scale;
        model.update(m.id, patch, false);
        break;
      }
      case 'PUSH_HISTORY':
        commitEdit();
        break;
      case 'DROP_LOCATED':
        addImageFile(m.file, { x: m.x, y: m.y });
        break;
      default: unhandled(m);
    }
  });

  useEffect(() => {
    const handleMessage = (ev: MessageEvent) => {
      // The viewport iframe (editor Phaser view or the dev game) is the only legitimate sender.
      if (ev.source !== iframeRef.current?.contentWindow) return;
      onMessage.current(ev.data);
    };
    const handleKey = (ev: KeyboardEvent) => {
      // The Objects and FileSystem trees use the arrow keys to move their own selection.
      if (ev.key.startsWith('Arrow') && ev.target instanceof Element && ev.target.closest('[data-arrow-nav]')) return;
      if (!isTyping(ev.target) && handleShortcut.current(ev)) ev.preventDefault();
    };
    window.addEventListener('message', handleMessage);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKey);
    };
  }, [iframeRef, onMessage, handleShortcut]);

  const selectedId = useEditorStore(s => s.selectedId);
  const selectedObject: PfObject | null = selectedId ? findById(scene, selectedId)?.obj ?? null : null;

  return {
    scene, project, scenes, sceneKey, canvasSize, selectedObject, lockedIds, toolMode, saveStatus, saveBlocked: blocked, sceneStatus, problems,
    openScene, openSceneFile, createScene, createProject, beginProject, endProject,
    setTool, toggleSnap, undo, redo, updateField, commitEdit, selectObject,
    addObject, dropAsset, importAssets, updateAssetField, renameAsset, removeAsset, findAssetUses, checkAssets, addAnimation, updateAnimationField, renameAnimation, removeAnimation, deleteObject, duplicateObject, renameObject, toggleVisible, toggleLocked, moveObject, handleSave,
  };
}
