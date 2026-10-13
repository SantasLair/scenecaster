import * as Phaser from 'phaser';
import { PROP_KEYS, describe, type ObjectProps } from '../../shared/props';
import {
  isMessage, unhandled,
  type EditorToViewport, type ViewportToEditor, type SceneObject, type SceneObjectMeta, type Shape, type ToolMode,
} from '../../shared/protocol';

const params = new URLSearchParams(window.location.search);
const CANVAS_W = parseInt(params.get('w') ?? '1280');
const CANVAS_H = parseInt(params.get('h') ?? '720');

const ARROW_LEN = 65;
const ROT_RADIUS = 60;
const HANDLE_SZ = 14;
const GRID = 32;
const PRIMITIVE_SZ = 64;

type Sprite = Phaser.GameObjects.Sprite;
type SpriteData = SceneObjectMeta;

const SHAPE_NAMES: Record<Shape, string> = { rect: 'Rectangle', circle: 'Circle', triangle: 'Triangle' };
const SHAPE_TYPES: Record<Shape, string> = { rect: 'Rect', circle: 'Circle', triangle: 'Triangle' };

const post = (msg: ViewportToEditor) => window.parent.postMessage(msg, '*');

class EditorScene extends Phaser.Scene {
  private sprites = new Map<string, Sprite>();
  private spriteData = new Map<string, SpriteData>();

  private selectedSprite: Sprite | null = null;
  private selectedId: string | null = null;

  private selGfx!: Phaser.GameObjects.Graphics;
  private gizmoGfx!: Phaser.GameObjects.Graphics;
  private bounds = new Phaser.Geom.Rectangle();

  private hX!: Phaser.GameObjects.Rectangle;
  private hY!: Phaser.GameObjects.Rectangle;
  private hRot!: Phaser.GameObjects.Rectangle;
  private hSX!: Phaser.GameObjects.Rectangle;
  private hSY!: Phaser.GameObjects.Rectangle;
  private handleStart = { hx: 0, hy: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };

  private toolMode: ToolMode = 'select';
  private snapOn = false;
  private lockedIds = new Set<string>();

  private isPanning = false;
  private panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

  constructor() { super('EditorScene'); }

