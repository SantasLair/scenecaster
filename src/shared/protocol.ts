// Typed postMessage protocol between the editor (App.tsx), the viewport (phaser.html / phaser-main.ts)
// and the disabled live bridge (src/bridge/phaser-forge-bridge.js).
// The scene itself is a PHASEFORM document (shared/phaseform); the viewport builds it with phaseform-loader and only
// reports selection and transforms back. The editor's model stays the single source of truth.
import type { PfScene, Vec2 } from './phaseform/types';

export type ToolMode = 'select' | 'move' | 'rotate' | 'scale';

/** A texture the viewport should add before building: images and spritesheets, as data URLs. */
export interface ViewAsset {
  key: string;
  type: 'image' | 'spritesheet';
  dataUrl: string;
  frameWidth?: number;
  frameHeight?: number;
  margin?: number;
  spacing?: number;
  startFrame?: number;
  endFrame?: number;
}

/** Asset Browser / FileSystem drag payload ('application/phaser-asset'): a file inside the project. */
export interface AssetPayload { name: string; fullPath?: string; dataUrl?: string }

/** Object fields the viewport can apply to a live object without rebuilding the scene. */
export const LIVE_FIELDS = ['x', 'y', 'rotation', 'scale', 'origin', 'alpha', 'visible', 'depth', 'flipX', 'flipY'] as const;
export type LiveField = (typeof LIVE_FIELDS)[number];

// ---- Editor (App.tsx) -> viewport
export type EditorToViewport =
  | { type: 'SET_TOOL_MODE'; mode: ToolMode }
  | { type: 'SET_SNAP'; enabled: boolean }
  | { type: 'SET_LOCKED_IDS'; ids: string[] }
  | { type: 'RESET_CAMERA' }
  | { type: 'DESELECT_ALL' }
  /** Replaces everything: clear, add the textures, build the scene with the loader, reselect `selectedId` if it still exists. */
  | { type: 'LOAD_SCENE'; scene: PfScene; assets: ViewAsset[]; animations: unknown[]; selectedId: string | null }
  /** Applies only LiveField fields of one object in place (`undefined` resets the field to its default). */
  | { type: 'SET_OBJECT'; id: string; patch: Partial<Record<LiveField, unknown>> }
  | { type: 'SELECT_OBJECT'; id: string }
  /** Asks where a drop at iframe pixels lands in the scene; answered with DROP_LOCATED. */
  | { type: 'LOCATE_DROP'; file: AssetPayload; screenX: number; screenY: number };

// ---- Viewport -> editor
export type ViewportToEditor =
  | { type: 'SCENE_READY' }
  | { type: 'KEYDOWN'; key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  /** After LOAD_SCENE: what the loader reported (unsupported types, missing textures) and any object replaced by a placeholder. */
  | { type: 'SCENE_LOADED'; warnings: string[] }
  | { type: 'OBJECT_SELECTED'; id: string }
  | { type: 'OBJECT_DESELECTED' }
  /** A gizmo or drag changed an object. Values are local (in the parent's space), like the document's fields. */
  | { type: 'OBJECT_TRANSFORMED'; id: string; x: number; y: number; rotation?: number; scale?: Vec2 }
  | { type: 'PUSH_HISTORY' }
  | { type: 'DROP_LOCATED'; file: AssetPayload; x: number; y: number };

// ---- Live bridge, v0.3 (src/bridge/phaser-forge-bridge.js).
// The bridge .d.ts ships into user projects and cannot import this file; keep the two in sync by hand.
/** Properties the (disabled) live bridge can set; must match the bridge's SETTABLE_PROPS plus depth. */
export type LiveProp = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'alpha' | 'visible' | 'depth' | 'originX' | 'originY';
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
