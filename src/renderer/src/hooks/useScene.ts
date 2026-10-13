import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore, ObjectProps } from '../store';
import type { ObjectItem } from '../components/ObjectsPanel';
import { PROP_DEFAULTS, PROP_KEYS, pickProps, readWireProps } from '../../../shared/props';
import { DEFAULT_SCENE } from '../../../shared/layout';
import { formatScene, parseScene, newId, uniqueName, toIdentifier } from '../../../shared/scene';
import {
  isMessage, isForge, unhandled,
  type ToolMode, type SceneObject, type EditorToViewport, type BridgeToEditor, type Shape, type AssetPayload,
} from '../../../shared/protocol';
import * as history from '../history';
import * as model from '../sceneModel';
import { useSceneModel } from '../sceneModel';
import { useLatest } from './useLatest';

type ShortcutKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
export type SaveStatus = 'saved' | 'unsaved' | 'saving';

const api = window.electronAPI;

export const TOOLS: { mode: ToolMode; icon: string; label: string; key: string }[] = [
  { mode: 'select', icon: '↖', label: 'Select (Q)', key: 'q' },
  { mode: 'move', icon: '✥', label: 'Move (W)', key: 'w' },
  { mode: 'rotate', icon: '↻', label: 'Rotate (E)', key: 'e' },
  { mode: 'scale', icon: '⤢', label: 'Scale (R)', key: 'r' },
];

const SHAPE_NAMES: Record<Shape, string> = { rect: 'Rectangle', circle: 'Circle', triangle: 'Triangle' };

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

interface Options {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  send: (msg: EditorToViewport) => void;
  projectFolder: string | null;
  devScript: string;
  canvasSize: { w: number; h: number };
  ensureConfigPersisted: (folder: string, devScript: string) => Promise<IpcResult>;
  appendLog: (text: string) => void;
  showConsole: () => void;
  /** True while the viewport shows something other than the editable scene (live mode): shortcuts and saving are off. */
  readOnly: boolean;
  /** Messages from the live-mode bridge, when live mode is on. */
  onForgeMessage: (m: BridgeToEditor) => void;
}

