import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  type LiveProp, type BridgeObject, type ScreenRect, type BridgeScene,
  type EditorToViewport, type EditorToBridge, type BridgeToEditor, type Forge, unhandled,
} from '../../../shared/protocol';

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected';

const BRIDGE_PING_MS = 2000;
const BRIDGE_PING_ATTEMPTS = 15;
const LIVE_REFRESH_MS = 500;

interface Options {
  /** Dev game URL while live mode is active, else null (the iframe then shows the editor's own Phaser view). */
  liveUrl: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  projectFolder: string | null;
  appendLog: (text: string) => void;
  showConsole: () => void;
}

/** All live-mode state and behaviour: bridge connection, live selection, and the edit overlay's pointer handling. */
export function useLiveBridge({ liveUrl, iframeRef, projectFolder, appendLog, showConsole }: Options) {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('disconnected');
  const [bridgeHasGame, setBridgeHasGame] = useState(true);
  const [bridgeScenes, setBridgeScenes] = useState<BridgeScene[]>([]);
  const [activeBridgeScene, setActiveBridgeScene] = useState<string | null>(null);
  const [bridgeObjects, setBridgeObjects] = useState<BridgeObject[]>([]);
  const [bridgeSelected, setBridgeSelected] = useState<BridgeObject | null>(null);
  const [bridgeScreenBounds, setBridgeScreenBounds] = useState<ScreenRect | null>(null);
  const [liveEditMode, setLiveEditMode] = useState(false);
  const bridgeSelectedId = bridgeSelected?.id ?? null;

  const overlayRef = useRef<HTMLDivElement>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      const o = new URL(liveUrl ?? window.location.href).origin;
      return o === 'null' ? '*' : o;
    } catch { return '*'; }
  }, [liveUrl]);
  const postToIframe = useCallback(
    (msg: EditorToViewport | Forge<EditorToBridge>) => iframeRef.current?.contentWindow?.postMessage(msg, targetOrigin),
    [iframeRef, targetOrigin],
  );
  const sendBridge = useCallback((msg: EditorToBridge) => postToIframe({ forge: true, ...msg }), [postToIframe]);
  const requestBridgeObjects = useCallback((sceneKey: string) => sendBridge({ type: 'FORGE_GET_OBJECTS', sceneKey }), [sendBridge]);
  const clearLiveSelection = () => { setBridgeSelected(null); setBridgeScreenBounds(null); };

  // Keep the live selection box in sync while the game animates the object.
  useEffect(() => {
    if (bridgeStatus !== 'connected' || !liveEditMode || !bridgeSelectedId) return;
    const timer = setInterval(() => sendBridge({ type: 'FORGE_SELECT', id: bridgeSelectedId, reason: 'refresh' }), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [bridgeStatus, liveEditMode, bridgeSelectedId, sendBridge]);

  // New game URL: reset bridge state and ping until the bridge answers (it also announces FORGE_READY itself).
  useEffect(() => {
    setBridgeStatus(liveUrl ? 'connecting' : 'disconnected');
    setBridgeHasGame(true);
    setBridgeScenes([]);
    setBridgeObjects([]);
    setBridgeSelected(null);
    setBridgeScreenBounds(null);
    if (!liveUrl) return;
    let attempts = 0;
    const timer = setInterval(() => {
      sendBridge({ type: 'FORGE_PING' });
      if (++attempts < BRIDGE_PING_ATTEMPTS) return;
      clearInterval(timer);
      setBridgeStatus(s => s === 'connecting' ? 'disconnected' : s);
    }, BRIDGE_PING_MS);
    pingTimerRef.current = timer;
    return () => clearInterval(timer);
  }, [liveUrl, sendBridge]);

  const installBridge = async () => {
    if (!projectFolder) return;
    const r = await window.electronAPI.installBridge(projectFolder);
    appendLog(r.ok
      ? `\n[Bridge installed: phaser-forge-bridge.js]\n` +
        `[Add it ONCE to ${r.entry ?? 'your game entry file'} (not to each scene) and pass your Phaser.Game:]\n` +
        `  import { installForgeBridge } from '${r.importPath ?? './phaser-forge-bridge.js'}';${r.importPath ? '' : '  // path relative to that file'}\n` +
        `  installForgeBridge(game);\n`
      : `\n[Bridge install failed: ${r.error ?? 'Unknown error'}]\n`);
    showConsole();
  };

  const toggleLiveEditMode = () => { setLiveEditMode(m => !m); setBridgeScreenBounds(null); };

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

  const handleLivePointerCancel = () => { liveDragRef.current = null; };

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

  return {
    bridgeStatus, bridgeHasGame, bridgeScenes, activeBridgeScene, bridgeObjects, bridgeSelected, bridgeSelectedId,
    bridgeScreenBounds, liveEditMode, overlayRef,
    postToIframe, requestBridgeObjects, installBridge, toggleLiveEditMode,
    selectLiveObject, changeLiveScene, setLiveProp, onBridgeMessage,
    overlayHandlers: {
      onClick: handleLiveClick, onPointerDown: handleLivePointerDown, onPointerMove: handleLivePointerMove,
      onPointerUp: handleLivePointerUp, onPointerCancel: handleLivePointerCancel,
    },
  };
}

export type LiveBridge = ReturnType<typeof useLiveBridge>;
