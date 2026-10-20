import { describe, expect, it } from 'vitest';
import { sheetFrames, sheetSpec } from './sheet';

describe('spritesheet layout', () => {
  it('cuts frames left to right, then top to bottom', () => {
    const frames = sheetFrames(64, 32, { frameWidth: 32, frameHeight: 32 });
    expect(frames.map(f => [f.index, f.x, f.y])).toEqual([[0, 0, 0], [1, 32, 0]]);
    expect(sheetFrames(64, 64, { frameWidth: 32, frameHeight: 32 })).toHaveLength(4);
  });

  it('honours margin and spacing and drops partial frames', () => {
    // 2px margin, 1px spacing: columns start at x = 2, 19, 36 and a fourth would not fit in 60px.
    const frames = sheetFrames(60, 20, { frameWidth: 16, frameHeight: 16, margin: 2, spacing: 1 });
    expect(frames.map(f => f.x)).toEqual([2, 19, 36]);
    expect(frames.every(f => f.y === 2)).toBe(true);
  });

  it('has no frames when the frame is larger than the image', () => {
    expect(sheetFrames(10, 10, { frameWidth: 32, frameHeight: 32 })).toEqual([]);
  });

  it('reads a spec from a manifest entry, or null without a usable frame size', () => {
    expect(sheetSpec({ frameWidth: 16, frameHeight: 24, margin: 1 })).toEqual({ frameWidth: 16, frameHeight: 24, margin: 1, spacing: 0 });
    expect(sheetSpec({ frameWidth: 0, frameHeight: 24 })).toBeNull();
    expect(sheetSpec({ frameHeight: 24 })).toBeNull();
  });
});