/** The scene being edited: tool, save state, undo/redo, and the viewport message protocol. The objects live in sceneModel. */
export function useScene({
  iframeRef, send, projectFolder, devScript, canvasSize, ensureConfigPersisted, appendLog, showConsole, readOnly, onForgeMessage,
}: Options) {
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [saving, setSaving] = useState(false);
  const [lockedIds, setLockedIds] = useState<string[]>([]);

  model.bindView(send, projectFolder);
  const { objects, rev, savedRev, problems, blocked, sceneStatus } = useSceneModel(useShallow(s => ({
    objects: s.doc.objects, rev: s.rev, savedRev: s.savedRev, problems: s.problems, blocked: s.blocked, sceneStatus: s.status,
  })));
  const saveStatus: SaveStatus = saving ? 'saving' : rev !== savedRev ? 'unsaved' : 'saved';
  const objectItems: ObjectItem[] = objects.map(o => ({
    id: o.id, name: o.name, type: o.kind === 'sprite' ? 'Sprite' : SHAPE_NAMES[o.shape],
    visible: o.visible, locked: lockedIds.includes(o.id),
  }));

  useEffect(() => { send({ type: 'SET_LOCKED_IDS', ids: lockedIds }); }, [lockedIds, send]);

  const setTool = (mode: ToolMode) => {
    setToolMode(mode);
    send({ type: 'SET_TOOL_MODE', mode });
  };

  const toggleSnap = () => {
    send({ type: 'SET_SNAP', enabled: !useEditorStore.getState().snapEnabled });
    useEditorStore.getState().toggleSnap();
  };

  /** Applies props to the model and the viewport, and to the inspector when the object is selected. */
  const applyProps = (id: string, props: Partial<ObjectProps>) => {
    model.setProps(id, props);
    if (id === useEditorStore.getState().selectedId) useEditorStore.getState().updateProperties(props);
  };

  /** Edits made one after another on one object (a drag, typing in a field) become a single undo step. */
  const gestureRef = useRef<{ id: string; before: ObjectProps } | null>(null);
  const beginGesture = (id: string) => {
    if (gestureRef.current?.id === id) return;
    commitEdit();
    const o = model.objectById(id);
    if (o) gestureRef.current = { id, before: pickProps(o) };
  };
  const commitEdit = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    const o = g && model.objectById(g.id);
    if (!g || !o) return;
    const after = pickProps(o);
    if (PROP_KEYS.every(k => after[k] === g.before[k])) return;
    history.push({ undo: () => applyProps(g.id, g.before), redo: () => applyProps(g.id, after) });
  };

  const undo = () => { commitEdit(); history.undo(); };
  const redo = () => { commitEdit(); history.redo(); };

  const updateField = (props: Partial<ObjectProps>, commit = false) => {
    const id = useEditorStore.getState().selectedId;
    if (!id) return;
    beginGesture(id);
    applyProps(id, props);
    if (commit) commitEdit();
  };

  const selectObject = (id: string) => send({ type: 'SELECT_OBJECT', id });

  const addObject = (obj: SceneObject) => {
    commitEdit();
    const index = model.insertObject(obj);
    history.push({ undo: () => { model.removeObject(obj.id); }, redo: () => { model.insertObject(obj, index); } });
  };

  const deleteObject = (id: string) => {
    commitEdit();
    const removed = model.removeObject(id);
    if (!removed) return;
    history.push({
      undo: () => { model.insertObject(removed.obj, removed.index); },
      redo: () => { model.removeObject(id); },
    });
  };

  const duplicateObject = (id: string) => {
    const src = model.objectById(id);
    if (!src) return;
    addObject({ ...src, id: newId(), name: uniqueName(`${src.name}Copy`, objects.map(o => o.name)), depth: objects.length, x: src.x + 20, y: src.y + 20 });
  };

  const renameObject = (id: string, name: string) => {
    const before = model.objectById(id)?.name;
    const after = uniqueName(toIdentifier(name), objects.filter(o => o.id !== id).map(o => o.name));
    if (before === undefined || before === after) return;
    commitEdit();
    model.setName(id, after);
    history.push({ undo: () => model.setName(id, before), redo: () => model.setName(id, after) });
  };

  const toggleVisible = (id: string) => {
    const o = model.objectById(id);
    if (!o) return;
    commitEdit();
    beginGesture(id);
    applyProps(id, { visible: !o.visible });
    commitEdit();
  };

  /** Drag-reorder: `toIndex` is the new position in the scene order (depth). */
  const reorderObject = (id: string, toIndex: number) => {
    commitEdit();
    const before = model.reorderObject(id, toIndex);
    if (!before) return;
    const after = useSceneModel.getState().doc.objects;
    history.push({ undo: () => model.setOrder(before), redo: () => model.setOrder(after) });
    const sel = useEditorStore.getState().selectedId;
    const o = sel && model.objectById(sel);
    if (o) useEditorStore.getState().updateProperties({ depth: o.depth });
  };

  const updateMeta = (meta: Parameters<typeof model.setMeta>[1]) => {
    const id = useEditorStore.getState().selectedId;
    const o = id && model.objectById(id);
    if (!id || !o) return;
    commitEdit();
    const before = { anchor: o.anchor, interactive: o.interactive };
    model.setMeta(id, meta);
    history.push({ undo: () => model.setMeta(id, before), redo: () => model.setMeta(id, meta) });
  };

  const toggleLocked = (id: string) =>
    setLockedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const addPrimitive = (shape: Shape) => {
    addObject({
      id: newId(), name: uniqueName(SHAPE_NAMES[shape], objects.map(o => o.name)), anchor: null, interactive: false, kind: 'primitive', shape,
      ...PROP_DEFAULTS, depth: objects.length, x: canvasSize.w / 2, y: canvasSize.h / 2,
    });
  };

  const addSprite = (file: AssetPayload, at?: { x: number; y: number }) => {
    const asset = file.fullPath ? model.relativeAsset(file.fullPath) : null;
    if (!asset) return appendLog(`
[Cannot add "${file.name}": it is outside the project folder.]
`);
    model.primeTexture(asset, file.dataUrl);
    addObject({
      id: newId(), name: uniqueName(toIdentifier(file.name.replace(/.[^.]+$/, '')), objects.map(o => o.name)), anchor: null, interactive: false,
      kind: 'sprite', asset, ...PROP_DEFAULTS, depth: objects.length, x: at?.x ?? canvasSize.w / 2, y: at?.y ?? canvasSize.h / 2,
    });
  };

  /** Drop at iframe pixels: the viewport converts them to scene coordinates and answers with DROP_LOCATED. */
  const dropAsset = (file: AssetPayload, screenX?: number, screenY?: number) => {
    if (screenX === undefined || screenY === undefined) addSprite(file);
    else send({ type: 'LOCATE_DROP', file, screenX, screenY });
  };

  /** A failed save keeps the scene dirty and says why; the previous good file is never replaced by a partial one. */
  const saveSceneFiles = async (folder: string, text: string, atRev: number) => {
    const fail = (error?: string) => { appendLog(`\n[Save failed: ${error ?? 'Unknown error'}]\n`); showConsole(); };
    const cfg = await ensureConfigPersisted(folder, devScript);
    if (!cfg.ok) return fail(cfg.error);
    const r = await api.saveScene(folder, DEFAULT_SCENE, text);
    if (r.ok) model.markSaved(atRev); else fail(r.error);
  };

  const handleSave = async () => {
    if (!projectFolder || readOnly || useSceneModel.getState().status === 'none') return;
    if (useSceneModel.getState().blocked) {
      appendLog(`
[Not saved: the scene file could not be loaded, so saving would overwrite it. Fix the file and reopen the project.]
`);
      return showConsole();
    }
    const { doc, rev: atRev } = useSceneModel.getState();
    setSaving(true);
    await saveSceneFiles(projectFolder, formatScene(doc), atRev);
    setSaving(false);
  };

  /** Reads and validates the scene file; the report ends up in the model's problems. */
  const loadScene = async (folder: string) => {
    const r = await api.loadScene(folder, DEFAULT_SCENE);
    if (!r.ok) {
      return model.blockDoc(DEFAULT_SCENE, [{ level: 'error', message: `${r.error ?? 'Cannot read the scene file.'} The file was left untouched and saving is disabled.` }]);
    }
    if (!r.found) return model.resetDoc(DEFAULT_SCENE);
    const { doc, problems: found, fatal } = parseScene(r.data, DEFAULT_SCENE);
    if (fatal) return model.blockDoc(DEFAULT_SCENE, [...found, { level: 'error', message: 'The file was left untouched and saving is disabled.' }]);
    await model.loadDoc(doc, found);
  };

  /** The file changed on disk (the AI, git, an editor): reload it, asking first if there are unsaved edits. */
  const reloadFromDisk = useLatest(async () => {
    if (!projectFolder || readOnly) return;
    const { rev: r, savedRev: s } = useSceneModel.getState();
    if (r !== s && !window.confirm(`${DEFAULT_SCENE}.scene.json changed on disk, but the open scene has unsaved edits. Reload from disk and discard them?`)) {
      return appendLog('\n[Scene file changed on disk; kept your unsaved edits. Saving will overwrite the external change.]\n');
    }
    gestureRef.current = null;
    history.clear();
    useEditorStore.getState().setSelectedObject(null);
    await loadScene(projectFolder);
  });

  useEffect(() => {
    if (!projectFolder) return;
    api.watchScene(projectFolder, DEFAULT_SCENE);
    return api.onSceneChanged(() => { void reloadFromDisk.current(); });
  }, [projectFolder, reloadFromDisk]);

  /** Clears the scene for a newly opened project and reads its scene file; the viewport exists only once a scene does. */
  const beginProject = (folder: string) => {
    model.resetDoc(DEFAULT_SCENE);
    model.setLoading();
    useEditorStore.getState().setSelectedObject(null);
    history.clear();
    gestureRef.current = null;
    void loadScene(folder);
  };

  /** Clears all scene state (model, history, selection, problems) and stops the file watcher. */
  const endProject = () => {
    void api.watchScene('', DEFAULT_SCENE);
    gestureRef.current = null;
    history.clear();
    useEditorStore.getState().setSelectedObject(null);
    setLockedIds([]);
    model.resetDoc(DEFAULT_SCENE);
  };

  /** Creates the first scene (an empty file on disk) and opens it in the designer. */
  const createScene = async () => {
    if (!projectFolder) return;
    model.resetDoc(DEFAULT_SCENE, 'open');
    const { doc, rev: atRev } = useSceneModel.getState();
    await saveSceneFiles(projectFolder, formatScene(doc), atRev);
  };

  /** Returns true when the key was an editor shortcut. */
  const handleShortcut = useLatest((k: ShortcutKey) => {
    if (readOnly || sceneStatus !== 'open') return false;
    const key = k.key.toLowerCase();
    if (k.ctrlKey || k.metaKey) {
      if (key === 's') handleSave();
      else if (key === 'z' && !k.shiftKey) undo();
      else if (key === 'y' || (key === 'z' && k.shiftKey)) redo();
      else return false;
      return true;
    }
    const tool = TOOLS.find(t => t.key === key);
    if (tool) setTool(tool.mode);
    else if (key === 'f') send({ type: 'RESET_CAMERA' });
    else if (key === 'delete' && useEditorStore.getState().selectedId) deleteObject(useEditorStore.getState().selectedId!);
    else if (key === 'escape') send({ type: 'DESELECT_ALL' });
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
      case 'SCENE_READY': {
        send({ type: 'SET_TOOL_MODE', mode: toolMode });
        send({ type: 'SET_SNAP', enabled: useEditorStore.getState().snapEnabled });
        send({ type: 'SET_LOCKED_IDS', ids: lockedIds });
        // The viewport (re)appears: it gets the model, so unsaved edits survive a recreated iframe.
        model.pushAll();
        break;
      }
      case 'OBJECT_SELECTED':
        useEditorStore.getState().setSelectedObject(m.id, readWireProps(m), m.texW, m.texH);
        break;
      case 'OBJECT_DESELECTED':
        useEditorStore.getState().setSelectedObject(null);
        break;
      case 'OBJECT_TRANSFORMED':
        beginGesture(m.id);
        model.setProps(m.id, readWireProps(m), false);
        if (m.id === useEditorStore.getState().selectedId) useEditorStore.getState().updateProperties(readWireProps(m));
        break;
      case 'PUSH_HISTORY':
        commitEdit();
        break;
      case 'DROP_LOCATED':
        addSprite(m.file, { x: m.x, y: m.y });
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
      if (!isTyping(ev.target) && handleShortcut.current(ev)) ev.preventDefault();
    };
    window.addEventListener('message', handleMessage);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKey);
    };
  }, [iframeRef, onMessage, handleShortcut]);

  return {
    objectItems, toolMode, saveStatus, saveBlocked: blocked, sceneStatus, createScene, problems, addPrimitive, dropAsset,
    setTool, toggleSnap, undo, redo, updateField, commitEdit, selectObject, deleteObject, duplicateObject,
    renameObject, reorderObject, updateMeta, toggleVisible, toggleLocked, handleSave, beginProject, endProject,
  };
}
