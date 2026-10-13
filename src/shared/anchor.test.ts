import { describe, it, expect } from 'vitest';
import { anchorPoint, resolveAnchor, toOffset } from './anchor';
import { ANCHORS } from './protocol';

const canvas = { w: 800, h: 600 };

describe('anchor resolver', () => {
  it('maps all 9 anchors (and null) to canvas points', () => {
    const expected: Record<string, [number, number]> = {
      'top-left': [0, 0], top: [400, 0], 'top-right': [800, 0],
      left: [0, 300], center: [400, 300], right: [800, 300],
      'bottom-left': [0, 600], bottom: [400, 600], 'bottom-right': [800, 600],
    };
    expect(ANCHORS).toHaveLength(9);
    for (const a of ANCHORS) expect(anchorPoint(a, canvas)).toEqual({ x: expected[a][0], y: expected[a][1] });
    expect(anchorPoint(null, canvas)).toEqual({ x: 0, y: 0 });
  });

  it('keeps a bottom-right object pinned when the canvas size changes', () => {
    const off = { x: -20, y: -20 };
    expect(resolveAnchor('bottom-right', off, canvas)).toEqual({ x: 780, y: 580 });
    expect(resolveAnchor('bottom-right', off, { w: 1920, h: 1080 })).toEqual({ x: 1900, y: 1060 });
  });

  it('absolute objects ignore the canvas', () => {
    expect(resolveAnchor(null, { x: 5, y: 7 }, canvas)).toEqual({ x: 5, y: 7 });
  });

  it('toOffset inverts resolveAnchor for every anchor', () => {
    for (const a of [null, ...ANCHORS]) {
      const abs = resolveAnchor(a, { x: 13, y: -9 }, canvas);
      expect(toOffset(a, abs, canvas)).toEqual({ x: 13, y: -9 });
    }
  });
});
