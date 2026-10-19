// PHASEFORM documents (https://github.com/SantasLair/phaseform). The editor keeps them as plain JSON so that unknown
// types, fields and extensions survive a load and save unchanged; these types describe only what the editor reads.

export interface Vec2 { x: number; y: number }

/** One scene object. `type` is open: unknown types are preserved. `children` exists only on containers. */
export interface PfObject {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scale?: Vec2;
  origin?: Vec2;
  alpha?: number;
  visible?: boolean;
  depth?: number;
  children?: PfObject[];
  [field: string]: unknown;
}

export interface PfScene {
  format: 'phaseform';
  version: string;
  /** Equals the scene key in the project file and the game's Phaser scene key. */
  key: string;
  size: { width: number; height: number };
  background?: string;
  objects: PfObject[];
  [field: string]: unknown;
}

export interface PfAsset {
  key: string;
  type: string;
  url?: string;
  urls?: string[];
  atlasUrl?: string;
  dataUrl?: string;
  frameWidth?: number;
  frameHeight?: number;
  [field: string]: unknown;
}

export interface PfSceneEntry {
  key: string;
  /** Relative to the project root, forward slashes. */
  path: string;
  assets?: string[];
  [field: string]: unknown;
}

export interface PfProject {
  format: 'phaseform-project';
  version: string;
  name: string;
  entry: string;
  scenes: PfSceneEntry[];
  assets: PfAsset[];
  animations?: unknown[];
  [field: string]: unknown;
}

export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

/** The object types the editor can create, and that the loader can build. */
export const CONTAINER_TYPE = 'container';
export const SHAPE_TYPES = ['rectangle', 'ellipse', 'triangle', 'line', 'polygon', 'star', 'arc'] as const;
export const isContainer = (o: PfObject) => o.type === CONTAINER_TYPE;
