// Typed postMessage protocol between the editor (App.tsx), the viewport (phaser-main.ts)
// and the live bridge (src/bridge/phaser-forge-bridge.js).
import type { ObjectProps, LiveProp } from './props';
export type { ObjectProps, LiveProp };

export type ToolMode = 'select' | 'move' | 'rotate' | 'scale';
export type Shape = 'rect' | 'circle' | 'triangle';

/** Per-object metadata kept by the viewport and persisted in forge-scene.json. */
export type SceneObjectMeta =
  | { kind: 'primitive'; name: string; shape: Shape }
  | { kind: 'sprite'; name: string; assetName: string; assetFullPath: string };
export type SceneObject = { id: string } & SceneObjectMeta & ObjectProps;
export type LoadSceneObject = SceneObject & { dataUrl?: string };

/** Asset Browser drag payload ('application/phaser-asset'): AssetFile + dataUrl. */
export interface AssetPayload { name: string; fullPath?: string; dataUrl?: string }

// ---- Editor (App.tsx) -> viewport (phaser.html / phaser-main.ts)
export type EditorToViewport =
  | { type: 'SET_TOOL_MODE'; mode: ToolMode }
  | { type: 'SET_SNAP'; enabled: boolean }
  | { type: 'SET_LOCKED_IDS'; ids: string[] }
  | { type: 'RESET_CAMERA' }
  | { type: 'DESELECT_ALL' }
  | { type: 'RESET_SCENE' }
  | { type: 'SELECT_OBJECT'; id: string }
  | ({ type: 'SET_PROPERTIES'; id: string } & Partial<ObjectProps>)
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'DUPLICATE_OBJECT'; id: string; newId: string }
  | { type: 'RENAME_OBJECT'; id: string; name: string }
  | { type: 'GET_SCENE_STATE' }
  | { type: 'LOAD_SCENE'; objects: LoadSceneObject[] }
  | { type: 'ADD_PRIMITIVE'; shape: Shape }
  /** screenX/screenY are iframe pixels; omitted = canvas center. */
  | { type: 'ADD_SPRITE_FROM_ASSET'; file: AssetPayload; screenX?: number; screenY?: number };

// ---- Viewport -> editor
export type ViewportToEditor =
  | { type: 'SCENE_READY' }
  | { type: 'KEYDOWN'; key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  | ({ type: 'OBJECT_SELECTED'; id: string; texW: number; texH: number } & ObjectProps)
  | { type: 'OBJECT_DESELECTED' }
  | ({ type: 'OBJECT_TRANSFORMED'; id: string } & Pick<ObjectProps, 'x' | 'y'>
      & Partial<Pick<ObjectProps, 'rotation' | 'scaleX' | 'scaleY'>>)
  | { type: 'PUSH_HISTORY' }
  | { type: 'OBJECT_ADDED'; id: string; name: string; objType: string; visible: boolean; loaded: boolean }
  | { type: 'SCENE_STATE'; objects: SceneObject[] };

// ---- Live bridge, v0.3 (src/bridge/phaser-forge-bridge.js; docs/ROADMAP.md "Bridge Protocol").
// The bridge .d.ts ships into user projects and cannot import this file; keep the two in sync by hand.
export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface BridgeScene { key: string; active: boolean; visible: boolean }
export interface BridgeObject {
  id: string; name: string; type: string;
  x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  alpha: number; visible: boolean; depth: number; originX: number; originY: number;
  textureKey?: string; text?: string; displayWidth?: number; displayHeight?: number;
}
export type SelectReason = 'pick' | 'move' | 'refresh';

export type EditorToBridge =
  | { type: 'FORGE_PING' }
  | { type: 'FORGE_GET_SCENES' }
  | { type: 'FORGE_GET_OBJECTS'; sceneKey: string }
  | { type: 'FORGE_SELECT'; id: string; reason?: SelectReason }
  | { type: 'FORGE_PICK_OBJECT'; sceneKey?: string; viewportX: number; viewportY: number }
  | { type: 'FORGE_SET_PROP'; id: string; prop: LiveProp; value: number | boolean }
  | { type: 'FORGE_MOVE_OBJECT'; id: string; startX: number; startY: number; dx: number; dy: number };

export type BridgeToEditor =
  | { type: 'FORGE_READY'; version: string; hasGame?: boolean }   // hasGame absent on old bridges
  | { type: 'FORGE_PONG'; version: string; hasGame?: boolean }
  | { type: 'FORGE_SCENES'; scenes: BridgeScene[] }
  | { type: 'FORGE_OBJECTS'; sceneKey: string; objects: BridgeObject[] }
  | { type: 'FORGE_SELECTED'; id: string; sceneKey?: string; reason?: SelectReason;
      props: BridgeObject; bounds: ScreenRect; screenBounds: ScreenRect | null }
  | { type: 'FORGE_DESELECTED' }
  | { type: 'FORGE_PROP_SET'; id: string; sceneKey?: string; prop: LiveProp; value: number | boolean;
      props: BridgeObject; screenBounds: ScreenRect | null };

export type Forge<T> = T & { forge: true };
export type IncomingMessage = ViewportToEditor | Forge<BridgeToEditor>;

/** Trust boundary: only `type` is checked (same as today's `m?.type`). Full validation is Phase 1. */
export const isMessage = (d: unknown): d is IncomingMessage =>
  typeof (d as { type?: unknown } | null)?.type === 'string';
export const isForge = (m: IncomingMessage): m is Forge<BridgeToEditor> =>
  (m as { forge?: unknown }).forge === true;

/** `default:` branch of message switches: tsc errors if a union member is unhandled; no-op at runtime. */
export function unhandled(_m: never): void {}
