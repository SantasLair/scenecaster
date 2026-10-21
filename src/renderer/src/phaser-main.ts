import * as Phaser from 'phaser';
import { build as buildPhaseform } from 'phaseform-loader';
import {
  isMessage, unhandled,
  type EditorToViewport, type ViewportToEditor, type ToolMode, type ViewAsset, type LiveField,
} from '../../shared/protocol';
import type { PfObject, PfScene, Vec2 } from '../../shared/phaseform/types';
import { subtreeIds, walk } from '../../shared/phaseform/tree';

const ARROW_LEN = 65;
const ROT_RADIUS = 60;
const HANDLE_SZ = 14;
const GRID = 32;
const PLACEHOLDER_SZ = 64;

// Editor graphics sit far outside any depth a document is likely to use.
const D_OUTSIDE = -1e9;
const D_CANVAS = -1e9 + 1;
const D_GRID = -1e9 + 2;
const D_BORDER = 1e9;
const D_SEL = 1e9 + 1;
const D_GIZMO = 1e9 + 2;
const D_HANDLE = 1e9 + 3;

type GO = Phaser.GameObjects.GameObject;
type Matrix = Phaser.GameObjects.Components.TransformMatrix;

/** What the viewport touches on a built object; every loader-built type has the transform part. */
interface Live extends GO {
  x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  getWorldTransformMatrix(temp?: Matrix, parent?: Matrix): Matrix;
  setScale(x: number, y?: number): unknown;
  setAlpha(a: number): unknown;
  setVisible(v: boolean): unknown;
  setDepth(d: number): unknown;
  setOrigin?(x: number, y?: number): unknown;
  setFlipX?(v: boolean): unknown;
  setFlipY?(v: boolean): unknown;
  getBounds?(out?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle;
}
const live = (go: GO) => go as Live;

const FLIPPABLE = new Set(['image', 'sprite', 'tileSprite']);
const ORIGIN_ZERO = new Set(['text', 'bitmapText']);
const NO_ORIGIN = new Set(['container', 'graphics']);

const post = (msg: ViewportToEditor) => window.parent.postMessage(msg, '*');
const round = (v: number, places: number) => { const f = 10 ** places; return Math.round(v * f) / f; };
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const vec = (v: unknown, def: Vec2): Vec2 => {
  const o = v as Partial<Vec2> | null | undefined;
  return { x: num(o?.x, def.x), y: num(o?.y, def.y) };
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Any CSS colour as a Phaser colour number and alpha (the browser parses it, so names and rgb() work too). */
function cssColor(s: string | undefined, fallback: string): { color: number; alpha: number } {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return { color: 0, alpha: 1 };
  ctx.fillStyle = fallback;
  if (s) ctx.fillStyle = s;
  const v = String(ctx.fillStyle);
  if (v.startsWith('#')) return { color: parseInt(v.slice(1, 7), 16), alpha: 1 };
  const n = (v.match(/[\d.]+/g) ?? []).map(Number);
  return { color: ((n[0] ?? 0) << 16) | ((n[1] ?? 0) << 8) | (n[2] ?? 0), alpha: n[3] ?? 1 };
}

class EditorScene extends Phaser.Scene {
  /** Top-level objects built from the document (placeholders included), in document order. */
  private roots: GO[] = [];
  private objById = new Map<string, GO>();
  private idByObj = new Map<GO, string>();
  private typeById = new Map<string, string>();

  private selectedId: string | null = null;

  private outsideGfx!: Phaser.GameObjects.Graphics;
  private canvasGfx!: Phaser.GameObjects.Graphics;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private borderGfx!: Phaser.GameObjects.Graphics;
  private selGfx!: Phaser.GameObjects.Graphics;
  private gizmoGfx!: Phaser.GameObjects.Graphics;
  private bounds = new Phaser.Geom.Rectangle();
  private mA = new Phaser.GameObjects.Components.TransformMatrix();
  private mB = new Phaser.GameObjects.Components.TransformMatrix();

  private hX!: Phaser.GameObjects.Rectangle;
  private hY!: Phaser.GameObjects.Rectangle;
  private hRot!: Phaser.GameObjects.Rectangle;
  private hSX!: Phaser.GameObjects.Rectangle;
  private hSY!: Phaser.GameObjects.Rectangle;
  private handles: GO[] = [];
  /** World position and local scale of the selection when a handle drag started, and the handle's position. */
  private handleStart = { hx: 0, hy: 0, wx: 0, wy: 0, scaleX: 1, scaleY: 1 };
  private handleMoved = false;
  /** Drag of an object's body: pointer and object start positions in world space. */
  private bodyDrag: { id: string; px: number; py: number; wx: number; wy: number; moved: boolean } | null = null;

  private toolMode: ToolMode = 'select';
  private snapOn = false;
  private lockedIds = new Set<string>();

  private isPanning = false;
  private panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

  /** Texture keys with the asset description they were made from. Textures persist across LOAD_SCENE. */
  private texSig = new Map<string, string>();
  /** Textures still decoding, keyed by texture key; every build waits for all of them. */
  private texPending = new Map<string, Promise<string | null>>();
  private animSig = new Map<string, string>();
  private loadToken = 0;
  /** SET_OBJECT messages received while a build waits for textures; applied once it is built. */
  private queued: Extract<EditorToViewport, { type: 'SET_OBJECT' }>[] | null = null;
  private sceneSize = { width: 1280, height: 720 };

  constructor() { super('EditorScene'); }

  create() {
    this.cameras.main.setBackgroundColor('#1e1e1e');
    this.outsideGfx = this.add.graphics().setDepth(D_OUTSIDE);
    this.canvasGfx = this.add.graphics().setDepth(D_CANVAS);
    this.gridGfx = this.add.graphics().setDepth(D_GRID);
    this.borderGfx = this.add.graphics().setDepth(D_BORDER);
    this.drawFrame(this.sceneSize, undefined);

    this.selGfx = this.add.graphics().setDepth(D_SEL);
    this.gizmoGfx = this.add.graphics().setDepth(D_GIZMO);

    const makeHandle = () =>
      this.add.rectangle(0, 0, HANDLE_SZ, HANDLE_SZ, 0xff0000, 0)
        .setDepth(D_HANDLE).setVisible(false).setInteractive({ draggable: true });
    this.hX = makeHandle();
    this.hY = makeHandle();
    this.hRot = makeHandle();
    this.hSX = makeHandle();
    this.hSY = makeHandle();
    this.handles = [this.hX, this.hY, this.hRot, this.hSX, this.hSY];

    // Handles are top-level editor objects, so dragX/dragY are world coordinates (start position plus pointer delta).
    const onHandleDrag = (handle: Phaser.GameObjects.Rectangle, apply: (o: Live, id: string, dragX: number, dragY: number) => void) => {
      handle.on('dragstart', () => {
        const o = this.selected();
        if (!o) return;
        const w = this.worldPos(o);
        this.handleStart = { hx: handle.x, hy: handle.y, wx: w.x, wy: w.y, scaleX: o.scaleX, scaleY: o.scaleY };
        this.handleMoved = false;
      });
      handle.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        const o = this.selected();
        if (!o || !this.selectedId || this.isLocked(this.selectedId)) return;
        this.handleMoved = true;
        apply(o, this.selectedId, dragX, dragY);
      });
      handle.on('dragend', () => {
        if (this.handleMoved) post({ type: 'PUSH_HISTORY' });
        this.handleMoved = false;
      });
    };
    onHandleDrag(this.hX, (o, id, dragX) => {
      const st = this.handleStart;
      this.moveTo(o, id, this.snap(st.wx + dragX - st.hx), st.wy);
    });
    onHandleDrag(this.hY, (o, id, _dragX, dragY) => {
      const st = this.handleStart;
      this.moveTo(o, id, st.wx, this.snap(st.wy + dragY - st.hy));
    });
    onHandleDrag(this.hRot, (o, id, dragX, dragY) => {
      const w = this.worldPos(o);
      const worldAngle = Math.atan2(dragY - w.y, dragX - w.x) + Math.PI / 2;
      const parent = o.parentContainer ? this.worldRotation(o.parentContainer) : 0;
      // Phaser wraps rotation on assignment, which can add float noise, so report the rounded value itself.
      const rotation = round(Phaser.Math.Angle.Wrap(worldAngle - parent), 4);
      o.rotation = rotation;
      post({ type: 'OBJECT_TRANSFORMED', id, x: round(o.x, 2), y: round(o.y, 2), rotation });
    });
    onHandleDrag(this.hSX, (o, id, dragX) => {
      const st = this.handleStart;
      const sx = round(Math.max(0.05, st.scaleX * (dragX - st.wx) / (st.hx - st.wx)), 3);
      o.setScale(sx, o.scaleY);
      post({ type: 'OBJECT_TRANSFORMED', id, x: round(o.x, 2), y: round(o.y, 2), scale: { x: o.scaleX, y: o.scaleY } });
    });
    onHandleDrag(this.hSY, (o, id, _dragX, dragY) => {
      const st = this.handleStart;
      const sy = round(Math.max(0.05, st.scaleY * (st.wy - dragY) / (st.wy - st.hy)), 3);
      o.setScale(o.scaleX, sy);
      post({ type: 'OBJECT_TRANSFORMED', id, x: round(o.x, 2), y: round(o.y, 2), scale: { x: o.scaleX, y: o.scaleY } });
    });

    // Dragging an object's body moves it (select and move tools). Worked out in world space, reported in local space.
    this.input.on('dragstart', (p: Phaser.Input.Pointer, go: GO) => {
      if (this.handles.includes(go)) return;
      const id = this.idByObj.get(go);
      if (!id) return;
      const pt = this.cameras.main.getWorldPoint(p.x, p.y);
      const w = this.worldPos(live(go));
      this.bodyDrag = { id, px: pt.x, py: pt.y, wx: w.x, wy: w.y, moved: false };
    });
    this.input.on('drag', (p: Phaser.Input.Pointer, go: GO) => {
      const d = this.bodyDrag;
      if (!d || this.handles.includes(go) || this.isPanning) return;
      if (this.toolMode !== 'select' && this.toolMode !== 'move') return;
      if (this.idByObj.get(go) !== d.id || this.isLocked(d.id)) return;
      const pt = this.cameras.main.getWorldPoint(p.x, p.y);
      if (!d.moved && pt.x === d.px && pt.y === d.py) return;
      d.moved = true;
      this.moveTo(live(go), d.id, this.snap(d.wx + pt.x - d.px), this.snap(d.wy + pt.y - d.py));
    });
    this.input.on('dragend', (_p: Phaser.Input.Pointer, go: GO) => {
      if (this.handles.includes(go)) return;
      if (this.bodyDrag?.moved) post({ type: 'PUSH_HISTORY' });
      this.bodyDrag = null;
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, gos: GO[]) => {
      if (p.middleButtonDown()) {
        const cam = this.cameras.main;
        this.isPanning = true;
        this.panStart = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
        return;
      }
      if (gos.some(g => this.handles.includes(g))) return;
      // Only unlocked, visible leaves are interactive (see makePickable / applyLocks), so the top hit is the pick.
      const id = gos.map(g => this.idByObj.get(g)).find((i): i is string => !!i && !this.isLocked(i));
      if (id) {
        if (id !== this.selectedId) { this.selectedId = id; post({ type: 'OBJECT_SELECTED', id }); }
      } else if (gos.length === 0 && this.selectedId !== null) {
        this.selectedId = null;
        post({ type: 'OBJECT_DESELECTED' });
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.isPanning) return;
      const cam = this.cameras.main;
      cam.scrollX = this.panStart.scrollX - (p.x - this.panStart.x) / cam.zoom;
      cam.scrollY = this.panStart.scrollY - (p.y - this.panStart.y) / cam.zoom;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonReleased()) this.isPanning = false;
    });

