import { useShallow } from 'zustand/react/shallow';
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import type React from 'react';
import { useEditorStore, ObjectProps } from './store';
import HierarchyPanel, { HierarchyItem } from './components/HierarchyPanel';
import AssetBrowser from './components/AssetBrowser';
import Inspector from './components/Inspector';
import { InspectorField, ToolBtn, SetupDialog } from './components/Controls';
import { beginDrag, clamp } from './beginDrag';
import { readWireProps, round2 } from '../../shared/props';
import {
  isMessage, isForge, unhandled,
  type ToolMode, type LiveProp, type BridgeObject, type ScreenRect, type BridgeScene, type AssetPayload,
  type EditorToViewport, type EditorToBridge, type BridgeToEditor, type Forge,
} from '../../shared/protocol';

type DevStatus = 'idle' | 'starting' | 'running' | 'error';
type BridgeStatus = 'disconnected' | 'connecting' | 'connected';
type ShortcutKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

const api = window.electronAPI;
// Game objects are rarely named, so fall back to their text or texture before the generated id.
const liveLabel = (o: BridgeObject) =>
  o.name || (o.text !== undefined ? `"${o.text.replace(/\s+/g, ' ')}"` : o.textureKey) || o.id;

const PANEL_H = { min: 72, max: 480, initial: 180 };
const SIDE_W = { min: 140, max: 400 };
const BRIDGE_PING_MS = 2000;
const BRIDGE_PING_ATTEMPTS = 15;
const LIVE_REFRESH_MS = 500;

const TOOLS: { mode: ToolMode; icon: string; label: string; key: string }[] = [
  { mode: 'select', icon: '↖', label: 'Select (Q)', key: 'q' },
  { mode: 'move', icon: '✥', label: 'Move (W)', key: 'w' },
  { mode: 'rotate', icon: '↻', label: 'Rotate (E)', key: 'e' },
  { mode: 'scale', icon: '⤢', label: 'Scale (R)', key: 'r' },
];

