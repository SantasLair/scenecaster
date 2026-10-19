// The unpublished loader is plain JS; this covers the part the editor uses.
declare module 'phaseform-loader' {
  import type * as Phaser from 'phaser';
  export interface BuildResult { objects: Phaser.GameObjects.GameObject[]; warnings: string[]; byId: Map<string, Phaser.GameObjects.GameObject> }
  export function build(scene: Phaser.Scene, doc: { objects: Record<string, unknown>[]; background?: string }, opts?: { modules?: Record<string, unknown>; animations?: unknown[] }): BuildResult;
  export function clear(scene: Phaser.Scene): void;
}
