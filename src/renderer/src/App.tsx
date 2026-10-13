import { useShallow } from 'zustand/react/shallow';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useEditorStore } from './store';
import { useHistory } from './history';
import HierarchyPanel from './components/HierarchyPanel';
import AssetBrowser from './components/AssetBrowser';
import Inspector from './components/Inspector';
import ProblemsPanel from './components/ProblemsPanel';
import { ToolBtn, SetupDialog } from './components/Controls';
import Dock, { DockContext, resetLayout, type DockCtx } from './Dock';
import type { DockviewApi } from 'dockview-react';
import { LIVE_MODE } from './live/config';
import { useLiveBridge } from './live/useLiveBridge';
import { LiveHierarchy, LiveInspector, LiveOverlay, LiveModeToggle } from './live/LivePanels';
import { useProject } from './hooks/useProject';
import { useDevServer } from './hooks/useDevServer';
import { useScene, TOOLS } from './hooks/useScene';
import type { AssetPayload, EditorToViewport } from '../../shared/protocol';

const api = window.electronAPI;

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [isDraggingAsset, setIsDraggingAsset] = useState(false);
  const dockRef = useRef<DockviewApi | null>(null);
  const onDockApi = useCallback((a: DockviewApi) => { dockRef.current = a; }, []);

  const showConsole = () => { dockRef.current?.getPanel('console')?.api.setActive(); };

  const project = useProject();
  const { projectFolder, canvasSize, pendingSetupFolder } = project;
  const dev = useDevServer({ projectFolder, persistDevScript: project.persistDevScript, showConsole });
  const liveUrl = LIVE_MODE ? dev.url : null;
  const live = useLiveBridge({ liveUrl, iframeRef, projectFolder, appendLog: dev.appendLog, showConsole });
  const send: (msg: EditorToViewport) => void = live.postToIframe;
  const scene = useScene({
    iframeRef, send, projectFolder, devScript: dev.selectedScript, canvasSize,
    ensureConfigPersisted: project.ensureConfigPersisted,
    appendLog: dev.appendLog, showConsole,
    readOnly: !!liveUrl,
    onForgeMessage: m => { if (LIVE_MODE) live.onBridgeMessage(m); },
  });
  const {
    hierarchy, toolMode, saveStatus, saveBlocked, problems, addPrimitive, dropAsset, setTool, toggleSnap, undo, redo, updateField, commitEdit, selectObject,
    deleteObject, duplicateObject, renameObject, toggleVisible, toggleLocked, handleSave,
  } = scene;

  useEffect(() => {
    const handleDragEnd = () => setIsDraggingAsset(false);
    window.addEventListener('dragend', handleDragEnd);
    return () => window.removeEventListener('dragend', handleDragEnd);
  }, []);

  const handleRunStop = () => dev.runStop(() =>
    // Live mode replaces the editor scene with the game; never save implicitly, ask instead.
    !(LIVE_MODE && saveStatus === 'unsaved') ||
    window.confirm('This scene has unsaved changes and running the game will discard them. Run anyway?'));

  const openProject = async (folder: string, config: ProjectConfig, persisted: boolean) => {
    if (dev.status !== 'idle') await dev.stop();
    dev.loadScripts(folder, config.devScript);
    const sizeChanged = config.canvasWidth !== canvasSize.w || config.canvasHeight !== canvasSize.h;
    project.open(folder, config, persisted);
    // Otherwise the iframe reloads (new size or leaving live mode) and its SCENE_READY triggers the load.
    scene.beginProject(folder, !sizeChanged && !liveUrl);
  };
  const handleOpenProject = () => project.choose(openProject);
  const handleSetupConfirm = (w: number, h: number) => project.confirmSetup(openProject, w, h);

  const readDroppedAsset = (e: React.DragEvent): AssetPayload | null => {
    e.preventDefault();
    setIsDraggingAsset(false);
    const raw = e.dataTransfer.getData('application/phaser-asset');
    return raw ? JSON.parse(raw) : null;
  };

  const handleDropOnViewport = (e: React.DragEvent) => {
    const file = readDroppedAsset(e);
    const rect = iframeRef.current?.getBoundingClientRect();
    if (file && rect) dropAsset(file, e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleDropOnHierarchy = (e: React.DragEvent) => {
    const file = readDroppedAsset(e);
    if (file) dropAsset(file);
  };

  const iframeSrc = liveUrl ?? `./phaser.html?w=${canvasSize.w}&h=${canvasSize.h}`;
  const { selectedId, snapEnabled } = useEditorStore(useShallow(s => ({ selectedId: s.selectedId, snapEnabled: s.snapEnabled })));
  const pastCount = useHistory(s => s.past.length);
  const canUndo = pastCount > 0;
  const canRedo = useHistory(s => s.future.length > 0);

  const dockCtx: DockCtx = {
    hierarchy: (
      <div className={`relative h-full ${isDraggingAsset ? 'ring-1 ring-inset ring-blue-600/40' : ''}`}
        onDragOver={isDraggingAsset ? e => e.preventDefault() : undefined}
        onDrop={isDraggingAsset ? handleDropOnHierarchy : undefined}>
        {liveUrl ? <LiveHierarchy live={live} /> : (
          <HierarchyPanel
            items={hierarchy} selectedId={selectedId}
            onSelect={selectObject} onDelete={deleteObject}
            onDuplicate={duplicateObject} onRename={renameObject}
            onAddPrimitive={addPrimitive}
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
    ),
    assets: (
      <AssetBrowser projectFolder={projectFolder} onOpenProject={handleOpenProject} onDragAsset={() => setIsDraggingAsset(true)} />
    ),
    inspector: liveUrl ? <LiveInspector live={live} /> : selectedId ? (
      <Inspector selectedId={selectedId} onEdit={updateField} onCommit={commitEdit} onDelete={deleteObject} />
    ) : (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="text-5xl mb-4 opacity-20">🎯</div>
        <p className="text-xs text-gray-500 leading-relaxed">Click an object in the viewport or hierarchy to inspect.</p>
      </div>
    ),
    console: (
      <div className="relative min-h-full bg-gray-950 font-mono text-[11px] p-2">
        {dev.logs && (
          <button onClick={() => dev.clearLogs()} className="sticky float-right top-0 text-xs text-gray-500 hover:text-white px-2 py-0.5 rounded hover:bg-gray-700">Clear</button>
        )}
        {dev.logs ? (
          <>
            <pre className="text-gray-300 whitespace-pre-wrap leading-relaxed">{dev.logs}</pre>
            <div ref={dev.consoleEndRef} />
          </>
        ) : (
          <p className="text-gray-700 text-center py-6">
            {dev.status === 'idle' ? 'Press ▶ Run Game to start the dev server.' : 'Waiting for output…'}
          </p>
        )}
      </div>
    ),
    problems: problems.length === 0 ? (
      <p className="text-gray-600 text-xs text-center py-6">No problems with the scene file.</p>
    ) : <ProblemsPanel problems={problems} />,
    viewport: (
      <>
        <iframe ref={iframeRef} src={iframeSrc} className="w-full h-full border-none" title="Phaser Viewport" />
        {isDraggingAsset && (
          <div className="absolute inset-0 z-10 cursor-copy" onDragOver={e => e.preventDefault()} onDrop={handleDropOnViewport}>
            <div className="absolute inset-0 border-2 border-dashed border-blue-500/40 pointer-events-none" />
          </div>
        )}
        {liveUrl && live.bridgeStatus === 'connected' && live.liveEditMode && !isDraggingAsset && <LiveOverlay live={live} />}
        <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
          {liveUrl ? (
            <span className="bg-green-900/90 text-green-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-green-700">LIVE</span>
          ) : (
            <span className="bg-gray-900/80 text-gray-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-gray-700">{toolMode}</span>
          )}
          {!liveUrl && snapEnabled && <span className="bg-blue-900/80 text-blue-300 text-xs px-2 py-1 rounded border border-blue-700">SNAP 32px</span>}
        </div>
        {!liveUrl && (
          <div className="absolute bottom-3 left-3 text-gray-700 text-[10px] pointer-events-none">
            Q·W·E·R = tools &nbsp;·&nbsp; Scroll = zoom &nbsp;·&nbsp; Middle mouse = pan &nbsp;·&nbsp; F = reset view &nbsp;·&nbsp; Del = delete
          </div>
        )}
      </>
    ),
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-900 text-white select-none overflow-hidden">

      {pendingSetupFolder && (
        <SetupDialog onConfirm={handleSetupConfirm} onCancel={() => project.cancelSetup()} />
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
        {dev.status === 'running' && dev.url && (
          <button onClick={() => dev.url && api.openLocalUrl(dev.url)} title="Open in browser"
            className="text-[10px] font-mono text-green-500 border border-green-900 hover:bg-green-900/30 rounded px-1.5 py-0.5 flex items-center gap-1 transition-all">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            <span className="hidden xl:inline">{dev.url}</span> ↗
          </button>
        )}
        {projectFolder && dev.scripts.length > 0 && (
          <select
            value={dev.selectedScript}
            onChange={e => dev.changeScript(e.target.value)}
            disabled={dev.status === 'running' || dev.status === 'starting'}
            title="Which dev script (variant) to run"
            className="max-w-40 px-2 py-1.5 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600 focus:border-blue-500 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {dev.scripts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <ToolBtn
          icon={dev.status === 'running' ? '⏹' : dev.status === 'starting' ? '⏳' : '▶'}
          label={dev.status === 'running' ? 'Stop' : dev.status === 'starting' ? 'Starting…' : 'Run Game'}
          onClick={handleRunStop}
          disabled={!projectFolder || dev.status === 'starting'}
          extra={dev.status === 'running' ? 'text-red-400' : dev.status === 'error' ? 'text-orange-400' : 'text-green-400'}
        />
        {liveUrl && <LiveModeToggle live={live} />}
        <ToolBtn icon="⌨" label="VS Code" onClick={() => projectFolder && api.openVSCode(projectFolder)} disabled={!projectFolder} />
        <ToolBtn icon="💾" label="Save (Ctrl+S)" onClick={handleSave} disabled={!projectFolder || !!liveUrl || saveBlocked} />
        <ToolBtn icon="▦" label="Reset layout" onClick={() => resetLayout(dockRef.current)} />
      </header>

      <div className="flex-1 min-h-0">
        <DockContext.Provider value={dockCtx}>
          <Dock onApi={onDockApi} />
        </DockContext.Provider>
      </div>
    </div>
  );
}
