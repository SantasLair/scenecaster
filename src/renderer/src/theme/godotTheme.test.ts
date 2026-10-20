import { describe, expect, it } from 'vitest';
import { deriveTheme, fromHex, presetName, PRESETS, toHex } from './godotTheme';

const rgb = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);

describe('deriveTheme', () => {
  const v = deriveTheme(PRESETS.Default);
  const lum = (k: string) => rgb(v[k])[0];

  it('keeps the base surface equal to the base colour', () => {
    expect(rgb(v['--gd-surface-base'])).toEqual([41, 41, 41]);
  });
  it('darkens low surfaces and lightens high ones', () => {
    expect(lum('--gd-surface-lowest')).toBeLessThan(lum('--gd-surface-lower'));
    expect(lum('--gd-surface-lower')).toBeLessThan(lum('--gd-surface-base'));
    expect(lum('--gd-surface-base')).toBeLessThan(lum('--gd-surface-high'));
    expect(lum('--gd-surface-high')).toBeLessThan(lum('--gd-surface-highest'));
    expect(lum('--gd-button-normal')).toBeLessThan(lum('--gd-button-pressed'));
  });
  it('uses the accent as given and a graded blue scale', () => {
    expect(rgb(v['--gd-accent'])).toEqual([86, 158, 255]);
    expect(rgb(v['--color-blue-500'])).toEqual([86, 158, 255]);
    expect(rgb(v['--color-blue-900'])[2]).toBeLessThan(rgb(v['--color-blue-500'])[2]);
  });
  it('uses white fonts on a dark base and black on a light base', () => {
    expect(v['--gd-font-focus']).toMatch(/^rgb\(255 255 255/);
    expect(deriveTheme(PRESETS.Light)['--gd-font-focus']).toMatch(/^rgb\(0 0 0/);
  });
  it('cannot lighten a black base', () => {
    expect(rgb(deriveTheme(PRESETS.Black)['--gd-surface-high'])).toEqual([0, 0, 0]);
  });
});

describe('hex and presets', () => {
  it('round-trips #rrggbb and rejects anything else', () => {
    expect(toHex(fromHex('#569eff')!)).toBe('#569eff');
    expect(fromHex('569eff')).toBeNull();
    expect(fromHex('#fff')).toBeNull();
  });
  it('names a matching preset and reports a custom theme as null', () => {
    for (const n of Object.keys(PRESETS)) expect(presetName(PRESETS[n])).toBe(n);
    expect(presetName({ ...PRESETS.Default, contrast: 0.4 })).toBeNull();
  });
});
