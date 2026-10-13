// phaser-forge-bridge.js — Phaser Forge Editor Bridge v0.3
// Install it ONCE from your game entry (not in every scene) and pass your game:
//   import { installForgeBridge } from './phaser-forge-bridge.js';
//   installForgeBridge(game);
// A bare `import './phaser-forge-bridge.js'` also works if the game is on window.game or window.__phaserGame.
// It does nothing unless the game runs inside the editor's iframe.
// Editor maintainers: message types are mirrored in src/shared/protocol.ts; keep both in sync by hand.

const VERSION = '0.3';
const IN_EDITOR = typeof window !== 'undefined' && window.parent !== window;
const SETTABLE_PROPS = new Set(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'alpha', 'visible']);
const objects = new Map();
let nextId = 0;
let registeredGame = null;
let cachedGame = null;

/** Registers the running Phaser.Game with the editor. Safe to ship: a no-op outside the editor. */
export function installForgeBridge(game) {
  registeredGame = game;
  if (IN_EDITOR) announce();
}

const send = (msg) => window.parent.postMessage({ forge: true, ...msg }, '*');
const sceneKey = (scene) => scene?.sys?.settings?.key;

function ensureId(obj) {
  if (!obj.__forgeId) {
    const id = 'forge_' + nextId++;
    obj.__forgeId = id;
    objects.set(id, obj);
    obj.once?.('destroy', () => objects.delete(id));
  }
  return obj.__forgeId;
}

function getGame() {
  if (registeredGame) return registeredGame;
  if (cachedGame?.canvas?.isConnected) return cachedGame;
  cachedGame = window.game || window.__phaserGame ||
    Object.values(window).find(v => v?.constructor?.name === 'Game') || null;
  return cachedGame;
}

function getProps(obj) {
  const p = {
    id: ensureId(obj),
    name: obj.name || '',
    type: obj.type || obj.constructor?.name || 'Unknown',
    x: obj.x ?? 0,
    y: obj.y ?? 0,
    rotation: obj.rotation ?? 0,
    scaleX: obj.scaleX ?? 1,
    scaleY: obj.scaleY ?? 1,
    alpha: obj.alpha ?? 1,
    visible: obj.visible ?? true,
    depth: obj.depth ?? 0,
    originX: obj.originX ?? 0.5,
    originY: obj.originY ?? 0.5,
  };
  const key = obj.texture?.key;
  // Text objects render to a canvas texture with a random key, so report their content instead.
  if (typeof obj.text === 'string') p.text = obj.text;
  else if (key && key !== '__DEFAULT' && key !== '__MISSING') p.textureKey = key;
  if (obj.displayWidth) p.displayWidth = Math.round(obj.displayWidth);
  if (obj.displayHeight) p.displayHeight = Math.round(obj.displayHeight);
  return p;
}

function getBounds(obj) {
  try {
    const b = obj.getBounds?.();
    if (b && b.width > 0) return b;
  } catch (_) {}
  const w = obj.displayWidth ?? obj.width ?? 32;
  const h = obj.displayHeight ?? obj.height ?? 32;
  return { x: (obj.x ?? 0) - w * (obj.originX ?? 0.5), y: (obj.y ?? 0) - h * (obj.originY ?? 0.5), width: w, height: h };
}

// World-space bounds → iframe viewport pixels, accounting for camera and canvas CSS scaling.
function getScreenBounds(scene, b) {
  const canvas = scene?.game?.canvas;
  const cam = scene?.cameras?.main;
  if (!canvas || !cam) return null;
  const rect = canvas.getBoundingClientRect();
  const sx = (rect.width / canvas.width) * cam.zoom;
  const sy = (rect.height / canvas.height) * cam.zoom;
  return {
    x: rect.left + (b.x - cam.scrollX) * sx,
    y: rect.top + (b.y - cam.scrollY) * sy,
    width: b.width * sx,
    height: b.height * sy,
  };
}

function sendSelected(obj, reason) {
  const bounds = getBounds(obj);
  send({
    type: 'FORGE_SELECTED',
    id: ensureId(obj),
    sceneKey: sceneKey(obj.scene),
    reason,
    props: getProps(obj),
    bounds,
    screenBounds: getScreenBounds(obj.scene, bounds),
  });
}