  create() {
    this.cameras.main.setBackgroundColor('#07061a');
    this.drawCanvasFrame();

    this.selGfx = this.add.graphics().setDepth(997);
    this.gizmoGfx = this.add.graphics().setDepth(998);

    const makeHandle = () =>
      this.add.rectangle(0, 0, HANDLE_SZ, HANDLE_SZ, 0xff0000, 0)
        .setDepth(999).setVisible(false).setInteractive({ draggable: true });
    this.hX = makeHandle();
    this.hY = makeHandle();
    this.hRot = makeHandle();
    this.hSX = makeHandle();
    this.hSY = makeHandle();
    const handles: Phaser.GameObjects.GameObject[] = [this.hX, this.hY, this.hRot, this.hSX, this.hSY];

    // dragX/dragY are the handle's start position plus pointer delta, so work from a snapshot taken at dragstart.
    const onHandleDrag = (handle: Phaser.GameObjects.Rectangle, apply: (s: Sprite, dragX: number, dragY: number) => void) => {
      handle.on('dragstart', () => {
        const s = this.selectedSprite;
        if (!s) return;
        this.handleStart = { hx: handle.x, hy: handle.y, x: s.x, y: s.y, scaleX: s.scaleX, scaleY: s.scaleY };
      });
      handle.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        if (!this.selectedSprite) return;
        apply(this.selectedSprite, dragX, dragY);
        this.notifyTransform();
      });
      handle.on('dragend', () => post({ type: 'PUSH_HISTORY' }));
    };
    onHandleDrag(this.hX, (s, dragX) => {
      const st = this.handleStart;
      s.x = this.snap(st.x + dragX - st.hx);
    });
    onHandleDrag(this.hY, (s, _dragX, dragY) => {
      const st = this.handleStart;
      s.y = this.snap(st.y + dragY - st.hy);
    });
    onHandleDrag(this.hRot, (s, dragX, dragY) => {
      s.rotation = Math.atan2(dragY - s.y, dragX - s.x) + Math.PI / 2;
    });
    onHandleDrag(this.hSX, (s, dragX) => {
      const st = this.handleStart;
      s.scaleX = Math.max(0.05, st.scaleX * (dragX - st.x) / (st.hx - st.x));
    });
    onHandleDrag(this.hSY, (s, _dragX, dragY) => {
      const st = this.handleStart;
      s.scaleY = Math.max(0.05, st.scaleY * (st.y - dragY) / (st.y - st.hy));
    });

    this.input.on('drag', (_p: Phaser.Input.Pointer, go: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
      if (handles.includes(go) || this.isPanning) return;
      if (this.toolMode !== 'select' && this.toolMode !== 'move') return;
      const s = go as Sprite;
      const id = this.idOf(s);
      if (!id || this.lockedIds.has(id)) return;
      s.x = this.snap(dragX);
      s.y = this.snap(dragY);
      post({ type: 'OBJECT_TRANSFORMED', id, x: s.x, y: s.y });
    });
    this.input.on('dragend', (_p: Phaser.Input.Pointer, go: Phaser.GameObjects.GameObject) => {
      if (!handles.includes(go)) post({ type: 'PUSH_HISTORY' });
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, gos: Phaser.GameObjects.GameObject[]) => {
      if (p.middleButtonDown()) {
        const cam = this.cameras.main;
        this.isPanning = true;
        this.panStart = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
        return;
      }
      const target = gos.find(g => !handles.includes(g)) as Sprite | undefined;
      if (target) {
        const id = this.idOf(target);
        if (id && !this.lockedIds.has(id)) this.selectSprite(id, target);
      } else if (gos.length === 0) {
        this.deselect();
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
    const s = this.selectedSprite;
    this.selGfx.clear();
    this.gizmoGfx.clear();
    this.hideHandles();
    if (!s) return;
    s.getBounds(this.bounds);
    this.drawSelection(this.bounds);
    if (this.toolMode === 'rotate') this.drawRotateGizmo(s, this.bounds);
    else if (this.toolMode === 'scale') this.drawScaleGizmo(s, this.bounds);
    else this.drawMoveGizmo(s, this.bounds);
  }

  private onMessage(data: unknown) {
    if (!isMessage(data)) return;
    const m = data as unknown as EditorToViewport;
    switch (m.type) {
      case 'SET_TOOL_MODE': this.toolMode = m.mode; break;
      case 'SET_SNAP': this.snapOn = m.enabled; break;
      case 'SET_LOCKED_IDS': this.lockedIds = new Set(m.ids); break;
      case 'RESET_CAMERA': this.cameras.main.setScroll(0, 0).setZoom(1); break;
      case 'DESELECT_ALL': this.deselect(); break;

      case 'RESET_SCENE':
        this.clearScene();
        post({ type: 'SCENE_READY' });
        break;

      case 'SELECT_OBJECT': {
        const s = this.sprites.get(m.id);
        if (s) this.selectSprite(m.id, s);
        break;
      }

      case 'SET_PROPERTIES': {
        const s = this.sprites.get(m.id);
        if (s) this.applyProps(s, m);
        break;
      }

      case 'DELETE_OBJECT': {
        const s = this.sprites.get(m.id);
        if (!s) break;
        if (this.selectedSprite === s) this.deselect();
        s.destroy();
        this.sprites.delete(m.id);
        this.spriteData.delete(m.id);
        break;
      }

      case 'DUPLICATE_OBJECT': {
        const src = this.sprites.get(m.id);
        const data = this.spriteData.get(m.id);
        if (!src || !data) break;
        const copy = this.add.sprite(src.x + 20, src.y + 20, src.texture.key);
        this.applyProps(copy, { ...this.serialize(src), x: copy.x, y: copy.y });
        const type = data.kind === 'primitive' ? SHAPE_TYPES[data.shape] : 'Sprite';
        this.addObject(m.newId, copy, { ...data, name: `${data.name} Copy` }, type, true);
        break;
      }

      case 'RENAME_OBJECT': {
        const d = this.spriteData.get(m.id);
        if (d) d.name = m.name;
        break;
      }

      case 'GET_SCENE_STATE': {
        const objects: SceneObject[] = [...this.sprites].map(([id, spr]) => ({ id, ...this.spriteData.get(id)!, ...this.serialize(spr) }));
        post({ type: 'SCENE_STATE', objects });
        break;
      }

      case 'LOAD_SCENE':
        this.clearScene();
        for (const obj of m.objects) {
          if (obj.kind === 'primitive') {
            const data: SpriteData = { kind: 'primitive', name: obj.name, shape: obj.shape };
            const spr = this.add.sprite(obj.x, obj.y, this.primitiveTexture(obj.shape));
            this.applyProps(spr, obj);
            this.addObject(obj.id, spr, data, SHAPE_TYPES[obj.shape] ?? 'Rect', false, true);
          } else if (obj.kind === 'sprite') {
            const data: SpriteData = { kind: 'sprite', name: obj.name, assetName: obj.assetName, assetFullPath: obj.assetFullPath };
            this.withAssetTexture(obj.assetName, obj.dataUrl, key => {
              const spr = this.add.sprite(obj.x, obj.y, key);
              this.applyProps(spr, obj);
              this.addObject(obj.id, spr, data, 'Sprite', false, true);
            });
          }
        }
        break;

      case 'ADD_PRIMITIVE': {
        const { shape } = m;
        const spr = this.add.sprite(CANVAS_W / 2, CANVAS_H / 2, this.primitiveTexture(shape));
        this.addObject(`${shape}_${Date.now()}`, spr, { kind: 'primitive', shape, name: SHAPE_NAMES[shape] }, SHAPE_TYPES[shape], true);
        break;
      }

      // screenX/screenY are iframe pixels; without them the sprite goes to the canvas center.
      case 'ADD_SPRITE_FROM_ASSET': {
        const { file, screenX, screenY } = m;
        const { x, y } = screenX === undefined || screenY === undefined
          ? { x: CANVAS_W / 2, y: CANVAS_H / 2 }
          : this.cameras.main.getWorldPoint(this.scale.transformX(screenX), this.scale.transformY(screenY));
        this.withAssetTexture(file.name, file.dataUrl, key => {
          const data: SpriteData = { kind: 'sprite', name: file.name, assetName: file.name, assetFullPath: file.fullPath ?? '' };
          this.addObject(`${file.name}_${Date.now()}`, this.add.sprite(Math.round(x), Math.round(y), key), data, 'Sprite', true);
        });
        break;
      }

      default: unhandled(m);
    }
  }

  private addObject(id: string, spr: Sprite, data: SpriteData, objType: string, select: boolean, loaded = false) {
    spr.setInteractive({ draggable: true });
    this.sprites.set(id, spr);
    this.spriteData.set(id, data);
    post({ type: 'OBJECT_ADDED', id, name: data.name, objType, visible: spr.visible, loaded });
    if (select) this.selectSprite(id, spr);
  }

  private clearScene() {
    this.deselect();
    for (const spr of this.sprites.values()) spr.destroy();
    this.sprites.clear();
    this.spriteData.clear();
  }

  private primitiveTexture(shape: Shape) {
    const key = `prim_${shape}`;
    if (this.textures.exists(key)) return key;
    const sz = PRIMITIVE_SZ;
    const g = this.add.graphics().fillStyle(0xffffff, 1).lineStyle(2, 0xffffff, 0.3);
    if (shape === 'rect') g.fillRect(2, 2, sz - 4, sz - 4).strokeRect(2, 2, sz - 4, sz - 4);
    if (shape === 'circle') g.fillCircle(sz / 2, sz / 2, sz / 2 - 2).strokeCircle(sz / 2, sz / 2, sz / 2 - 2);
    if (shape === 'triangle') g.fillTriangle(sz / 2, 2, sz - 2, sz - 2, 2, sz - 2).strokeTriangle(sz / 2, 2, sz - 2, sz - 2, 2, sz - 2);
    g.generateTexture(key, sz, sz);
    g.destroy();
    return key;
  }

  /** Runs `cb` once the asset texture exists, loading it from `dataUrl` or falling back to a placeholder. */
  private withAssetTexture(assetName: string, dataUrl: string | undefined, cb: (key: string) => void) {
    const key = `asset_${assetName}`;
    if (this.textures.exists(key)) return cb(key);
    if (dataUrl) {
      this.textures.once(`addtexture-${key}`, () => cb(key));
      this.textures.addBase64(key, dataUrl);
      return;
    }
    const g = this.add.graphics().fillStyle(0x6366f1, 1).fillRect(0, 0, 64, 64).lineStyle(1, 0xa5b4fc, 0.5).strokeRect(2, 2, 60, 60);
    g.generateTexture(key, 64, 64);
    g.destroy();
    cb(key);
  }

  /** Reads every table property from the sprite (descriptor `get`, else `sprite[key]`). */
  private serialize(spr: Sprite): ObjectProps {
    const out: Partial<Record<keyof ObjectProps, unknown>> = {};
    for (const k of PROP_KEYS) {
      const d = describe(k);
      out[k] = d.get ? d.get(spr) : (spr as unknown as Record<string, unknown>)[k];
    }
    return out as ObjectProps;
  }

  /** Applies only the props present in `p` (descriptor `set`, else assigns `sprite[key]`). */
  private applyProps(s: Sprite, p: Partial<ObjectProps>) {
    for (const k of PROP_KEYS) {
      const v = p[k];
      if (v === undefined) continue;
      const d = describe(k);
      if (d.set) d.set(s, v);
      else (s as unknown as Record<string, unknown>)[k] = v;
    }
  }

  private drawCanvasFrame() {
    this.add.graphics().setDepth(-2)
      .fillStyle(0x060810, 1)
      .fillRect(-4000, -4000, 8000 + CANVAS_W, 8000 + CANVAS_H);
    this.add.graphics().setDepth(-1)
      .fillStyle(0x111827, 1)
      .fillRect(0, 0, CANVAS_W, CANVAS_H);

    const border = this.add.graphics().setDepth(0);
    border.lineStyle(1, 0x334155, 1).strokeRect(0, 0, CANVAS_W, CANVAS_H);
    border.lineStyle(2, 0x475569, 1);
    const tick = 16;
    for (const [cx, cy] of [[0, 0], [CANVAS_W, 0], [0, CANVAS_H], [CANVAS_W, CANVAS_H]]) {
      border.lineBetween(cx, cy, cx + (cx === 0 ? tick : -tick), cy);
      border.lineBetween(cx, cy, cx, cy + (cy === 0 ? tick : -tick));
    }

    const grid = this.add.graphics().setDepth(0).lineStyle(1, 0xffffff, 0.04);
    for (let x = 0; x <= CANVAS_W; x += GRID) grid.lineBetween(x, 0, x, CANVAS_H);
    for (let y = 0; y <= CANVAS_H; y += GRID) grid.lineBetween(0, y, CANVAS_W, y);
    grid.lineStyle(1, 0xffffff, 0.1)
      .lineBetween(CANVAS_W / 2, 0, CANVAS_W / 2, CANVAS_H)
      .lineBetween(0, CANVAS_H / 2, CANVAS_W, CANVAS_H / 2);
  }

  private drawSelection(b: Phaser.Geom.Rectangle) {
    const pad = 5;
    const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2;
    this.selGfx.lineStyle(4, 0x3b82f6, 0.25).strokeRect(x - 2, y - 2, w + 4, h + 4);
    this.selGfx.lineStyle(1.5, 0x60a5fa, 1).strokeRect(x, y, w, h);
    const hs = 5;
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      this.selGfx.fillStyle(0xffffff, 1).fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      this.selGfx.lineStyle(1, 0x3b82f6, 1).strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
  }

  private drawPivot(x: number, y: number) {
    this.gizmoGfx.fillStyle(0xffffff, 0.9).fillRect(x - 6, y - 6, 12, 12);
    this.gizmoGfx.lineStyle(1.5, 0x888888, 1).strokeRect(x - 6, y - 6, 12, 12);
  }

  private drawMoveGizmo(s: Sprite, b: Phaser.Geom.Rectangle) {
    const { x, y } = s;
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

  private drawRotateGizmo(s: Sprite, b: Phaser.Geom.Rectangle) {
    const { x, y } = s;
    const r = ROT_RADIUS + Math.max(b.width, b.height) / 2;
    const ang = s.rotation - Math.PI / 2;
    const hx = x + Math.cos(ang) * r;
    const hy = y + Math.sin(ang) * r;
    this.gizmoGfx.lineStyle(2, 0xfbbf24, 0.8).strokeCircle(x, y, r);
    this.gizmoGfx.lineStyle(1.5, 0xfbbf24, 0.7).lineBetween(x, y, hx, hy);
    this.gizmoGfx.fillStyle(0xfbbf24, 1).fillCircle(hx, hy, 7);
    this.gizmoGfx.lineStyle(2, 0xffffff, 0.9).strokeCircle(hx, hy, 7);
    this.gizmoGfx.fillStyle(0xfbbf24, 0.7).fillCircle(x, y, 4);
    this.hRot.setPosition(hx, hy).setVisible(true);
  }

  private drawScaleGizmo(s: Sprite, b: Phaser.Geom.Rectangle) {
    const { x, y } = s;
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

  private snap(v: number) {
    return this.snapOn ? Math.round(v / GRID) * GRID : v;
  }

  private hideHandles() {
    for (const h of [this.hX, this.hY, this.hRot, this.hSX, this.hSY]) h.setVisible(false);
  }

  private idOf(spr: Sprite): string | null {
    for (const [id, s] of this.sprites) if (s === spr) return id;
    return null;
  }

  private selectSprite(id: string, spr: Sprite) {
    this.selectedSprite = spr;
    this.selectedId = id;
    post({ type: 'OBJECT_SELECTED', id, ...this.serialize(spr), texW: spr.width, texH: spr.height });
  }

  private deselect() {
    this.selectedSprite = null;
    this.selectedId = null;
    post({ type: 'OBJECT_DESELECTED' });
  }

  private notifyTransform() {
    const s = this.selectedSprite;
    if (!s || !this.selectedId) return;
    post({ type: 'OBJECT_TRANSFORMED', id: this.selectedId, x: s.x, y: s.y, rotation: s.rotation, scaleX: s.scaleX, scaleY: s.scaleY });
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game-container',
  width: CANVAS_W,
  height: CANVAS_H,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  transparent: true,
  scene: EditorScene,
});
