import { useShallow } from 'zustand/react/shallow';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type React from 'react';
import { useEditorStore, ObjectProps } from './store';
import HierarchyPanel, { HierarchyItem } from './components/HierarchyPanel';
import AssetBrowser from './components/AssetBrowser';
import Inspector from './components/Inspector';
import { ToolBtn, SetupDialog } from './components/Controls';
import { beginDrag, clamp } from './beginDrag';
import { readWireProps } from '../../shared/props';
import { DEFAULT_SCENE } from '../../shared/layout';
import { LIVE_MODE } from './live/config';
import { useLiveBridge } from './live/useLiveBridge';
import { LiveHierarchy, LiveInspector, LiveOverlay, LiveModeToggle } from './live/LivePanels';
import {
  isMessage, isForge, unhandled,
  type ToolMode, type AssetPayload, type SceneObject, type EditorToViewport,
} from '../../shared/protocol';

type DevStatus = 'idle' | 'starting' | 'running' | 'error';
type ShortcutKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

const api = window.electronAPI;

const PANEL_H = { min: 72, max: 480, initial: 180 };
const SIDE_W = { min: 140, max: 400 };

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


  const pendingSaveRef = useRef(false);
  /** True once scenecaster/project.json exists; opening a project writes nothing, the first save or setting change does. */
  const configPersistedRef = useRef(false);
  const pendingLoadFolderRef = useRef<string | null>(null);

  const appendLog = useCallback((text: string) => setDevLogs(prev => prev + text), []);
  const markDirty = () => setSaveStatus('unsaved');
  const showConsole = () => { setActiveTab('console'); setPanelOpen(true); };
  const liveUrl = LIVE_MODE ? devUrl : null;
  const live = useLiveBridge({ liveUrl, iframeRef, projectFolder, appendLog, showConsole });
  const send: (msg: EditorToViewport) => void = live.postToIframe;
  const patchItem = (id: string, patch: Partial<HierarchyItem>) =>
    setHierarchy(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));

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
    if (!projectFolder || liveUrl) return;
    pendingSaveRef.current = true;
    send({ type: 'GET_SCENE_STATE' });
  };

  /** A failed save keeps the scene dirty and says why; the previous good file is never replaced by a partial one. */
  const saveSceneFiles = async (folder: string, objects: SceneObject[]) => {
    const fail = (error?: string) => { setSaveStatus('unsaved'); appendLog(`\n[Save failed: ${error ?? 'Unknown error'}]\n`); showConsole(); };
    if (!configPersistedRef.current) {
      const cfg = await api.writeProjectConfig(folder, { canvasWidth: canvasSize.w, canvasHeight: canvasSize.h, devScript: selectedScript });
      if (!cfg.ok) return fail(cfg.error);
      configPersistedRef.current = true;
    }
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
      api.writeProjectConfig(projectFolder, { canvasWidth: canvasSize.w, canvasHeight: canvasSize.h, devScript: script })
        .then(r => { configPersistedRef.current = r.ok; });
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
    // Live mode replaces the editor scene with the game; never save implicitly, ask instead.
    if (LIVE_MODE && saveStatus === 'unsaved' && !window.confirm('This scene has unsaved changes and running the game will discard them. Run anyway?')) return;
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


  const openProject = async (folder: string, config: ProjectConfig, persisted: boolean) => {
    if (devStatus !== 'idle') await stopDev();
    loadDevScripts(folder, config.devScript);
    configPersistedRef.current = persisted;
    setProjectFolder(folder);
    setCanvasSize({ w: config.canvasWidth, h: config.canvasHeight });
    setHierarchy([]);
    useEditorStore.getState().setSelectedObject(null);
    useEditorStore.setState({ past: [], future: [] });
    pendingLoadFolderRef.current = folder;
    // Otherwise the iframe reloads (new size or leaving live mode) and its SCENE_READY triggers the load.
    const sizeChanged = config.canvasWidth !== canvasSize.w || config.canvasHeight !== canvasSize.h;
    if (!sizeChanged && !liveUrl) send({ type: 'RESET_SCENE' });
  };

  const handleOpenProject = async () => {
    const folder = await api.openFolder();
    if (!folder) return;
    const config = await api.readProjectConfig(folder);
    if (config?.canvasWidth && config?.canvasHeight) openProject(folder, config, true);
    else setPendingSetupFolder(folder);
  };

  const handleSetupConfirm = async (w: number, h: number) => {
    const folder = pendingSetupFolder;
    if (!folder) return;
    setPendingSetupFolder(null);
    const config = { canvasWidth: w, canvasHeight: h };
    openProject(folder, config, false);
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


  /** Returns true when the key was an editor shortcut. */
  const handleShortcut = useLatest((k: ShortcutKey) => {
    if (liveUrl) return false;
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
    if (isForge(data)) return LIVE_MODE ? live.onBridgeMessage(data) : undefined;
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

  const iframeSrc = liveUrl ?? `./phaser.html?w=${canvasSize.w}&h=${canvasSize.h}`;
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
          <ToolBtn icon="↩" label="Undo" disabled={!canUndo || !!liveUrl} onClick={undo} />
          <ToolBtn icon="↪" label="Redo" disabled={!canRedo || !!liveUrl} onClick={redo} />
        </div>

        <div className="flex-1" />
        {pastCount > 0 && <span className="text-xs text-gray-700 hidden xl:block mr-2">{pastCount} action{pastCount !== 1 ? 's' : ''}</span>}
        {projectFolder && !liveUrl && (
          <span className={`text-[10px] hidden xl:block ${saveStatus === 'unsaved' ? 'text-yellow-600' : saveStatus === 'saving' ? 'text-gray-500' : 'text-gray-700'}`}>
            {saveStatus === 'saving' ? 'saving…' : saveStatus}
          </span>
        )}
        {devStatus === 'running' && devUrl && (
          <button onClick={() => api.openLocalUrl(devUrl)} title="Open in browser"
            className="text-[10px] font-mono text-green-500 border border-green-900 hover:bg-green-900/30 rounded px-1.5 py-0.5 flex items-center gap-1 transition-all">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            <span className="hidden xl:inline">{devUrl}</span> ↗
          </button>
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
        {liveUrl && <LiveModeToggle live={live} />}
        <ToolBtn icon="⌨" label="VS Code" onClick={() => projectFolder && api.openVSCode(projectFolder)} disabled={!projectFolder} />
        <ToolBtn icon="💾" label="Save (Ctrl+S)" onClick={handleSave} disabled={!projectFolder || !!liveUrl} />
      </header>

      <div className="flex flex-1 overflow-hidden">

        <div style={{ width: hierarchyW }}
          className={`flex-shrink-0 relative ${isDraggingAsset ? 'ring-1 ring-inset ring-blue-600/40' : ''}`}
          onDragOver={isDraggingAsset ? e => e.preventDefault() : undefined}
          onDrop={isDraggingAsset ? handleDropOnHierarchy : undefined}
        >
          {liveUrl ? (
            <LiveHierarchy live={live} />
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

          {liveUrl && live.bridgeStatus === 'connected' && live.liveEditMode && !isDraggingAsset && <LiveOverlay live={live} />}

          <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
            {liveUrl ? (
              <span className="bg-green-900/90 backdrop-blur text-green-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-green-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="bg-gray-900/80 backdrop-blur text-gray-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-gray-700">{toolMode}</span>
            )}
            {!liveUrl && snapEnabled && <span className="bg-blue-900/80 backdrop-blur text-blue-300 text-xs px-2 py-1 rounded border border-blue-700">SNAP 32px</span>}
          </div>
          {!liveUrl && (
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
            {liveUrl && <span className="text-[10px] text-green-600 font-medium">LIVE</span>}
          </div>

          {liveUrl ? (
            <LiveInspector live={live} />
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
