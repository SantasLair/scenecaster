import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useEditorStore, ObjectProps } from '../store';
import type { HierarchyItem } from '../components/HierarchyPanel';
import { readWireProps } from '../../../shared/props';
import { DEFAULT_SCENE } from '../../../shared/layout';
import {
  isMessage, isForge, unhandled,
  type ToolMode, type SceneObject, type EditorToViewport, type BridgeToEditor,
} from '../../../shared/protocol';
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

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

interface Options {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  send: (msg: EditorToViewport) => void;
  projectFolder: string | null;
  devScript: string;
  ensureConfigPersisted: (folder: string, devScript: string) => Promise<IpcResult>;
  appendLog: (text: string) => void;
  showConsole: () => void;
  /** True while the viewport shows something other than the editable scene (live mode): shortcuts and saving are off. */
  readOnly: boolean;
  /** Messages from the live-mode bridge, when live mode is on. */
  onForgeMessage: (m: BridgeToEditor) => void;
}

/** The scene being edited: hierarchy, tool, dirty/save state, undo/redo, and the viewport message protocol. */
export function useScene({
  iframeRef, send, projectFolder, devScript, ensureConfigPersisted, appendLog, showConsole, readOnly, onForgeMessage,
}: Options) {
  const [hierarchy, setHierarchy] = useState<HierarchyItem[]>([]);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const pendingSaveRef = useRef(false);
  const pendingLoadFolderRef = useRef<string | null>(null);

  const markDirty = () => setSaveStatus('unsaved');
  const patchItem = (id: string, patch: Partial<HierarchyItem>) =>
    setHierarchy(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));

  const lockedKey = hierarchy.filter(i => i.locked).map(i => i.id).join('\n');
  useEffect(() => {
    send({ type: 'SET_LOCKED_IDS', ids: lockedKey ? lockedKey.split('\n') : [] });
  }, [lockedKey, send]);

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
    send({ type: 'SET_PROPERTIES', id: entry.id, ...entry.props });
    patchItem(entry.id, { visible: entry.props.visible });
    markDirty();
  };
  const undo = () => applyHistory(useEditorStore.getState().undo());
  const redo = () => applyHistory(useEditorStore.getState().redo());

  const updateField = (props: Partial<ObjectProps>, commit = false) => {
    const id = useEditorStore.getState().selectedId;
    if (!id) return;
    useEditorStore.getState().updateProperties(props);
    send({ type: 'SET_PROPERTIES', id, ...props });
    if (props.visible !== undefined) patchItem(id, { visible: props.visible });
    if (commit) useEditorStore.getState().commit();
    markDirty();
  };

  const selectObject = (id: string) => send({ type: 'SELECT_OBJECT', id });

  const deleteObject = (id: string) => {
    send({ type: 'DELETE_OBJECT', id });
    setHierarchy(prev => prev.filter(i => i.id !== id));
    markDirty();
  };

  const duplicateObject = (id: string) =>
    send({ type: 'DUPLICATE_OBJECT', id, newId: `${id.replace(/_copy_\d+$/, '')}_copy_${Date.now()}` });

  const renameObject = (id: string, name: string) => {
    send({ type: 'RENAME_OBJECT', id, name });
    patchItem(id, { name });
    markDirty();
  };

  const toggleVisible = (id: string) => {
    const item = hierarchy.find(i => i.id === id);
    if (!item) return;
    const visible = !item.visible;
    if (id === useEditorStore.getState().selectedId) return updateField({ visible }, true);
    send({ type: 'SET_PROPERTIES', id, visible });
    patchItem(id, { visible });
    markDirty();
  };

  const toggleLocked = (id: string) =>
    setHierarchy(prev => prev.map(i => i.id === id ? { ...i, locked: !i.locked } : i));

  const handleSave = () => {
    if (!projectFolder || readOnly) return;
    pendingSaveRef.current = true;
    send({ type: 'GET_SCENE_STATE' });
  };

  /** A failed save keeps the scene dirty and says why; the previous good file is never replaced by a partial one. */
  const saveSceneFiles = async (folder: string, objects: SceneObject[]) => {
    const fail = (error?: string) => { setSaveStatus('unsaved'); appendLog(`\n[Save failed: ${error ?? 'Unknown error'}]\n`); showConsole(); };
    const cfg = await ensureConfigPersisted(folder, devScript);
    if (!cfg.ok) return fail(cfg.error);
    const r = await api.saveScene(folder, DEFAULT_SCENE, objects);
    if (r.ok) setSaveStatus('saved'); else fail(r.error);
  };

  const loadScene = async (folder: string) => {
    const data = await api.loadScene(folder, DEFAULT_SCENE);
    setSaveStatus('saved');
    if (!data?.objects?.length) return;
    const objects = await Promise.all(data.objects.map(async obj =>
      obj.kind === 'sprite' && obj.assetFullPath
        ? { ...obj, dataUrl: (await api.fileToDataUrl(obj.assetFullPath)) ?? '' }
        : obj));
    send({ type: 'LOAD_SCENE', objects });
  };

  /** Clears the scene for a newly opened project. Without `resetViewport` the iframe reloads and its SCENE_READY triggers the load. */
  const beginProject = (folder: string, resetViewport: boolean) => {
    setHierarchy([]);
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
        setHierarchy([]);
        send({ type: 'SET_TOOL_MODE', mode: toolMode });
        send({ type: 'SET_SNAP', enabled: useEditorStore.getState().snapEnabled });
        // Also reload after the iframe is swapped back from a running game, which resets the scene.
        const folder = pendingLoadFolderRef.current ?? projectFolder;
        pendingLoadFolderRef.current = null;
        if (folder) loadScene(folder);
        break;
      }
      case 'OBJECT_SELECTED':
        useEditorStore.getState().setSelectedObject(m.id, readWireProps(m), m.texW, m.texH);
        break;
      case 'OBJECT_DESELECTED':
        useEditorStore.getState().setSelectedObject(null);
        break;
      case 'OBJECT_TRANSFORMED':
        if (m.id === useEditorStore.getState().selectedId) useEditorStore.getState().updateProperties(readWireProps(m));
        break;
      case 'PUSH_HISTORY':
        useEditorStore.getState().commit();
        markDirty();
        break;
      case 'OBJECT_ADDED':
        setHierarchy(prev => [...prev, { id: m.id, name: m.name, type: m.objType, visible: m.visible ?? true, locked: false }]);
        if (!m.loaded) markDirty();
        break;
      case 'SCENE_STATE':
        if (!pendingSaveRef.current || !projectFolder) break;
        pendingSaveRef.current = false;
        setSaveStatus('saving');
        saveSceneFiles(projectFolder, m.objects);
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
    hierarchy, toolMode, saveStatus,
    setTool, toggleSnap, undo, redo, updateField, selectObject, deleteObject, duplicateObject,
    renameObject, toggleVisible, toggleLocked, handleSave, beginProject,
  };
}
