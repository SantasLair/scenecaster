// Anchor resolution: pure, engine-neutral. An anchored object's x/y are an offset from a point of the canvas.
import type { Anchor } from './protocol';

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** The canvas point an anchor refers to. null (absolute) is the top-left corner. */
export function anchorPoint(anchor: Anchor | null, canvas: Size): Point {
  if (!anchor) return { x: 0, y: 0 };
  const fx = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5;
  const fy = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5;
  return { x: canvas.w * fx, y: canvas.h * fy };
}

/** Stored offset to absolute canvas position. */
export function resolveAnchor(anchor: Anchor | null, offset: Point, canvas: Size): Point {
  const a = anchorPoint(anchor, canvas);
  return { x: a.x + offset.x, y: a.y + offset.y };
}

/** Absolute canvas position to the offset to store. */
export function toOffset(anchor: Anchor | null, abs: Point, canvas: Size): Point {
  const a = anchorPoint(anchor, canvas);
  return { x: abs.x - a.x, y: abs.y - a.y };
}

