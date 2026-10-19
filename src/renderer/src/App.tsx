import { useShallow } from 'zustand/react/shallow';
import { findById } from '../../shared/phaseform/tree';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useEditorStore } from './store';
import { useSceneModel } from './sceneModel';
import { useHistory } from './history';
import ObjectsPanel from './components/ObjectsPanel';
import AssetBrowser from './components/AssetBrowser';
import FileSystemPanel from './components/FileSystemPanel';
import Inspector from './components/Inspector';
import ProblemsPanel from './components/ProblemsPanel';
import { ToolBtn, SetupDialog, ScenePicker } from './components/Controls';
import Dock, { DockContext, resetLayout, type DockCtx } from './Dock';
import type { DockviewApi } from 'dockview-react';
import { LIVE_MODE } from './live/config';
import { useLiveBridge } from './live/useLiveBridge';
import { LiveObjects, LiveInspector, LiveOverlay, LiveModeToggle } from './live/LivePanels';
import { useProject } from './hooks/useProject';
import { useDevServer } from './hooks/useDevServer';
import { useScene, TOOLS } from './hooks/useScene';
import { deriveUiState, type UiState } from './uiState';
import type { AssetPayload, EditorToViewport } from '../../shared/protocol';

const api = window.electronAPI;

function Empty({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-center p-6"><p className="text-xs text-gray-500 leading-relaxed">{text}</p></div>;
}

function ViewportPlaceholder({ ui, error, onOpenProject, onNewScene }: {
  ui: UiState; error?: string; onOpenProject: () => void; onNewScene: () => void;
}) {
  const btn = 'mt-4 px-3 py-1.5 rounded text-xs border border-blue-600 bg-blue-900/40 text-blue-200 hover:bg-blue-800/60';
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-gray-950">
      {ui.mode === 'no-project' && <><h2 className="text-lg text-gray-200">Welcome to Scenecaster</h2><p className="text-xs text-gray-500 mt-2">Open a Phaser project folder to start.</p><button className={btn} onClick={onOpenProject}>Open Project</button></>}
      {ui.mode === 'no-scene' && <><h2 className="text-lg text-gray-200">Select or create a scene</h2><p className="text-xs text-gray-500 mt-2">This project has no scene yet.</p><button className={btn} onClick={onNewScene}>New Scene</button></>}
      {ui.mode === 'loading' && <p className="text-xs text-gray-500">Loading scene…</p>}
      {ui.mode === 'scene-blocked' && <><h2 className="text-lg text-gray-200">Scene unavailable</h2><p className="text-xs text-red-400 mt-2 max-w-md">{error ?? 'The scene file could not be loaded.'}</p></>}
    </div>
  );
}

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [isDraggingAsset, setIsDraggingAsset] = useState(false);
  const dockRef = useRef<DockviewApi | null>(null);
  const onDockApi = useCallback((a: DockviewApi) => { dockRef.current = a; }, []);

  const showConsole = () => { dockRef.current?.getPanel('console')?.api.setActive(); };

  const project = useProject();
  const { projectFolder, pendingSetupFolder } = project;
  const dev = useDevServer({ projectFolder, persistDevScript: project.persistDevScript, showConsole });
  const liveUrl = LIVE_MODE ? dev.url : null;
  const live = useLiveBridge({ liveUrl, iframeRef, projectFolder, appendLog: dev.appendLog, showConsole });
  const send: (msg: EditorToViewport) => void = live.postToIframe;
  const scene = useScene({
    iframeRef, send, projectFolder,
    appendLog: dev.appendLog, showConsole,
    readOnly: !!liveUrl,
    onForgeMessage: m => { if (LIVE_MODE) live.onBridgeMessage(m); },
  });
  const {
    scenes, sceneKey, openScene, openSceneFile, moveObject, canvasSize, selectedObject, lockedIds, toolMode, saveStatus, saveBlocked, sceneStatus, createScene, problems,
    addObject, dropAsset, setTool, toggleSnap, undo, redo, updateField, commitEdit, selectObject,
    deleteObject, duplicateObject, renameObject, toggleVisible, toggleLocked, handleSave,
  } = scene;
  const textureKeys = (scene.project?.assets ?? []).filter(a => ['image', 'spritesheet', 'atlas'].includes(a.type)).map(a => a.key);
  const fontKeys = (scene.project?.assets ?? []).filter(a => a.type === 'bitmapFont').map(a => a.key);

  useEffect(() => {
    const handleDragEnd = () => setIsDraggingAsset(false);
    window.addEventListener('dragend', handleDragEnd);
    return () => window.removeEventListener('dragend', handleDragEnd);
  }, []);

  const handleRunStop = () => dev.runStop(() =>
    // Live mode replaces the editor scene with the game; never save implicitly, ask instead.
    !(LIVE_MODE && saveStatus === 'unsaved') ||
    window.confirm('This scene has unsaved changes and running the game will discard them. Run anyway?'));

  const openProject = async (folder: string) => {
    if (dev.status !== 'idle') await dev.stop();
    const settings = await api.readEditorSettings(folder);
    dev.loadScripts(folder, settings?.devScript);
    project.open(folder);
    if ((await scene.beginProject(folder)) === 'needs-setup') project.requestSetup(folder);
  };
  const handleOpenProject = () => project.choose(openProject);
  const handleCloseProject = async () => {
    if (!projectFolder) return;
    if (!liveUrl && saveStatus === 'unsaved') {
      const choice = await api.confirmUnsaved('This scene has unsaved changes. Save before closing the project?');
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await handleSave();
        const m = useSceneModel.getState();
        if (m.rev !== m.savedRev || m.projectRev !== m.projectSavedRev) return;
      }
    }
    await dev.reset();
    scene.endProject();
    project.close();
  };
  const handleSetupConfirm = (w: number, h: number) => {
    const folder = pendingSetupFolder;
    if (!folder) return;
    project.cancelSetup();
    scene.createProject(folder, w, h);
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
    if (file && rect) dropAsset(file, e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleDropOnObjects = (e: React.DragEvent) => {
    const file = readDroppedAsset(e);
    if (file && ui.canEditScene) dropAsset(file);
  };

  const iframeSrc = liveUrl ?? './phaser.html';
  const { selectedId, snapEnabled } = useEditorStore(useShallow(s => ({ selectedId: s.selectedId, snapEnabled: s.snapEnabled })));
  const pastCount = useHistory(s => s.past.length);
  const canUndo = pastCount > 0;
  const ui = deriveUiState({ projectFolder, sceneStatus, live: !!liveUrl });
  const canRedo = useHistory(s => s.future.length > 0);

  const dockCtx: DockCtx = {
    objects: (
      <div className={`relative h-full ${isDraggingAsset ? 'ring-1 ring-inset ring-blue-600/40' : ''}`}
        onDragOver={isDraggingAsset ? e => e.preventDefault() : undefined}
        onDrop={isDraggingAsset ? handleDropOnObjects : undefined}>
        {liveUrl ? <LiveObjects live={live} /> : !ui.canvasAvailable ? (
          <Empty text={ui.mode === 'no-project' ? 'Open a project to see its objects.' : ui.mode === 'scene-blocked' ? 'The scene file could not be loaded.' : 'No scene selected.'} />
        ) : (
          <ObjectsPanel
            objects={scene.scene.objects} selectedId={selectedId} lockedIds={lockedIds}
            onSelect={selectObject} onDelete={deleteObject}
            onDuplicate={duplicateObject} onRename={renameObject}
            onToggleVisible={toggleVisible} onToggleLocked={toggleLocked}
            onMove={moveObject} onAdd={addObject}
          />
        )}
        {isDraggingAsset && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] text-blue-400 bg-gray-900/80 px-2 py-1 rounded">Drop to add at center</span>
          </div>
        )}
      </div>
    ),
    filesystem: (
      <FileSystemPanel projectFolder={projectFolder} onOpenProject={handleOpenProject}
        onOpenScene={openSceneFile} onDragAsset={() => setIsDraggingAsset(true)} />
    ),
    assets: (
      <AssetBrowser projectFolder={projectFolder} onOpenProject={handleOpenProject} onDragAsset={() => setIsDraggingAsset(true)} />
    ),
    inspector: liveUrl ? <LiveInspector live={live} /> : !ui.canvasAvailable ? (
      <Empty text={ui.hasProject ? 'Select a scene to inspect its objects.' : 'Open a project to inspect objects.'} />
    ) : selectedObject ? (
      <Inspector key={selectedObject.id} object={selectedObject} textureKeys={textureKeys} fontKeys={fontKeys}
        isTopLevel={findById(scene.scene, selectedObject.id)?.parent === null}
        onChange={updateField} onCommit={commitEdit} onDelete={() => deleteObject(selectedObject.id)} />
    ) : (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="text-5xl mb-4 opacity-20">🎯</div>
        <p className="text-xs text-gray-500 leading-relaxed">Click an object in the viewport or Objects panel to inspect.</p>
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
            {!ui.hasProject ? 'Open a project to run its game.' : dev.status === 'idle' ? 'Press ▶ Run Game to start the dev server.' : 'Waiting for output…'}
          </p>
        )}
      </div>
    ),
    problems: problems.length === 0 ? (
      <p className="text-gray-600 text-xs text-center py-6">No problems with the scene file.</p>
    ) : <ProblemsPanel problems={problems} />,
    viewport: (
      <>
        {ui.canvasAvailable ? (
          <iframe ref={iframeRef} src={iframeSrc} className="w-full h-full border-none" title="Phaser Viewport" />
        ) : (
          <ViewportPlaceholder ui={ui} error={problems.find(p => p.level === 'error')?.message}
            onOpenProject={handleOpenProject} onNewScene={() => (scene.project ? createScene() : projectFolder && project.requestSetup(projectFolder))} />
        )}
        {isDraggingAsset && (
          <div className="absolute inset-0 z-10 cursor-copy" onDragOver={e => e.preventDefault()} onDrop={handleDropOnViewport}>
            <div className="absolute inset-0 border-2 border-dashed border-blue-500/40 pointer-events-none" />
          </div>
        )}
        {liveUrl && live.bridgeStatus === 'connected' && live.liveEditMode && !isDraggingAsset && <LiveOverlay live={live} />}
        {ui.canvasAvailable && <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
          {liveUrl ? (
            <span className="bg-green-900/90 text-green-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-green-700">LIVE</span>
          ) : (
            <span className="bg-gray-900/80 text-gray-300 text-xs px-2 py-1 rounded uppercase tracking-wider border border-gray-700">{toolMode}</span>
          )}
          {!liveUrl && snapEnabled && <span className="bg-blue-900/80 text-blue-300 text-xs px-2 py-1 rounded border border-blue-700">SNAP 32px</span>}
        </div>}
        {!liveUrl && ui.canvasAvailable && (
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
        <span className="font-bold text-sm text-white mr-3 tracking-wide whitespace-nowrap">Scenecaster</span>

        <button onClick={handleOpenProject} title={projectFolder ?? 'Open Project Folder'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700 transition-all max-w-40 mr-1">
          📁 <span className="truncate hidden lg:inline">{projectFolder ? projectFolder.split(/[\\/]/).pop() : 'Open Project'}</span>
        </button>

        {projectFolder && (
          <span className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5 mr-2 hidden xl:block">
            {canvasSize.w}×{canvasSize.h}
          </span>
        )}

        {projectFolder && <button onClick={handleCloseProject} title="Close Project"
          className="px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700 mr-1">✕ <span className="hidden xl:inline">Close</span></button>}

        {projectFolder && !liveUrl && (
          <ScenePicker scenes={scenes} current={sceneKey} hasFile={sceneStatus === 'open' || sceneStatus === 'blocked'}
            onOpen={openScene} onCreate={createScene} />
        )}

        <div className="w-px h-5 bg-gray-700 mr-1" />

        <div className="flex items-center gap-0.5">
          {TOOLS.map(t => (
            <ToolBtn key={t.mode} icon={t.icon} label={t.label} active={toolMode === t.mode} disabled={!ui.canEditScene} onClick={() => setTool(t.mode)} />
          ))}
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        <button onClick={toggleSnap} title="Snap to Grid" disabled={!ui.canEditScene}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-all ${
            snapEnabled ? 'border-blue-500 bg-blue-900/40 text-blue-300' : 'border-gray-700 text-gray-400 hover:bg-gray-700'} disabled:opacity-40 disabled:pointer-events-none`}>
          ⊞ <span className="hidden xl:inline">Snap</span>
        </button>

        <button onClick={() => send({ type: 'RESET_CAMERA' })} title="Reset Camera View (F)" disabled={!ui.canEditScene}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-gray-700 text-gray-400 hover:bg-gray-700 transition-all ml-0.5 disabled:opacity-40 disabled:pointer-events-none">
          ⌂ <span className="hidden xl:inline">Reset View</span>
        </button>

        <div className="flex items-center gap-0.5 ml-1">
          <ToolBtn icon="↩" label="Undo" disabled={!canUndo || !ui.canEditScene} onClick={undo} />
          <ToolBtn icon="↪" label="Redo" disabled={!canRedo || !ui.canEditScene} onClick={redo} />
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
          disabled={!ui.canRun || dev.status === 'starting'}
          extra={dev.status === 'running' ? 'text-red-400' : dev.status === 'error' ? 'text-orange-400' : 'text-green-400'}
        />
        {liveUrl && <LiveModeToggle live={live} />}
        <ToolBtn icon="⌨" label="VS Code" onClick={() => projectFolder && api.openVSCode(projectFolder)} disabled={!ui.canRun} />
        <ToolBtn icon="💾" label="Save (Ctrl+S)" onClick={handleSave} disabled={!ui.canSave || saveBlocked} />
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
