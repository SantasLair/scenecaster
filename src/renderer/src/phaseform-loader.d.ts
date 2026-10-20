// The loader is plain JS and ships no types; this covers the part the editor uses.
declare module 'phaseform-loader' {
  import type * as Phaser from 'phaser';
  export interface BuildResult { objects: Phaser.GameObjects.GameObject[]; warnings: string[]; byId: Map<string, Phaser.GameObjects.GameObject>;
    /** Positions anchored root objects for a game of this size. The editor draws at the design size and never calls it. */
    layout(width: number, height: number): void }
  export function build(scene: Phaser.Scene, doc: { objects: Record<string, unknown>[]; background?: string }, opts?: { modules?: Record<string, unknown>; animations?: unknown[] }): BuildResult;
  export function clear(scene: Phaser.Scene): void;
}
