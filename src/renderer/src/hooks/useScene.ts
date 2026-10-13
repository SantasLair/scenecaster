import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore, ObjectProps } from '../store';
import type { HierarchyItem } from '../components/HierarchyPanel';
import { PROP_DEFAULTS } from '../../../shared/props';
import { readWireProps } from '../../../shared/props';
import { DEFAULT_SCENE } from '../../../shared/layout';
import { formatScene, parseScene, newId, uniqueName } from '../../../shared/scene';
import {
  isMessage, isForge, unhandled,
  type ToolMode, type SceneObject, type EditorToViewport, type BridgeToEditor, type Shape, type AssetPayload,
} from '../../../shared/protocol';
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
  const pendingLoadFolderRef = useRef<string | null>(null);

  model.bindView(send, projectFolder);
  const { objects, rev, savedRev, problems } = useSceneModel(useShallow(s => ({
    objects: s.doc.objects, rev: s.rev, savedRev: s.savedRev, problems: s.problems,
  })));
  const saveStatus: SaveStatus = saving ? 'saving' : rev !== savedRev ? 'unsaved' : 'saved';
  const hierarchy: HierarchyItem[] = objects.map(o => ({
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

  const applyHistory = (entry: { id: string; props: ObjectProps } | null) => {
    if (!entry) return;
    model.setProps(entry.id, entry.props);
  };
  const undo = () => applyHistory(useEditorStore.getState().undo());
  const redo = () => applyHistory(useEditorStore.getState().redo());

  const updateField = (props: Partial<ObjectProps>, commit = false) => {
    const id = useEditorStore.getState().selectedId;
    if (!id) return;
    useEditorStore.getState().updateProperties(props);
    model.setProps(id, props);
    if (commit) useEditorStore.getState().commit();
  };

  const selectObject = (id: string) => send({ type: 'SELECT_OBJECT', id });

  const deleteObject = (id: string) => { model.removeObject(id); };

  const duplicateObject = (id: string) => {
    const src = model.objectById(id);
    if (!src) return;
    model.insertObject({ ...src, id: newId(), name: uniqueName(`${src.name} Copy`, objects.map(o => o.name)), x: src.x + 20, y: src.y + 20 });
  };

  const renameObject = (id: string, name: string) => {
    const others = objects.filter(o => o.id !== id).map(o => o.name);
    model.setName(id, uniqueName(name.trim() || 'Object', others));
  };

  const toggleVisible = (id: string) => {
    const o = model.objectById(id);
    if (!o) return;
    if (id === useEditorStore.getState().selectedId) return updateField({ visible: !o.visible }, true);
    model.setProps(id, { visible: !o.visible });
  };

  const toggleLocked = (id: string) =>
    setLockedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const addPrimitive = (shape: Shape) => {
    model.insertObject({
      id: newId(), name: uniqueName(SHAPE_NAMES[shape], objects.map(o => o.name)), parentId: null, kind: 'primitive', shape,
      ...PROP_DEFAULTS, x: canvasSize.w / 2, y: canvasSize.h / 2,
    });
  };

  const addSprite = (file: AssetPayload, at?: { x: number; y: number }) => {
    const asset = file.fullPath ? model.relativeAsset(file.fullPath) : null;
    if (!asset) return appendLog(`\n[Cannot add "${file.name}": it is outside the project folder.]\n`);
    model.primeTexture(asset, file.dataUrl);
    model.insertObject({
      id: newId(), name: uniqueName(file.name.replace(/\.[^.]+$/, ''), objects.map(o => o.name)), parentId: null,
      kind: 'sprite', asset, ...PROP_DEFAULTS, x: at?.x ?? canvasSize.w / 2, y: at?.y ?? canvasSize.h / 2,
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
    if (!projectFolder || readOnly) return;
    const { doc, rev: atRev } = useSceneModel.getState();
    setSaving(true);
    await saveSceneFiles(projectFolder, formatScene(doc), atRev);
    setSaving(false);
  };

  /** Reads and validates the scene file; the report ends up in the model's problems. */
  const loadScene = async (folder: string) => {
    const r = await api.loadScene(folder, DEFAULT_SCENE);
    if (!r.ok) {
      model.resetDoc(DEFAULT_SCENE);
      return model.setProblems([{ level: 'error', message: r.error ?? 'Cannot read the scene file.' }]);
    }
    if (!r.found) return model.resetDoc(DEFAULT_SCENE);
    const { doc, problems: found } = parseScene(r.data, DEFAULT_SCENE);
    await model.loadDoc(doc, found);
  };

  /** Clears the scene for a newly opened project. Without `resetViewport` the iframe reloads and its SCENE_READY triggers the load. */
  const beginProject = (folder: string, resetViewport: boolean) => {
    model.resetDoc(DEFAULT_SCENE);
    useEditorStore.getState().setSelectedObject(null);
    useEditorStore.setState({ past: [], future: [] });
    pendingLoadFolderRef.current = folder;
    if (resetViewport) send({ type: 'RESET_SCENE' });
  };

  /** Returns true when the key was an editor shortcut. */
  const handleShortcut = useLatest((k: ShortcutKey) => {
    if (readOnly) return false;
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
        // A newly opened project reads the file; a recreated viewport just gets the model again, so unsaved edits survive.
        const folder = pendingLoadFolderRef.current;
        pendingLoadFolderRef.current = null;
        if (folder) loadScene(folder); else model.pushAll();
        break;
      }
      case 'OBJECT_SELECTED':
        useEditorStore.getState().setSelectedObject(m.id, readWireProps(m), m.texW, m.texH);
        break;
      case 'OBJECT_DESELECTED':
        useEditorStore.getState().setSelectedObject(null);
        break;
      case 'OBJECT_TRANSFORMED':
        model.setProps(m.id, readWireProps(m), false);
        if (m.id === useEditorStore.getState().selectedId) useEditorStore.getState().updateProperties(readWireProps(m));
        break;
      case 'PUSH_HISTORY':
        useEditorStore.getState().commit();
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
    hierarchy, toolMode, saveStatus, problems, addPrimitive, dropAsset,
    setTool, toggleSnap, undo, redo, updateField, selectObject, deleteObject, duplicateObject,
    renameObject, toggleVisible, toggleLocked, handleSave, beginProject,
  };
}