/** Ref that always holds the latest value, so long-lived listeners never see stale state. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const [hierarchy, setHierarchy] = useState<HierarchyItem[]>([]);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  const [pendingSetupFolder, setPendingSetupFolder] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved');
  const [isDraggingAsset, setIsDraggingAsset] = useState(false);

  const [panelH, setPanelH] = useState(PANEL_H.initial);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'assets' | 'console'>('assets');
  const [hierarchyW, setHierarchyW] = useState(208);
  const [inspectorW, setInspectorW] = useState(256);

  const [devStatus, setDevStatus] = useState<DevStatus>('idle');
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [devLogs, setDevLogs] = useState('');
  const [devScripts, setDevScripts] = useState<string[]>([]);
  const [selectedScript, setSelectedScript] = useState('dev');

  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('disconnected');
  const [bridgeHasGame, setBridgeHasGame] = useState(true);
  const [bridgeScenes, setBridgeScenes] = useState<BridgeScene[]>([]);
  const [activeBridgeScene, setActiveBridgeScene] = useState<string | null>(null);
  const [bridgeObjects, setBridgeObjects] = useState<BridgeObject[]>([]);
  const [bridgeSelected, setBridgeSelected] = useState<BridgeObject | null>(null);
  const [bridgeScreenBounds, setBridgeScreenBounds] = useState<ScreenRect | null>(null);
  const [liveEditMode, setLiveEditMode] = useState(false);
  const bridgeSelectedId = bridgeSelected?.id ?? null;

  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSaveRef = useRef(false);
  const pendingLoadFolderRef = useRef<string | null>(null);
  const liveDragRef = useRef<{
    id: string; pointerId: number;
    startClientX: number; startClientY: number;
    startX: number; startY: number;
    moved: boolean;
  } | null>(null);

  // Target origin for outgoing posts: the dev game's origin when live, else the editor's own origin
  // (phaser.html is same-origin). Under file:// the origin is opaque ('null'), so '*' is unavoidable there.
  const targetOrigin = useMemo(() => {
    try {
      const o = new URL(devUrl ?? window.location.href).origin;
      return o === 'null' ? '*' : o;
    } catch { return '*'; }
  }, [devUrl]);
  const postToIframe = useCallback(
    (msg: EditorToViewport | Forge<EditorToBridge>) => iframeRef.current?.contentWindow?.postMessage(msg, targetOrigin),
    [targetOrigin],
  );
  const send: (msg: EditorToViewport) => void = postToIframe;
  const sendBridge = useCallback((msg: EditorToBridge) => postToIframe({ forge: true, ...msg }), [postToIframe]);
  const requestBridgeObjects = useCallback((sceneKey: string) => sendBridge({ type: 'FORGE_GET_OBJECTS', sceneKey }), [sendBridge]);
  const appendLog = useCallback((text: string) => setDevLogs(prev => prev + text), []);
  const markDirty = () => setSaveStatus('unsaved');
  const showConsole = () => { setActiveTab('console'); setPanelOpen(true); };
  const patchItem = (id: string, patch: Partial<HierarchyItem>) =>
    setHierarchy(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  const clearLiveSelection = () => { setBridgeSelected(null); setBridgeScreenBounds(null); };

  useEffect(() => {
    api.onDevServerOutput(appendLog);
    api.onDevServerStopped(() => { setDevStatus('idle'); setDevUrl(null); });
    return () => api.removeDevServerListeners();
  }, [appendLog]);

  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [devLogs]);

  const lockedKey = hierarchy.filter(i => i.locked).map(i => i.id).join('\n');
  useEffect(() => {
    send({ type: 'SET_LOCKED_IDS', ids: lockedKey ? lockedKey.split('\n') : [] });
  }, [lockedKey, send]);

  // Keep the live selection box in sync while the game animates the object.
  useEffect(() => {
    if (bridgeStatus !== 'connected' || !liveEditMode || !bridgeSelectedId) return;
    const timer = setInterval(() => sendBridge({ type: 'FORGE_SELECT', id: bridgeSelectedId, reason: 'refresh' }), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [bridgeStatus, liveEditMode, bridgeSelectedId, sendBridge]);

  // New game URL: reset bridge state and ping until the bridge answers (it also announces FORGE_READY itself).
  useEffect(() => {
    setBridgeStatus(devUrl ? 'connecting' : 'disconnected');
    setBridgeHasGame(true);
    setBridgeScenes([]);
    setBridgeObjects([]);
    setBridgeSelected(null);
    setBridgeScreenBounds(null);
    if (!devUrl) return;
    let attempts = 0;
    const timer = setInterval(() => {
      sendBridge({ type: 'FORGE_PING' });
      if (++attempts < BRIDGE_PING_ATTEMPTS) return;
      clearInterval(timer);
      setBridgeStatus(s => s === 'connecting' ? 'disconnected' : s);
    }, BRIDGE_PING_MS);
    pingTimerRef.current = timer;
    return () => clearInterval(timer);
  }, [devUrl, sendBridge]);

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
    if (!projectFolder || devUrl) return;
    pendingSaveRef.current = true;
    send({ type: 'GET_SCENE_STATE' });
  };

  const loadScene = async (folder: string) => {
    const data = await api.loadScene(folder);
    setSaveStatus('saved');
    if (!data?.objects?.length) return;
    const objects = await Promise.all(data.objects.map(async obj =>
      obj.kind === 'sprite' && obj.assetFullPath
        ? { ...obj, dataUrl: (await api.fileToDataUrl(obj.assetFullPath)) ?? '' }
        : obj));
    send({ type: 'LOAD_SCENE', objects });
  };

  // Prefer a saved choice, then `*:dev:*` variants (monorepos), then plain `dev`.
  const loadDevScripts = async (folder: string, saved?: string) => {
    const scripts = await api.readProjectScripts(folder);
    setDevScripts(scripts);
    setSelectedScript(
      (saved && scripts.includes(saved) ? saved : undefined) ??
      scripts.find(s => /:dev(:|$)/.test(s)) ??
      (scripts.includes('dev') ? 'dev' : scripts[0]) ??
      'dev');
  };

  const changeScript = (script: string) => {
    setSelectedScript(script);
    if (projectFolder) {
      api.writeProjectConfig(projectFolder, { canvasWidth: canvasSize.w, canvasHeight: canvasSize.h, devScript: script });
    }
  };

  const stopDev = async () => {
    await api.stopDevServer();
    setDevStatus('idle');
    setDevUrl(null);
  };

  const handleRunStop = async () => {
    if (devStatus === 'running' || devStatus === 'starting') return stopDev();
    if (!projectFolder) return;
    // Starting the game replaces the editor scene, so persist unsaved work first.
    if (saveStatus === 'unsaved') handleSave();
    setDevStatus('starting');
    setDevLogs('');
    showConsole();
    const result = await api.startDevServer(projectFolder, selectedScript);
    if (result.ok && result.url) {
      setDevStatus('running');
      setDevUrl(result.url);
    } else {
      setDevStatus('error');
      appendLog(`\n[Error: ${result.error ?? 'Unknown error'}]\n`);
    }
  };

  const installBridge = async () => {
    if (!projectFolder) return;
    const r = await api.installBridge(projectFolder);
    appendLog(r.ok
      ? `\n[Bridge installed: phaser-forge-bridge.js]\n` +
        `[Add it ONCE to ${r.entry ?? 'your game entry file'} (not to each scene) and pass your Phaser.Game:]\n` +
        `  import { installForgeBridge } from '${r.importPath ?? './phaser-forge-bridge.js'}';${r.importPath ? '' : '  // path relative to that file'}\n` +
        `  installForgeBridge(game);\n`
      : `\n[Bridge install failed: ${r.error ?? 'Unknown error'}]\n`);
    showConsole();
  };

  const openProject = async (folder: string, config: ProjectConfig) => {
    if (devStatus !== 'idle') await stopDev();
    loadDevScripts(folder, config.devScript);
    setProjectFolder(folder);
    setCanvasSize({ w: config.canvasWidth, h: config.canvasHeight });
    setHierarchy([]);
    useEditorStore.getState().setSelectedObject(null);
    useEditorStore.setState({ past: [], future: [] });
    pendingLoadFolderRef.current = folder;
    // Otherwise the iframe reloads (new size or leaving live mode) and its SCENE_READY triggers the load.
    const sizeChanged = config.canvasWidth !== canvasSize.w || config.canvasHeight !== canvasSize.h;
    if (!sizeChanged && !devUrl) send({ type: 'RESET_SCENE' });
  };

  const handleOpenProject = async () => {
    const folder = await api.openFolder();
    if (!folder) return;
    const config = await api.readProjectConfig(folder);
    if (config?.canvasWidth && config?.canvasHeight) openProject(folder, config);
    else setPendingSetupFolder(folder);
  };

  const handleSetupConfirm = async (w: number, h: number) => {
    const folder = pendingSetupFolder;
    if (!folder) return;
    setPendingSetupFolder(null);
    const config = { canvasWidth: w, canvasHeight: h };
    await api.writeProjectConfig(folder, config);
    openProject(folder, config);
  };

  const readDroppedAsset = (e: React.DragEvent): AssetPayload | null => {
    e.preventDefault();
    setIsDraggingAsset(false);
    const raw = e.dataTransfer.getData('application/phaser-asset');
    return raw ? JSON.parse(raw) : null;
  };

  const handleDropOnViewport = (e: React.DragEvent) => {
    const file = readDroppedAsset(e);
    const rect = iframeRef.current?.getBoundingClientRect();
    if (file && rect) send({ type: 'ADD_SPRITE_FROM_ASSET', file, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top });
  };

  const handleDropOnHierarchy = (e: React.DragEvent) => {
    const file = readDroppedAsset(e);
    if (file) send({ type: 'ADD_SPRITE_FROM_ASSET', file });
  };

  const selectLiveObject = (obj: BridgeObject) => {
    setBridgeSelected(obj);
    sendBridge({ type: 'FORGE_SELECT', id: obj.id });
  };

  const changeLiveScene = (key: string) => {
    setActiveBridgeScene(key);
    clearLiveSelection();
    requestBridgeObjects(key);
  };

  const setLiveProp = (prop: LiveProp, value: number | boolean) => {
    if (!bridgeSelected) return;
    setBridgeSelected({ ...bridgeSelected, [prop]: value });
    sendBridge({ type: 'FORGE_SET_PROP', id: bridgeSelected.id, prop, value });
  };

  const handleLiveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = liveDragRef.current;
    liveDragRef.current = null;
    const rect = iframeRef.current?.getBoundingClientRect();
    if (drag?.moved || !activeBridgeScene || bridgeStatus !== 'connected' || !rect) return;
    sendBridge({
      type: 'FORGE_PICK_OBJECT',
      sceneKey: activeBridgeScene,
      viewportX: e.clientX - rect.left,
      viewportY: e.clientY - rect.top,
    });
  };

  const handleLivePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = bridgeScreenBounds;
    const overlay = overlayRef.current?.getBoundingClientRect();
    if (!bridgeSelected || !b || !overlay) return;
    const x = e.clientX - overlay.left;
    const y = e.clientY - overlay.top;
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    liveDragRef.current = {
      id: bridgeSelected.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: bridgeSelected.x,
      startY: bridgeSelected.y,
      moved: false,
    };
  };

  const handleLivePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = liveDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    drag.moved = true;
    sendBridge({ type: 'FORGE_MOVE_OBJECT', id: drag.id, startX: drag.startX, startY: drag.startY, dx, dy });
  };

  const handleLivePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = liveDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.moved && activeBridgeScene) requestBridgeObjects(activeBridgeScene);
  };

  const onBridgeMessage = (m: BridgeToEditor) => {
    switch (m.type) {
      case 'FORGE_READY':
      case 'FORGE_PONG':
        setBridgeStatus('connected');
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        // Older bridges don't report hasGame.
        setBridgeHasGame(m.hasGame !== false);
        if (m.hasGame !== false) sendBridge({ type: 'FORGE_GET_SCENES' });
        break;
      case 'FORGE_SCENES': {
        const scenes: BridgeScene[] = m.scenes ?? [];
        const active = scenes.find(s => s.active)?.key ?? scenes[0]?.key ?? null;
        setBridgeScenes(scenes);
        setActiveBridgeScene(active);
        if (active) requestBridgeObjects(active);
        break;
      }
      case 'FORGE_OBJECTS':
        setBridgeObjects(m.objects ?? []);
        setActiveBridgeScene(m.sceneKey);
        break;
      case 'FORGE_SELECTED':
        setBridgeSelected(m.props ?? null);
        setBridgeScreenBounds(m.screenBounds ?? null);
        if (m.sceneKey && m.reason !== 'refresh' && m.reason !== 'move') {
          setActiveBridgeScene(m.sceneKey);
          requestBridgeObjects(m.sceneKey);
        }
        break;
      case 'FORGE_DESELECTED':
        clearLiveSelection();
        break;
      case 'FORGE_PROP_SET': {
        if (m.id !== bridgeSelectedId) break;
        setBridgeSelected(m.props ?? null);
        if (m.screenBounds) setBridgeScreenBounds(m.screenBounds);
        const sceneKey = m.sceneKey ?? activeBridgeScene;
        if (sceneKey) requestBridgeObjects(sceneKey);
        break;
      }
      default: unhandled(m);
    }
  };

  /** Returns true when the key was an editor shortcut. */
  const handleShortcut = useLatest((k: ShortcutKey) => {
    if (devUrl) return false;
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
    if (isForge(data)) return onBridgeMessage(data);
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
        api.saveScene(projectFolder, m.objects).then(ok => setSaveStatus(ok ? 'saved' : 'unsaved'));
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
    const handleDragEnd = () => setIsDraggingAsset(false);
    window.addEventListener('message', handleMessage);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('dragend', handleDragEnd);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('dragend', handleDragEnd);
    };
  }, [onMessage, handleShortcut]);

  const startSideResize = (e: React.MouseEvent, side: 'hierarchy' | 'inspector') => {
    const w0 = side === 'hierarchy' ? hierarchyW : inspectorW;
    const setW = side === 'hierarchy' ? setHierarchyW : setInspectorW;
    const dir = side === 'hierarchy' ? 1 : -1;
    beginDrag(e, 'ew-resize', dx => setW(clamp(w0 + dir * dx, SIDE_W.min, SIDE_W.max)));
  };

  const startPanelResize = (e: React.MouseEvent) => {
    const h0 = panelH;
    beginDrag(e, 'ns-resize', (_dx, dy) => setPanelH(clamp(h0 - dy, PANEL_H.min, PANEL_H.max)));
  };

  const iframeSrc = devUrl ?? `./phaser.html?w=${canvasSize.w}&h=${canvasSize.h}`;
  const { selectedId, snapEnabled } = useEditorStore(useShallow(s => ({ selectedId: s.selectedId, snapEnabled: s.snapEnabled })));
  const pastCount = useEditorStore(s => s.past.length);
  const canUndo = pastCount > 0;
  const canRedo = useEditorStore(s => s.future.length > 0);

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-900 text-white select-none overflow-hidden">

      {pendingSetupFolder && (
        <SetupDialog onConfirm={handleSetupConfirm} onCancel={() => setPendingSetupFolder(null)} />
      )}

      <header className="toolbar flex h-11 items-center gap-1 px-3 flex-shrink-0">
        <span className="font-bold text-sm text-white mr-3 tracking-wide whitespace-nowrap">⚡ Phaser Forge</span>

        <button onClick={handleOpenProject} title={projectFolder ?? 'Open Project Folder'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700 transition-all max-w-40 mr-1">
          📁 <span className="truncate hidden lg:inline">{projectFolder ? projectFolder.split(/[\\/]/).pop() : 'Open Project'}</span>
        </button>

        {projectFolder && (
          <span className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5 mr-2 hidden xl:block">
            {canvasSize.w}×{canvasSize.h}
          </span>
        )}

        <div className="w-px h-5 bg-gray-700 mr-1" />

        <div className="flex items-center gap-0.5">
          {TOOLS.map(t => (
            <ToolBtn key={t.mode} icon={t.icon} label={t.label} active={toolMode === t.mode} onClick={() => setTool(t.mode)} />
          ))}
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        <button onClick={toggleSnap} title="Snap to Grid"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-all ${
            snapEnabled ? 'border-blue-500 bg-blue-900/40 text-blue-300' : 'border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
          ⊞ <span className="hidden xl:inline">Snap</span>
        </button>

        <button onClick={() => send({ type: 'RESET_CAMERA' })} title="Reset Camera View (F)"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-gray-700 text-gray-400 hover:bg-gray-700 transition-all ml-0.5">
          ⌂ <span className="hidden xl:inline">Reset View</span>
        </button>

        <div className="flex items-center gap-0.5 ml-1">
          <ToolBtn icon="↩" label="Undo" disabled={!canUndo || !!devUrl} onClick={undo} />
          <ToolBtn icon="↪" label="Redo" disabled={!canRedo || !!devUrl} onClick={redo} />
        </div>

        <div className="flex-1" />
        {pastCount > 0 && <span className="text-xs text-gray-700 hidden xl:block mr-2">{pastCount} action{pastCount !== 1 ? 's' : ''}</span>}
        {projectFolder && !devUrl && (
          <span className={`text-[10px] hidden xl:block ${saveStatus === 'unsaved' ? 'text-yellow-600' : saveStatus === 'saving' ? 'text-gray-500' : 'text-gray-700'}`}>
            {saveStatus === 'saving' ? 'saving…' : saveStatus}
          </span>
        )}
        {devStatus === 'running' && (
          <span className="text-[10px] font-mono text-green-600 border border-green-900 rounded px-1.5 py-0.5 hidden xl:flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            {devUrl}
          </span>
        )}
        {projectFolder && devScripts.length > 0 && (
          <select
            value={selectedScript}
            onChange={e => changeScript(e.target.value)}
            disabled={devStatus === 'running' || devStatus === 'starting'}
            title="Which dev script (variant) to run"
            className="max-w-40 px-2 py-1.5 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600 focus:border-blue-500 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {devScripts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <ToolBtn
          icon={devStatus === 'running' ? '⏹' : devStatus === 'starting' ? '⏳' : '▶'}
          label={devStatus === 'running' ? 'Stop' : devStatus === 'starting' ? 'Starting…' : 'Run Game'}
          onClick={handleRunStop}
          disabled={!projectFolder || devStatus === 'starting'}
          extra={devStatus === 'running' ? 'text-red-400' : devStatus === 'error' ? 'text-orange-400' : 'text-green-400'}
        />
        {bridgeStatus === 'connected' && (
          <button
            title={liveEditMode ? 'Edit mode — click to select objects' : 'Play mode — interacting with game normally'}
            onClick={() => { setLiveEditMode(m => !m); setBridgeScreenBounds(null); }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-all ${
              liveEditMode
                ? 'border-yellow-500 bg-yellow-900/40 text-yellow-300'
                : 'border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
            {liveEditMode ? '🎯 Edit' : '🎮 Play'}
          </button>
        )}
        <ToolBtn icon="⌨" label="VS Code" onClick={() => projectFolder && api.openVSCode(projectFolder)} disabled={!projectFolder} />
        <ToolBtn icon="💾" label="Save (Ctrl+S)" onClick={handleSave} disabled={!projectFolder || !!devUrl} />
      </header>

      <div className="flex flex-1 overflow-hidden">

        <div style={{ width: hierarchyW }}
          className={`flex-shrink-0 relative ${isDraggingAsset ? 'ring-1 ring-inset ring-blue-600/40' : ''}`}
          onDragOver={isDraggingAsset ? e => e.preventDefault() : undefined}
          onDrop={isDraggingAsset ? handleDropOnHierarchy : undefined}
        >
          {devUrl ? (
            <aside className="flex flex-col border-r border-gray-700 bg-gray-800 h-full overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">Hierarchy</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${
                  bridgeStatus === 'connected' ? 'bg-green-900/50 text-green-400' :
                  bridgeStatus === 'connecting' ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-gray-700 text-gray-500'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    bridgeStatus === 'connected' ? 'bg-green-400' :
                    bridgeStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-gray-500'}`} />
                  {bridgeStatus}
                </span>
              </div>
              {bridgeScenes.length > 0 && (
                <div className="px-2 py-1.5 border-b border-gray-700 flex-shrink-0">
                  <select value={activeBridgeScene ?? ''} onChange={e => changeLiveScene(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500">
                    {bridgeScenes.map(s => (
                      <option key={s.key} value={s.key}>{s.key}{s.active ? ' ●' : ''}</option>
                    ))}
                  </select>
                  <button onClick={() => activeBridgeScene && requestBridgeObjects(activeBridgeScene)}
                    className="mt-1 w-full text-[10px] text-gray-600 hover:text-gray-300 transition-colors">↺ Refresh</button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto py-1">
                {bridgeStatus !== 'connected' ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                      {bridgeStatus === 'connecting' ? 'Connecting to game bridge…' : 'Bridge not detected in game.'}
                    </p>
                    <button onClick={installBridge}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">
                      Install Bridge
                    </button>
                  </div>
                ) : !bridgeHasGame ? (
                  <div className="p-4 text-xs text-gray-500 leading-relaxed">
                    <p className="mb-2">Bridge is loaded but can't find your Phaser.Game. Pass it once from your entry file:</p>
                    <code className="block bg-gray-900 rounded px-2 py-1.5 text-[10px] text-gray-300 font-mono select-text">installForgeBridge(game);</code>
                  </div>
                ) : bridgeObjects.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center py-6">No objects in scene.</p>
                ) : (
                  bridgeObjects.map(obj => (
                    <div key={obj.id} onClick={() => selectLiveObject(obj)}
                      className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-xs cursor-pointer transition-colors ${
                        bridgeSelectedId === obj.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700/60 hover:text-gray-200'}`}>
                      <span className="opacity-50 truncate max-w-16">{obj.type}</span>
                      <span className="truncate flex-1">{liveLabel(obj)}</span>
                      <span className="text-[9px] text-gray-600 font-mono">{Math.round(obj.x)},{Math.round(obj.y)}</span>
                    </div>
                  ))
                )}
              </div>
            </aside>
          ) : (
            <HierarchyPanel
              items={hierarchy} selectedId={selectedId}
              onSelect={selectObject} onDelete={deleteObject}
              onDuplicate={duplicateObject} onRename={renameObject}
              onAddPrimitive={shape => send({ type: 'ADD_PRIMITIVE', shape })}
              onToggleVisible={toggleVisible}
              onToggleLocked={toggleLocked}
            />
          )}
          {isDraggingAsset && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] text-blue-400 bg-gray-900/80 px-2 py-1 rounded">Drop to add at center</span>
            </div>
          )}
        </div>
        <div onMouseDown={e => startSideResize(e, 'hierarchy')}
          className="w-1 flex-shrink-0 cursor-ew-resize hover:bg-blue-500 transition-colors bg-transparent" />

        <main className="flex-1 bg-[#1e1e1e] relative overflow-hidden">
          <iframe ref={iframeRef} src={iframeSrc} className="w-full h-full border-none" title="Phaser Viewport" />

          {isDraggingAsset && (
            <div className="absolute inset-0 z-10 cursor-copy" onDragOver={e => e.preventDefault()} onDrop={handleDropOnViewport}>
              <div className="absolute inset-0 border-2 border-dashed border-blue-500/40 pointer-events-none" />
            </div>
          )}

          {devUrl && bridgeStatus === 'connected' && liveEditMode && !isDraggingAsset && (
            <div
              ref={overlayRef}
              className="absolute inset-0 z-10 cursor-crosshair"
              onClick={handleLiveClick}
              onPointerDown={handleLivePointerDown}
              onPointerMove={handleLivePointerMove}
              onPointerUp={handleLivePointerUp}
              onPointerCancel={() => { liveDragRef.current = null; }}
            >
              {bridgeScreenBounds && bridgeScreenBounds.width > 0 && bridgeScreenBounds.height > 0 && (
                <div
                  className="absolute border border-blue-400 shadow-[0_0_0_3px_rgba(59,130,246,0.25)] pointer-events-none"
                  style={{
                    left: bridgeScreenBounds.x,
                    top: bridgeScreenBounds.y,
                    width: bridgeScreenBounds.width,
                    height: bridgeScreenBounds.height,
                  }}
                >
                  {['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map(pos => (
                    <div key={pos} className={`absolute ${pos} w-2 h-2 bg-white border border-blue-500`} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
            {devUrl ? (
              <span className="bg-green-900/90 backdrop-blur text-green-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-green-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="bg-gray-900/80 backdrop-blur text-gray-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-gray-700">{toolMode}</span>
            )}
            {!devUrl && snapEnabled && <span className="bg-blue-900/80 backdrop-blur text-blue-300 text-xs px-2 py-1 rounded border border-blue-700">SNAP 32px</span>}
          </div>
          {!devUrl && (
            <div className="absolute bottom-3 left-3 text-gray-700 text-[10px] pointer-events-none">
              Q·W·E·R = tools &nbsp;·&nbsp; Scroll = zoom &nbsp;·&nbsp; Middle mouse = pan &nbsp;·&nbsp; F = reset view &nbsp;·&nbsp; Del = delete
            </div>
          )}
        </main>

        <div onMouseDown={e => startSideResize(e, 'inspector')}
          className="w-1 flex-shrink-0 cursor-ew-resize hover:bg-blue-500 transition-colors bg-transparent" />
        <aside style={{ width: inspectorW }} className="flex-shrink-0 flex flex-col border-l border-gray-700 bg-gray-800 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Inspector</span>
            {devUrl && <span className="text-[10px] text-green-600 font-medium">LIVE</span>}
          </div>

          {devUrl ? (
            bridgeSelected ? (
              <div className="p-3 space-y-4 text-sm">
                <div className="bg-gray-900 rounded px-3 py-2">
                  <div className="text-[10px] text-gray-500 mb-0.5">Type / Name</div>
                  <div className="text-xs text-white font-mono truncate">{bridgeSelected.type} — {liveLabel(bridgeSelected)}</div>
                  {bridgeSelected.textureKey && <div className="text-[10px] text-gray-500 mt-0.5">Texture: {bridgeSelected.textureKey}</div>}
                </div>
                <section>
                  <div className="section-label mb-2">Position</div>
                  <InspectorField label="X" value={Math.round(bridgeSelected.x)} step={1} onChange={v => setLiveProp('x', v)} />
                  <InspectorField label="Y" value={Math.round(bridgeSelected.y)} step={1} onChange={v => setLiveProp('y', v)} />
                  {bridgeSelected.displayWidth !== undefined && <div className="text-[10px] text-gray-600 text-right">display: {bridgeSelected.displayWidth}×{bridgeSelected.displayHeight}px</div>}
                </section>
                <section>
                  <div className="section-label mb-2">Rotation</div>
                  <InspectorField label="Angle (rad)" value={round2(bridgeSelected.rotation)} onChange={v => setLiveProp('rotation', v)} />
                  <div className="text-[10px] text-gray-600 text-right -mt-1">{Math.round((bridgeSelected.rotation * 180) / Math.PI)}°</div>
                </section>
                <section>
                  <div className="section-label mb-2">Scale</div>
                  <InspectorField label="Scale X" value={round2(bridgeSelected.scaleX)} min={0} onChange={v => setLiveProp('scaleX', v)} />
                  <InspectorField label="Scale Y" value={round2(bridgeSelected.scaleY)} min={0} onChange={v => setLiveProp('scaleY', v)} />
                </section>
                <section>
                  <div className="section-label mb-2">Appearance</div>
                  <InspectorField label="Alpha" value={round2(bridgeSelected.alpha)} min={0} max={1} onChange={v => setLiveProp('alpha', v)} />
                  <InspectorField label="Depth" value={bridgeSelected.depth} step={1} onChange={v => setLiveProp('depth', v)} />
                  <InspectorField label="Visible" value={bridgeSelected.visible} type="checkbox" onChange={v => setLiveProp('visible', v)} />
                </section>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="text-4xl mb-3 opacity-20">🎮</div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {bridgeStatus === 'connected' ? 'Click an object in the hierarchy.' : 'Waiting for bridge connection…'}
                </p>
              </div>
            )
          ) : selectedId ? (
            <Inspector selectedId={selectedId} onEdit={updateField} onDelete={deleteObject} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
              <div className="text-5xl mb-4 opacity-20">🎯</div>
              <p className="text-xs text-gray-500 leading-relaxed">Click an object in the viewport or hierarchy to inspect.</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="border-t border-gray-700 bg-gray-800 flex-shrink-0"
        style={{ height: panelOpen ? panelH + 36 : 36 }}>

        {panelOpen && (
          <div onMouseDown={startPanelResize}
            className="h-2 w-full cursor-ns-resize flex items-center justify-center group flex-shrink-0">
            <div className="w-16 h-0.5 rounded-full bg-gray-600 group-hover:bg-blue-500 transition-colors" />
          </div>
        )}

        <div className="px-3 flex items-center gap-1 h-9 border-b border-gray-700">
          <button onClick={() => setPanelOpen(o => !o)} className="text-gray-500 hover:text-white transition-colors mr-1">
            {panelOpen ? '▾' : '▸'}
          </button>
          {(['assets', 'console'] as const).map(tab => (
            <button key={tab} onClick={() => { setActiveTab(tab); setPanelOpen(true); }}
              className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                activeTab === tab && panelOpen
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}>
              {tab === 'assets' ? 'Assets' : (
                <span className="flex items-center gap-1">
                  Console
                  {devStatus === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                  {devStatus === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          {activeTab === 'assets' && (
            <button onClick={handleOpenProject} className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700">
              📁 {projectFolder ? 'Change' : 'Open Folder'}
            </button>
          )}
          {activeTab === 'console' && devLogs && (
            <button onClick={() => setDevLogs('')} className="text-xs text-gray-600 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-gray-700">
              Clear
            </button>
          )}
        </div>

        {panelOpen && activeTab === 'assets' && (
          <div style={{ height: panelH - 4 }} className="flex overflow-hidden">
            <AssetBrowser
              projectFolder={projectFolder}
              onOpenProject={handleOpenProject}
              onDragAsset={() => setIsDraggingAsset(true)}
            />
          </div>
        )}

        {panelOpen && activeTab === 'console' && (
          <div style={{ height: panelH - 4 }} className="bg-gray-950 overflow-y-auto font-mono text-[11px] p-2">
            {devLogs ? (
              <>
                <pre className="text-gray-300 whitespace-pre-wrap leading-relaxed">{devLogs}</pre>
                <div ref={consoleEndRef} />
              </>
            ) : (
              <p className="text-gray-700 text-center py-6">
                {devStatus === 'idle' ? 'Press ▶ Run Game to start the dev server.' : 'Waiting for output…'}
              </p>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
