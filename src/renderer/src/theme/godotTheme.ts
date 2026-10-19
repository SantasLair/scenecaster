// Derives the editor's colours from a base colour, an accent and a contrast, the way Godot 4.8's Modern theme does
// (editor/themes/theme_modern.cpp, editor_theme_manager.cpp). Pure functions: the result is a map of CSS variables.

export interface Rgba { r: number; g: number; b: number; a: number }
export interface ThemeInput { base: Rgba; accent: Rgba; contrast: number }
export type ThemeVars = Record<string, string>;

const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });
const gray = (v: number, a = 1) => rgba(v, v, v, a);
const WHITE = rgba(1, 1, 1);
const BLACK = rgba(0, 0, 0);
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const lerp = (a: Rgba, b: Rgba, t: number): Rgba => rgba(mix(a.r, b.r, t), mix(a.g, b.g, t), mix(a.b, b.b, t), mix(a.a, b.a, t));
const withAlpha = (c: Rgba, a: number): Rgba => ({ ...c, a });
const luminance = (c: Rgba) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function toHsv(c: Rgba): [number, number, number] {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function fromHsv(h: number, s: number, v: number, a: number): Rgba {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return rgba(r, g, b, a);
}

const css = (c: Rgba) =>
  `rgb(${Math.round(clamp(c.r) * 255)} ${Math.round(clamp(c.g) * 255)} ${Math.round(clamp(c.b) * 255)} / ${+clamp(c.a).toFixed(3)})`;

/** Godot's `_get_base_color(ofs, satmult)`: a negative offset lightens the base, a positive one darkens it. */
function baseShade(base: Rgba, contrast: number, ofs: number, satmult: number): Rgba {
  const [h, s, v] = toHsv(base);
  const fc = ofs < 0 ? clamp(contrast, -0.1, 0.5) : contrast;
  return fromHsv(h, clamp(s * satmult), clamp(mix(v, 0, fc * ofs)), base.a);
}

export const PRESETS: Record<string, ThemeInput> = {
  Default: { base: gray(0.161), accent: rgba(0.337, 0.62, 1), contrast: 0.3 },
  Black: { base: gray(0), accent: rgba(0.45, 0.75, 1), contrast: 0 },
  Gray: { base: gray(0.24), accent: rgba(0.44, 0.73, 0.98), contrast: 0.3 },
  'Breeze Dark': { base: rgba(0.1255, 0.1373, 0.149), accent: rgba(0.239, 0.682, 0.914), contrast: 0.3 },
  Light: { base: gray(0.9), accent: rgba(0.18, 0.5, 1), contrast: -0.06 },
};
export const DEFAULT_PRESET = 'Default';

/** Sizes from Godot's Modern theme at the Default spacing preset, in px. */
export const SIZES = { radius: 4, space: 4, inputX: 8, inputY: 4, buttonX: 8, buttonY: 6, treeRowY: 3, tabX: 16, tabY: 8 };

export function deriveTheme({ base, accent, contrast }: ThemeInput): ThemeVars {
  const dark = luminance(base) < 0.5;
  const mono = dark ? WHITE : BLACK;
  const shade = (ofs: number, sat: number) => baseShade(base, contrast, ofs, sat);

  const surface = {
    popup: shade(1.9, 0.9), lowest: shade(1.7, 0.9), lower: shade(1.1, 0.9), low: shade(0.8, 1), base,
    high: shade(-1.3, 0.8), higher: shade(-1.5, 0.8), highest: shade(-2.2, 0.6),
  };
  const button = { normal: shade(-2, 0.85), hover: shade(-2.9, 0.75), pressed: shade(-3.2, 0.75), disabled: shade(-1.4, 0.75) };
  const buttonBorder = { normal: shade(-2.5, 0.75), hover: shade(-3.4, 0.75), pressed: shade(-3.7, 0.75) };
  const flat = { hover: shade(-1.2, 0.75), pressed: shade(-2, 0.75), hoverPressed: shade(-2.4, 0.75) };
  const dark1 = lerp(base, BLACK, clamp(contrast * 1.15));
  const dark2 = dark ? rgba(0, 0, 0, 0.3) : rgba(1, 1, 1, 0.3);

  const font = {
    normal: withAlpha(mono, 0.75), secondary: withAlpha(mono, 0.55), focus: mono,
    hover: withAlpha(mono, 0.85), disabled: withAlpha(mono, dark ? 0.35 : 0.5), readonly: withAlpha(mono, 0.65),
  };
  const status = dark
    ? { info: rgba(0.7, 0.8, 1), success: rgba(0.45, 0.95, 0.5), warning: rgba(0.83, 0.78, 0.62), error: rgba(1, 0.47, 0.42) }
    : { info: rgba(0.35, 0.6, 0.9), success: lerp(rgba(0.45, 0.95, 0.5), mono, 0.35), warning: rgba(0.83, 0.49, 0.01), error: rgba(0.8, 0.22, 0.22) };

  const vars: ThemeVars = {};
  const set = (name: string, c: Rgba) => { vars[`--gd-${name}`] = css(c); };
  for (const [k, c] of Object.entries(surface)) set(`surface-${k}`, c);
  for (const [k, c] of Object.entries(button)) set(`button-${k}`, c);
  for (const [k, c] of Object.entries(buttonBorder)) set(`button-border-${k}`, c);
  set('flat-hover', flat.hover); set('flat-pressed', flat.pressed); set('flat-hover-pressed', flat.hoverPressed);
  for (const [k, c] of Object.entries(font)) set(`font-${k}`, c);
  for (const [k, c] of Object.entries(status)) set(k, c);
  set('accent', accent);
  set('highlight', withAlpha(accent, 0.275));
  set('selection', withAlpha(accent, 0.4));
  set('focus-ring', withAlpha(accent, 0.8));
  set('dark-1', dark1);
  set('dark-2', dark2);
  set('dark-3', shade(0.8, 0.9));
  set('contrast-1', lerp(base, mono, Math.max(contrast * 1.15, 0.345)));
  set('contrast-2', lerp(base, mono, Math.max(contrast * 1.725, 0.5175)));
  set('separator', dark ? rgba(0, 0, 0, 0.4) : rgba(0, 0, 0, 0.2));
  set('shadow', rgba(0, 0, 0, dark ? 0.3 : 0.1));
  set('tree-hover', flat.hover);
  set('tree-selected', flat.pressed);
  set('tree-panel', lerp(dark1, dark2, 0.5));
  set('row-selected', withAlpha(mono, 0.05));
  set('axis-x', rgba(0.96, 0.2, 0.32)); set('axis-y', rgba(0.53, 0.84, 0.01)); set('axis-z', rgba(0.16, 0.55, 0.96));

  // Tailwind palettes, so every existing gray-* and blue-* utility follows the theme. Grays are used for surfaces
  // (950..700) and for text (600..50): the text steps map to Godot's font alphas.
  const grays: Record<number, Rgba> = {
    950: surface.lowest, 900: surface.base, 800: surface.high, 700: button.normal, 600: font.disabled,
    500: font.secondary, 400: font.normal, 300: font.hover, 200: font.focus, 100: font.focus, 50: font.focus,
  };
  const blues: Record<number, [Rgba, number]> = {
    50: [WHITE, 0.9], 100: [WHITE, 0.8], 200: [WHITE, 0.6], 300: [WHITE, 0.4], 400: [WHITE, 0.2], 500: [WHITE, 0],
    600: [BLACK, 0.15], 700: [BLACK, 0.3], 800: [BLACK, 0.45], 900: [BLACK, 0.6], 950: [BLACK, 0.75],
  };
  for (const [step, c] of Object.entries(grays)) vars[`--color-gray-${step}`] = css(c);
  for (const [step, [to, t]] of Object.entries(blues)) vars[`--color-blue-${step}`] = css(lerp(withAlpha(accent, 1), to, t));
  vars['--color-red-400'] = css(status.error);
  vars['--color-green-400'] = css(status.success);
  vars['--color-yellow-300'] = css(status.warning);
  vars['--gd-radius'] = `${SIZES.radius}px`;
  return vars;
}

export function applyTheme(vars: ThemeVars, root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