    // Zoom toward the cursor.
    this.input.on('wheel', (p: Phaser.Input.Pointer, _gos: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (1 - dy * 0.001), 0.15, 8));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });

    window.addEventListener('message', ev => this.onMessage(ev.data));
    // Clicking the viewport focuses this iframe, so forward keys for the editor's shortcuts.
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'z', 'y'].includes(e.key.toLowerCase())) e.preventDefault();
      post({ type: 'KEYDOWN', key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
    });
    post({ type: 'SCENE_READY' });
  }

  update() {
    this.selGfx.clear();
    this.gizmoGfx.clear();
    this.hideHandles();
    const o = this.selected();
    if (!o) return;
    const w = this.worldPos(o);
    if (o.getBounds) o.getBounds(this.bounds);
    else this.bounds.setTo(w.x, w.y, 0, 0);
    this.drawSelection(this.bounds);
    // Graphics objects have no rotation or scale in PHASEFORM.
    const transformable = this.typeById.get(this.selectedId!) !== 'graphics';
    if (this.toolMode === 'rotate' && transformable) this.drawRotateGizmo(o, w, this.bounds);
    else if (this.toolMode === 'scale' && transformable) this.drawScaleGizmo(w, this.bounds);
    else this.drawMoveGizmo(w, this.bounds);
  }

  private onMessage(data: unknown) {
    if (!isMessage(data)) return;
    const m = data as unknown as EditorToViewport;
    switch (m.type) {
      case 'SET_TOOL_MODE': this.toolMode = m.mode; break;
      case 'SET_SNAP': this.snapOn = m.enabled; break;
      case 'SET_LOCKED_IDS': this.lockedIds = new Set(m.ids); this.applyLocks(); break;
      case 'RESET_CAMERA': this.cameras.main.setScroll(0, 0).setZoom(1); break;
      // Editor-initiated selection changes are not echoed back; the editor already knows.
      case 'DESELECT_ALL': this.selectedId = null; break;
      case 'SELECT_OBJECT': this.selectedId = m.id; break;

      case 'SET_OBJECT':
        if (this.queued) this.queued.push(m);
        else this.applyLive(m.id, m.patch);
        break;

      case 'LOAD_SCENE': this.loadScene(m); break;

      // screenX/screenY are iframe pixels; the editor decides what to add at the scene position.
      case 'LOCATE_DROP': {
        const { x, y } = this.cameras.main.getWorldPoint(this.scale.transformX(m.screenX), this.scale.transformY(m.screenY));
        post({ type: 'DROP_LOCATED', file: m.file, x: Math.round(x), y: Math.round(y) });
        break;
      }

      default: unhandled(m);
    }
  }

  // ---- Loading

  private loadScene(m: Extract<EditorToViewport, { type: 'LOAD_SCENE' }>) {
    const token = ++this.loadToken;
    this.destroyBuilt();
    this.selectedId = m.selectedId;
    const size = { width: num(m.scene.size?.width, 1280), height: num(m.scene.size?.height, 720) };
    if (size.width !== this.sceneSize.width || size.height !== this.sceneSize.height) {
      this.sceneSize = size;
      this.scale.setGameSize(size.width, size.height);
    }
    this.drawFrame(size, m.scene.background);

    let texturesChanged = false;
    for (const a of m.assets) texturesChanged = this.addTexture(a) || texturesChanged;
    this.syncAnimations(m.animations, texturesChanged);

    const finish = (texWarnings: (string | null)[]) => {
      if (token !== this.loadToken) return;
      const warnings = texWarnings.filter((w): w is string => !!w);
      this.buildScene(m.scene, m.animations, warnings);
      const queued = this.queued ?? [];
      this.queued = null;
      for (const q of queued) this.applyLive(q.id, q.patch);
      post({ type: 'SCENE_LOADED', warnings });
    };
    // Synchronous unless a texture is still decoding, so a rebuild with no new assets is cheap and flicker-free.
    if (this.texPending.size === 0) { finish([]); return; }
    this.queued ??= [];
    void Promise.all([...this.texPending.values()]).then(finish);
  }

  /** Adds or replaces one texture; returns false when the same asset is already there. */
  private addTexture(a: ViewAsset): boolean {
    const sig = JSON.stringify(a);
    if (this.texSig.get(a.key) === sig && (this.textures.exists(a.key) || this.texPending.has(a.key))) return false;
    this.texSig.set(a.key, sig);
    if (this.textures.exists(a.key)) this.textures.remove(a.key);
    const key = a.key;
    const done = new Promise<string | null>(resolve => {
      if (a.type === 'image') {
        const onAdd = () => { this.textures.off(Phaser.Textures.Events.ERROR, onErr); resolve(null); };
        const onErr = (k: string) => {
          if (k !== key) return;
          this.textures.off(Phaser.Textures.Events.ADD_KEY + key, onAdd);
          this.textures.off(Phaser.Textures.Events.ERROR, onErr);
          resolve(`texture "${key}" could not be decoded`);
        };
        this.textures.once(Phaser.Textures.Events.ADD_KEY + key, onAdd);
        this.textures.on(Phaser.Textures.Events.ERROR, onErr);
        this.textures.addBase64(key, a.dataUrl);
        return;
      }
      if (!a.frameWidth || !a.frameHeight) { resolve(`spritesheet "${key}" has no frameWidth/frameHeight`); return; }
      const img = new Image();
      img.onload = () => {
        if (this.texSig.get(key) !== sig) { resolve(null); return; } // replaced again while decoding
        if (this.textures.exists(key)) this.textures.remove(key);
        const tex = this.textures.addSpriteSheet(key, img, {
          frameWidth: a.frameWidth!, frameHeight: a.frameHeight!,
          margin: a.margin ?? 0, spacing: a.spacing ?? 0, startFrame: a.startFrame ?? 0, endFrame: a.endFrame ?? -1,
        });
        resolve(tex ? null : `spritesheet "${key}" could not be added`);
      };
      img.onerror = () => resolve(`spritesheet "${key}" could not be decoded`);
      img.src = a.dataUrl;
    });
    this.texPending.set(key, done);
    void done.then(() => { if (this.texPending.get(key) === done) this.texPending.delete(key); });
    return true;
  }

  /** Drops animations that changed, vanished, or may point at a replaced texture; the loader recreates them. */
  private syncAnimations(animations: unknown[], texturesChanged: boolean) {
    const next = new Map<string, string>();
    for (const a of animations) {
      const key = (a as { key?: unknown } | null)?.key;
      if (typeof key === 'string') next.set(key, JSON.stringify(a));
    }
    for (const [key, sig] of this.animSig) {
      if (texturesChanged || next.get(key) !== sig) this.anims.remove(key);
    }
    for (const [key, sig] of next) {
      if (texturesChanged || this.animSig.get(key) !== sig) this.anims.remove(key);
    }
    this.animSig = next;
  }

  private destroyBuilt() {
    for (const o of this.roots) o.destroy();
    this.roots = [];
    this.objById.clear();
    this.idByObj.clear();
    this.typeById.clear();
    this.bodyDrag = null;
  }

  /** Destroys whatever a failed build call left on the display list. */
  private cleanupSince(before: Set<GO>) {
    for (const o of this.children.list.slice()) if (!before.has(o)) o.destroy();
  }

  private buildScene(scene: PfScene, animations: unknown[], warnings: string[]) {
    const objects = Array.isArray(scene.objects) ? scene.objects : [];
    for (const { obj } of walk(objects)) this.typeById.set(obj.id, obj.type);
    const keep = (w: string) => !/: script ".*" not provided$/.test(w) && !/: anchor ignored on a container child$/.test(w);

    // Whole document first, so references between objects (masks, light sources) resolve; per object if that throws.
    // The background is left out: the loader would set it on the camera, flooding the editor around the canvas.
    let before = new Set(this.children.list);
    try {
      const r = buildPhaseform(this, { objects }, { animations });
      this.roots = r.objects;
      this.register(r.byId);
      warnings.push(...r.warnings.filter(keep));
      this.drawPlaceholders(objects);
      return;
    } catch {
      this.cleanupSince(before);
    }

    const seen = new Set<string>();
    for (const obj of objects) {
      if (seen.has(obj.id)) { warnings.push(`${obj.id}: duplicate id, skipped`); continue; }
      const ids = subtreeIds(obj);
      before = new Set(this.children.list);
      try {
        const dup = ids.find(i => seen.has(i));
        if (dup) throw new Error(`duplicate id "${dup}"`);
        const r = buildPhaseform(this, { objects: [obj] }, { animations });
        this.roots.push(...r.objects);
        this.register(r.byId);
        warnings.push(...r.warnings.filter(keep));
        this.drawPlaceholders([obj]);
      } catch (e) {
        this.cleanupSince(before);
        for (const i of ids) if (!seen.has(i)) this.typeById.delete(i);
        warnings.push(`${obj.id}: not built (${errText(e)}), shown as a placeholder`);
        const ph = this.placeholder(obj);
        this.roots.push(ph);
        this.typeById.set(obj.id, 'rectangle');
        this.register(new Map([[obj.id, ph]]));
      }
      for (const i of ids) seen.add(i);
    }
  }

  /**
   * Scripts do not run here, so a code-drawn `graphics` object would be empty. Draws its `placeholder` (rect, ellipse or polygon;
   * an image placeholder gets an outline) into it, in local space from (0, 0). Without a fill or stroke, a thin outline marks it.
   */
  private drawPlaceholders(objects: PfObject[]) {
    const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? parseInt(v.slice(1), 16) : null);
    for (const { obj } of walk(objects)) {
      const ph = obj.placeholder as Record<string, unknown> | undefined;
      const go = this.objById.get(obj.id);
      if (!ph || typeof ph !== 'object' || !(go instanceof Phaser.GameObjects.Graphics)) continue;
      const w = num(ph.width, 0), h = num(ph.height, 0);
      if (!(w > 0 && h > 0)) continue;
      const fill = color(ph.fill), stroke = color(ph.stroke), alpha = Math.min(1, Math.max(0, num(ph.alpha, 1)));
      const marker = fill === null && stroke === null || ph.kind === 'image';
      go.clear();
      if (fill !== null && ph.kind !== 'image') go.fillStyle(fill, alpha);
      if (stroke !== null && ph.kind !== 'image') go.lineStyle(num(ph.strokeWidth, 1), stroke, alpha);
      else if (marker) go.lineStyle(1, 0x8899aa, 0.8);
      const pts = Array.isArray(ph.points)
        ? (ph.points as Vec2[]).filter(p => p && typeof p.x === 'number' && typeof p.y === 'number').map(p => new Phaser.Math.Vector2(p.x, p.y))
        : [];
      if (ph.kind === 'ellipse') {
        if (fill !== null) go.fillEllipse(w / 2, h / 2, w, h);
        if (stroke !== null || marker) go.strokeEllipse(w / 2, h / 2, w, h);
      } else if (ph.kind === 'polygon' && pts.length >= 3) {
        if (fill !== null) go.fillPoints(pts, true);
        if (stroke !== null || marker) go.strokePoints(pts, true, true);
      } else {
        if (fill !== null && ph.kind !== 'image') go.fillRect(0, 0, w, h);
        if (stroke !== null || marker) go.strokeRect(0, 0, w, h);
      }
    }
  }

  private placeholder(obj: PfObject): GO {
    const w = num(obj.width, 0) > 0 ? num(obj.width, 0) : PLACEHOLDER_SZ;
    const h = num(obj.height, 0) > 0 ? num(obj.height, 0) : PLACEHOLDER_SZ;
    const ph = this.add.rectangle(num(obj.x, 0), num(obj.y, 0), w, h, 0xff0000, 0.12).setStrokeStyle(2, 0xff3333, 1);
    if (typeof obj.depth === 'number') ph.setDepth(obj.depth);
    ph.name = obj.id;
    return ph;
  }

  /** Records built objects and makes every leaf (not containers, not graphics) pickable and draggable. */
  private register(byId: Map<string, GO>) {
    for (const [id, go] of byId) {
      this.objById.set(id, go);
      this.idByObj.set(go, id);
      if (!(go instanceof Phaser.GameObjects.Container) && !(go instanceof Phaser.GameObjects.Graphics)) {
        go.setInteractive({ draggable: true });
      }
    }
    this.applyLocks();
  }

  /** Locked objects (or children of locked containers) take no input, so clicks fall through to what is below. */
  private applyLocks() {
    for (const [id, go] of this.objById) if (go.input) go.input.enabled = !this.isLocked(id);
  }

  private isLocked(id: string): boolean {
    if (this.lockedIds.has(id)) return true;
    let p = this.objById.get(id)?.parentContainer ?? null;
    while (p) {
      const pid = this.idByObj.get(p);
      if (pid && this.lockedIds.has(pid)) return true;
      p = p.parentContainer;
    }
    return false;
  }

  // ---- Live edits

  /** Applies LIVE_FIELDS in place; `undefined` resets to the PHASEFORM default; fields the type lacks are ignored. */
  private applyLive(id: string, patch: Partial<Record<LiveField, unknown>>) {
    const go = this.objById.get(id);
    if (!go) return;
    const o = live(go);
    const type = this.typeById.get(id) ?? '';
    const isGraphics = type === 'graphics';
    for (const [k, v] of Object.entries(patch) as [LiveField, unknown][]) {
      switch (k) {
        case 'x': o.x = num(v, 0); break;
        case 'y': o.y = num(v, 0); break;
        case 'rotation': if (!isGraphics) o.rotation = num(v, 0); break;
        case 'scale': if (!isGraphics) { const s = vec(v, { x: 1, y: 1 }); o.setScale(s.x, s.y); } break;
        case 'origin':
          if (!NO_ORIGIN.has(type) && o.setOrigin) {
            const d = ORIGIN_ZERO.has(type) ? 0 : 0.5;
            const s = vec(v, { x: d, y: d });
            o.setOrigin(s.x, s.y);
          }
          break;
        case 'alpha': o.setAlpha(num(v, 1)); break;
        case 'visible': o.setVisible(v === undefined ? true : !!v); break;
        case 'depth': if (!o.parentContainer) o.setDepth(num(v, 0)); break;
        case 'flipX': if (FLIPPABLE.has(type) && o.setFlipX) o.setFlipX(!!v); break;
        case 'flipY': if (FLIPPABLE.has(type) && o.setFlipY) o.setFlipY(!!v); break;
        default: unhandled(k);
      }
    }
  }

  // ---- Transforms

  private selected(): Live | null {
    if (!this.selectedId) return null;
    const go = this.objById.get(this.selectedId);
    return go && go.active ? live(go) : null;
  }

  private worldPos(o: Live): Vec2 {
    const m = o.getWorldTransformMatrix(this.mA, this.mB);
    return { x: m.tx, y: m.ty };
  }

  private worldRotation(o: GO): number {
    let r = 0;
    for (let p: GO | null = o; p; p = p.parentContainer) r += live(p).rotation;
    return r;
  }

  /** Puts `o` at a world position, converted into its parent's space, and reports the local values. */
  private moveTo(o: Live, id: string, wx: number, wy: number) {
    let x = wx, y = wy;
    const parent = o.parentContainer;
    if (parent) {
      const v = live(parent).getWorldTransformMatrix(this.mA, this.mB).applyInverse(wx, wy);
      x = v.x; y = v.y;
    }
    o.x = round(x, 2);
    o.y = round(y, 2);
    post({ type: 'OBJECT_TRANSFORMED', id, x: o.x, y: o.y });
  }

  private snap(v: number) {
    return this.snapOn ? Math.round(v / GRID) * GRID : v;
  }

  // ---- Drawing

  /** The area around the canvas, the canvas in the scene's background colour, its grid and its border. */
  private drawFrame(size: { width: number; height: number }, background: string | undefined) {
    const W = size.width, H = size.height;
    this.outsideGfx.clear().fillStyle(0x1e1e1e, 1).fillRect(-4000, -4000, 8000 + W, 8000 + H);
    const bg = cssColor(background, '#000000');
    this.canvasGfx.clear().fillStyle(bg.color, bg.alpha).fillRect(0, 0, W, H);

    const grid = this.gridGfx.clear().lineStyle(1, 0xffffff, 0.04);
    for (let x = 0; x <= W; x += GRID) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += GRID) grid.lineBetween(0, y, W, y);
    grid.lineStyle(1, 0xffffff, 0.1)
      .lineBetween(W / 2, 0, W / 2, H)
      .lineBetween(0, H / 2, W, H / 2);

    // Drawn above the scene so the canvas edge stays visible when objects cover it.
    const border = this.borderGfx.clear();
    border.lineStyle(1, 0x444444, 1).strokeRect(0, 0, W, H);
    border.lineStyle(2, 0x5a5a5a, 1);
    const tick = 16;
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      border.lineBetween(cx, cy, cx + (cx === 0 ? tick : -tick), cy);
      border.lineBetween(cx, cy, cx, cy + (cy === 0 ? tick : -tick));
    }
  }

  private drawSelection(b: Phaser.Geom.Rectangle) {
    const pad = 5;
    const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2;
    this.selGfx.lineStyle(4, 0x4aa3ff, 0.25).strokeRect(x - 2, y - 2, w + 4, h + 4);
    this.selGfx.lineStyle(1.5, 0x5fa3e8, 1).strokeRect(x, y, w, h);
    const hs = 5;
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      this.selGfx.fillStyle(0xffffff, 1).fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      this.selGfx.lineStyle(1, 0x4aa3ff, 1).strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
  }

  private drawPivot(x: number, y: number) {
    this.gizmoGfx.fillStyle(0xffffff, 0.9).fillRect(x - 6, y - 6, 12, 12);
    this.gizmoGfx.lineStyle(1.5, 0x888888, 1).strokeRect(x - 6, y - 6, 12, 12);
  }

  private drawMoveGizmo({ x, y }: Vec2, b: Phaser.Geom.Rectangle) {
    const tipX = b.right + ARROW_LEN;
    const tipY = b.top - ARROW_LEN;
    this.gizmoGfx.lineStyle(3, 0xff4444, 1).lineBetween(b.right, y, tipX, y);
    this.gizmoGfx.fillStyle(0xff4444, 1).fillTriangle(tipX + 10, y, tipX - 1, y - 6, tipX - 1, y + 6);
    this.gizmoGfx.lineStyle(3, 0x44ff44, 1).lineBetween(x, b.top, x, tipY);
    this.gizmoGfx.fillStyle(0x44ff44, 1).fillTriangle(x, tipY - 10, x - 6, tipY + 1, x + 6, tipY + 1);
    this.drawPivot(x, y);
    this.hX.setPosition(tipX + 5, y).setVisible(true);
    this.hY.setPosition(x, tipY - 5).setVisible(true);
  }

  private drawRotateGizmo(o: Live, { x, y }: Vec2, b: Phaser.Geom.Rectangle) {
    const r = ROT_RADIUS + Math.max(b.width, b.height) / 2;
    const ang = this.worldRotation(o) - Math.PI / 2;
    const hx = x + Math.cos(ang) * r;
    const hy = y + Math.sin(ang) * r;
    this.gizmoGfx.lineStyle(2, 0xfbbf24, 0.8).strokeCircle(x, y, r);
    this.gizmoGfx.lineStyle(1.5, 0xfbbf24, 0.7).lineBetween(x, y, hx, hy);
    this.gizmoGfx.fillStyle(0xfbbf24, 1).fillCircle(hx, hy, 7);
    this.gizmoGfx.lineStyle(2, 0xffffff, 0.9).strokeCircle(hx, hy, 7);
    this.gizmoGfx.fillStyle(0xfbbf24, 0.7).fillCircle(x, y, 4);
    this.hRot.setPosition(hx, hy).setVisible(true);
  }

  private drawScaleGizmo({ x, y }: Vec2, b: Phaser.Geom.Rectangle) {
    const tipX = b.right + ARROW_LEN;
    const tipY = b.top - ARROW_LEN;
    this.gizmoGfx.lineStyle(3, 0xf97316, 1).lineBetween(b.right, y, tipX, y);
    this.gizmoGfx.fillStyle(0xf97316, 1).fillRect(tipX - 6, y - 6, 12, 12);
    this.gizmoGfx.lineStyle(3, 0x22d3ee, 1).lineBetween(x, b.top, x, tipY);
    this.gizmoGfx.fillStyle(0x22d3ee, 1).fillRect(x - 6, tipY - 6, 12, 12);
    this.drawPivot(x, y);
    this.hSX.setPosition(tipX, y).setVisible(true);
    this.hSY.setPosition(x, tipY).setVisible(true);
  }

  private hideHandles() {
    for (const h of [this.hX, this.hY, this.hRot, this.hSX, this.hSY]) h.setVisible(false);
  }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game-container',
  width: 1280,
  height: 720,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  transparent: true,
  scene: EditorScene,
});

// Keep the canvas fitted to its dock panel (the iframe is resized by dockview, not the window).
const container = document.getElementById('game-container');
if (container) new ResizeObserver(() => game.scale.refresh()).observe(container);