function pickObject(scene, gameX, gameY) {
  const point = scene.cameras?.main?.getWorldPoint?.(gameX, gameY) ?? { x: gameX, y: gameY };
  const list = scene.children?.list ?? [];
  let best = null;
  let bestDepth = -Infinity;
  // Walk from the top of the display list; a lower entry only wins with a strictly higher depth.
  for (let i = list.length - 1; i >= 0; i--) {
    const obj = list[i];
    if (obj.__forgeInternal || obj.active === false || obj.visible === false) continue;
    const depth = obj.depth ?? 0;
    if (depth <= bestDepth) continue;
    const b = getBounds(obj);
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      best = obj;
      bestDepth = depth;
    }
  }
  return best;
}

const handlers = {
  FORGE_PING() {
    send({ type: 'FORGE_PONG', version: VERSION, hasGame: !!getGame() });
  },

  FORGE_GET_SCENES(_m, game) {
    const scenes = game.scene.scenes
      .filter(s => s.sys.settings.status > 0)
      .map(s => ({ key: sceneKey(s), active: s.sys.isActive(), visible: s.sys.isVisible() }));
    send({ type: 'FORGE_SCENES', scenes });
  },

  FORGE_GET_OBJECTS(m, game) {
    const scene = game.scene.getScene(m.sceneKey);
    if (!scene) return;
    const list = scene.children.list.filter(obj => !obj.__forgeInternal && obj.active !== false).map(getProps);
    send({ type: 'FORGE_OBJECTS', sceneKey: m.sceneKey, objects: list });
  },

  FORGE_SET_PROP(m) {
    const obj = objects.get(m.id);
    if (!obj) return;
    if (m.prop === 'depth') obj.setDepth?.(m.value);
    else if (SETTABLE_PROPS.has(m.prop)) obj[m.prop] = m.value;
    else return;
    send({
      type: 'FORGE_PROP_SET',
      id: m.id,
      sceneKey: sceneKey(obj.scene),
      prop: m.prop,
      value: m.value,
      props: getProps(obj),
      screenBounds: getScreenBounds(obj.scene, getBounds(obj)),
    });
  },

  FORGE_SELECT(m) {
    const obj = objects.get(m.id);
    if (obj) sendSelected(obj, m.reason);
  },

  // dx/dy are iframe pixels since drag start; convert to world units.
  FORGE_MOVE_OBJECT(m) {
    const obj = objects.get(m.id);
    const canvas = obj?.scene?.game?.canvas;
    const cam = obj?.scene?.cameras?.main;
    if (!canvas || !cam) return;
    const rect = canvas.getBoundingClientRect();
    obj.x = m.startX + (m.dx * (canvas.width / rect.width)) / cam.zoom;
    obj.y = m.startY + (m.dy * (canvas.height / rect.height)) / cam.zoom;
    sendSelected(obj, 'move');
  },

  FORGE_PICK_OBJECT(m, game) {
    const canvas = game.canvas;
    const rect = canvas.getBoundingClientRect();
    const gameX = (m.viewportX - rect.left) * (canvas.width / rect.width);
    const gameY = (m.viewportY - rect.top) * (canvas.height / rect.height);
    const preferred = m.sceneKey ? game.scene.getScene(m.sceneKey) : null;
    const scenes = [
      preferred,
      ...game.scene.scenes.filter(s => s !== preferred && s.sys?.isActive?.() && s.sys?.isVisible?.()),
    ].filter(Boolean);
    for (const scene of scenes) {
      const hit = pickObject(scene, gameX, gameY);
      if (hit) return sendSelected(hit, 'pick');
    }
    send({ type: 'FORGE_DESELECTED' });
  },
};

function announce() {
  send({ type: 'FORGE_READY', version: VERSION, hasGame: !!getGame() });
}

if (IN_EDITOR) {
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m?.forge || !handlers[m.type]) return;
    const game = getGame();
    if (!game && m.type !== 'FORGE_PING') return;
    handlers[m.type](m, game);
  });

  const announceLater = () => setTimeout(announce, 800);
  if (document.readyState === 'complete') announceLater();
  else window.addEventListener('load', announceLater);
}
