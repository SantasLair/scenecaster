import { InspectorField } from '../components/Controls';
const round2 = (n: number) => Math.round(n * 100) / 100;
import type { BridgeObject } from '../../../shared/protocol';
import type { LiveBridge } from './useLiveBridge';

// Game objects are rarely named, so fall back to their text or texture before the generated id.
const liveLabel = (o: BridgeObject) =>
  o.name || (o.text !== undefined ? `"${o.text.replace(/\s+/g, ' ')}"` : o.textureKey) || o.id;

export function LiveObjects({ live }: { live: LiveBridge }) {
  const { bridgeStatus, bridgeScenes, activeBridgeScene, bridgeHasGame, bridgeObjects, bridgeSelectedId } = live;
  return (
    <aside className="flex flex-col border-r border-gray-700 bg-gray-800 h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">Objects</span>
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
          <select value={activeBridgeScene ?? ''} onChange={e => live.changeLiveScene(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500">
            {bridgeScenes.map(s => (
              <option key={s.key} value={s.key}>{s.key}{s.active ? ' ●' : ''}</option>
            ))}
          </select>
          <button onClick={() => activeBridgeScene && live.requestBridgeObjects(activeBridgeScene)}
            className="mt-1 w-full text-[10px] text-gray-600 hover:text-gray-300 transition-colors">↺ Refresh</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {bridgeStatus !== 'connected' ? (
          <div className="p-4 text-center">
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              {bridgeStatus === 'connecting' ? 'Connecting to game bridge…' : 'Bridge not detected in game.'}
            </p>
            <button onClick={live.installBridge}
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
            <div key={obj.id} onClick={() => live.selectLiveObject(obj)}
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
  );
}

export function LiveInspector({ live }: { live: LiveBridge }) {
  const { bridgeSelected, bridgeStatus, setLiveProp } = live;
  if (!bridgeSelected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
        <div className="text-4xl mb-3 opacity-20">🎮</div>
        <p className="text-xs text-gray-500 leading-relaxed">
          {bridgeStatus === 'connected' ? 'Click an object in the Objects panel.' : 'Waiting for bridge connection…'}
        </p>
      </div>
    );
  }
  return (
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
  );
}

/** Transparent layer over the game iframe that picks and drags objects through the bridge. */
export function LiveOverlay({ live }: { live: LiveBridge }) {
  const b = live.bridgeScreenBounds;
  return (
    <div ref={live.overlayRef} className="absolute inset-0 z-10 cursor-crosshair" {...live.overlayHandlers}>
      {b && b.width > 0 && b.height > 0 && (
        <div
          className="absolute border border-blue-400 shadow-[0_0_0_3px_rgba(59,130,246,0.25)] pointer-events-none"
          style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
        >
          {['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map(pos => (
            <div key={pos} className={`absolute ${pos} w-2 h-2 bg-white border border-blue-500`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LiveModeToggle({ live }: { live: LiveBridge }) {
  if (live.bridgeStatus !== 'connected') return null;
  return (
    <button
      title={live.liveEditMode ? 'Edit mode — click to select objects' : 'Play mode — interacting with game normally'}
      onClick={live.toggleLiveEditMode}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-all ${
        live.liveEditMode
          ? 'border-yellow-500 bg-yellow-900/40 text-yellow-300'
          : 'border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
      {live.liveEditMode ? '🎯 Edit' : '🎮 Play'}
    </button>
  );
}
