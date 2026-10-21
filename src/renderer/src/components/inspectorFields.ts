// The Inspector's field table: adding a field means adding one entry to FIELDS. Pure data and helpers (no React), so
// it can be unit-tested. Which fields apply to which object type follows docs/SPEC.md of PHASEFORM.
import type { PfObject } from '../../../shared/phaseform/types';
import { SHAPE_TYPES } from '../../../shared/phaseform/types';

export type FieldKind =
  | 'text' | 'textarea' | 'number' | 'int' | 'angle' | 'bool' | 'color' | 'select'
  | 'vec2' | 'numstr' | 'texture' | 'font' | 'presence' | 'json' | 'points';

export const SECTIONS = ['Identity', 'Transform', 'Appearance', 'Depth', 'Texture', 'Tiling', 'Text', 'Bitmap Text', 'Shape'] as const;
export type Section = typeof SECTIONS[number];

export interface FieldDef {
  /** `path[0]` is the top-level object field; deeper entries address a nested value (e.g. ['style', 'color']). */
  path: string[];
  label: string;
  section: Section;
  kind: FieldKind;
  /** Object types the field applies to. */
  types: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  /** For 'select'. An empty string means "unset" and removes the field. */
  options?: readonly string[];
  /** Value shown (and used as the base for vec2 edits) while the field is absent. */
  def?: unknown;
  /** Required fields cannot be reset (removed). */
  required?: boolean;
  topLevelOnly?: boolean;
  /** Free-form colors (CSS names, rgba()) instead of strict #rrggbb. */
  freeColor?: boolean;
  /** For 'presence': the value written when the toggle is switched on. */
  enable?: unknown;
  /** Shown only while this returns true. */
  when?: (o: PfObject) => boolean;
  hint?: string;
}

const SHAPES: readonly string[] = SHAPE_TYPES;
const FILLABLE = SHAPES.filter(t => t !== 'line');
const IMAGE_LIKE = ['image', 'sprite'];
const TEXTURED = ['image', 'sprite', 'tileSprite'];
const TINTABLE = ['image', 'sprite', 'tileSprite', 'text', 'bitmapText'];
const ORIGINAL = ['image', 'sprite', 'tileSprite', 'text', 'bitmapText', ...SHAPES];
const BLENDABLE = ['image', 'sprite', 'tileSprite', 'text', 'bitmapText', 'container', ...SHAPES];
const SCALABLE = ['image', 'sprite', 'tileSprite', 'text', 'bitmapText', 'container', ...SHAPES];
export const ALL_TYPES = [...new Set([...SCALABLE, 'graphics'])];

export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen'] as const;
export const TINT_MODES = ['multiply', 'fill', 'add', 'screen', 'overlay', 'hard-light'] as const;

const f = (d: FieldDef): FieldDef => d;
const hasFill = (o: PfObject) => 'fill' in o && o.fill != null;
const hasStroke = (o: PfObject) => 'stroke' in o && o.stroke != null;

export const FIELDS: readonly FieldDef[] = [
  // Identity
  f({ path: ['name'], label: 'Name', section: 'Identity', kind: 'text', types: ALL_TYPES }),

  // Transform
  f({ path: ['x'], label: 'X', section: 'Transform', kind: 'number', step: 1, def: 0, types: ALL_TYPES }),
  f({ path: ['y'], label: 'Y', section: 'Transform', kind: 'number', step: 1, def: 0, types: ALL_TYPES }),
  f({ path: ['rotation'], label: 'Rotation (deg)', section: 'Transform', kind: 'angle', step: 1, def: 0, types: SCALABLE }),
  f({ path: ['scale'], label: 'Scale', section: 'Transform', kind: 'vec2', step: 0.05, def: { x: 1, y: 1 }, types: SCALABLE }),
  f({ path: ['origin'], label: 'Origin', section: 'Transform', kind: 'vec2', step: 0.05, min: 0, max: 1, def: { x: 0.5, y: 0.5 }, types: ORIGINAL }),
  f({ path: ['anchor', 'x'], label: 'Anchor X', section: 'Transform', kind: 'select', options: ['', 'left', 'center', 'right'], def: 'left', topLevelOnly: true, types: ALL_TYPES,
    hint: 'Which edge of the game this object follows when the game size differs from the scene size. X and Y stay the position at the scene size.' }),
  f({ path: ['anchor', 'y'], label: 'Anchor Y', section: 'Transform', kind: 'select', options: ['', 'top', 'center', 'bottom'], def: 'top', topLevelOnly: true, types: ALL_TYPES }),

  // Appearance
  f({ path: ['alpha'], label: 'Alpha', section: 'Appearance', kind: 'number', min: 0, max: 1, step: 0.05, def: 1, types: ALL_TYPES }),
  f({ path: ['visible'], label: 'Visible', section: 'Appearance', kind: 'bool', def: true, types: ALL_TYPES }),
  f({ path: ['active'], label: 'Active', section: 'Appearance', kind: 'bool', def: true, types: ALL_TYPES }),
  f({ path: ['blendMode'], label: 'Blend mode', section: 'Appearance', kind: 'select', options: ['', ...BLEND_MODES], def: 'normal', types: BLENDABLE }),
  f({ path: ['tint'], label: 'Tint', section: 'Appearance', kind: 'color', def: '#ffffff', types: TINTABLE }),
  f({ path: ['tintMode'], label: 'Tint mode', section: 'Appearance', kind: 'select', options: ['', ...TINT_MODES], def: 'multiply', types: TINTABLE }),
  f({ path: ['flipX'], label: 'Flip X', section: 'Appearance', kind: 'bool', def: false, types: TEXTURED }),
  f({ path: ['flipY'], label: 'Flip Y', section: 'Appearance', kind: 'bool', def: false, types: TEXTURED }),
  f({ path: ['scrollFactor'], label: 'Scroll factor', section: 'Appearance', kind: 'vec2', step: 0.1, def: { x: 1, y: 1 }, types: ALL_TYPES }),

  // Depth (draw order applies at the scene root only)
  f({ path: ['depth'], label: 'Depth', section: 'Depth', kind: 'int', step: 1, def: 0, topLevelOnly: true, types: ALL_TYPES,
    hint: 'Higher draws in front. Children draw in list order.' }),

  // Texture
  f({ path: ['key'], label: 'Texture', section: 'Texture', kind: 'texture', required: true, types: TEXTURED }),
  f({ path: ['frame'], label: 'Frame', section: 'Texture', kind: 'numstr', types: TEXTURED }),

  // Tile sprite
  f({ path: ['width'], label: 'Width', section: 'Tiling', kind: 'number', step: 1, min: 1, def: 1, required: true, types: ['tileSprite'] }),
  f({ path: ['height'], label: 'Height', section: 'Tiling', kind: 'number', step: 1, min: 1, def: 1, required: true, types: ['tileSprite'] }),
  f({ path: ['tilePosition'], label: 'Tile position', section: 'Tiling', kind: 'vec2', step: 1, def: { x: 0, y: 0 }, types: ['tileSprite'] }),
  f({ path: ['tileScale'], label: 'Tile scale', section: 'Tiling', kind: 'vec2', step: 0.05, def: { x: 1, y: 1 }, types: ['tileSprite'] }),
  f({ path: ['tileRotation'], label: 'Tile rotation (deg)', section: 'Tiling', kind: 'angle', step: 1, def: 0, types: ['tileSprite'] }),

  // Text
  f({ path: ['text'], label: 'Text', section: 'Text', kind: 'textarea', required: true, types: ['text'] }),
  f({ path: ['style', 'fontFamily'], label: 'Font family', section: 'Text', kind: 'text', def: 'Courier', types: ['text'] }),
  f({ path: ['style', 'fontSize'], label: 'Font size', section: 'Text', kind: 'numstr', def: 16, types: ['text'] }),
  f({ path: ['style', 'fontStyle'], label: 'Font style', section: 'Text', kind: 'select', options: ['', 'normal', 'bold', 'italic', 'bold italic'], def: '', types: ['text'] }),
  f({ path: ['style', 'color'], label: 'Color', section: 'Text', kind: 'color', freeColor: true, def: '#ffffff', types: ['text'] }),
  f({ path: ['style', 'align'], label: 'Align', section: 'Text', kind: 'select', options: ['', 'left', 'center', 'right', 'justify'], def: 'left', types: ['text'] }),
  f({ path: ['style', 'stroke'], label: 'Stroke', section: 'Text', kind: 'color', freeColor: true, def: '#000000', types: ['text'] }),
  f({ path: ['style', 'strokeThickness'], label: 'Stroke thickness', section: 'Text', kind: 'number', min: 0, step: 1, def: 0, types: ['text'] }),
  f({ path: ['style', 'backgroundColor'], label: 'Background', section: 'Text', kind: 'color', freeColor: true, def: '#000000', types: ['text'] }),
  f({ path: ['style', 'lineSpacing'], label: 'Line spacing', section: 'Text', kind: 'number', step: 1, def: 0, types: ['text'] }),
  f({ path: ['style', 'wordWrap', 'width'], label: 'Wrap width', section: 'Text', kind: 'number', min: 0, step: 1, def: 0, types: ['text'] }),
  f({ path: ['style'], label: 'Style (raw JSON)', section: 'Text', kind: 'json', types: ['text'] }),

  // Bitmap text
  f({ path: ['font'], label: 'Font', section: 'Bitmap Text', kind: 'font', required: true, types: ['bitmapText'] }),
  f({ path: ['text'], label: 'Text', section: 'Bitmap Text', kind: 'textarea', required: true, types: ['bitmapText'] }),
  f({ path: ['size'], label: 'Size', section: 'Bitmap Text', kind: 'number', min: 1, step: 1, types: ['bitmapText'] }),
  f({ path: ['align'], label: 'Align', section: 'Bitmap Text', kind: 'select', options: ['', 'left', 'center', 'right'], def: 'left', types: ['bitmapText'] }),
  f({ path: ['letterSpacing'], label: 'Letter spacing', section: 'Bitmap Text', kind: 'number', step: 1, def: 0, types: ['bitmapText'] }),
  f({ path: ['lineSpacing'], label: 'Line spacing', section: 'Bitmap Text', kind: 'number', step: 1, def: 0, types: ['bitmapText'] }),
  f({ path: ['maxWidth'], label: 'Max width', section: 'Bitmap Text', kind: 'number', min: 0, step: 1, def: 0, types: ['bitmapText'] }),

  // Shapes
  f({ path: ['width'], label: 'Width', section: 'Shape', kind: 'number', step: 1, def: 0, required: true, types: ['rectangle', 'ellipse'] }),
  f({ path: ['height'], label: 'Height', section: 'Shape', kind: 'number', step: 1, def: 0, required: true, types: ['rectangle', 'ellipse'] }),
  f({ path: ['smoothness'], label: 'Smoothness', section: 'Shape', kind: 'int', min: 3, step: 1, def: 64, types: ['ellipse'] }),
  f({ path: ['pointCount'], label: 'Point count', section: 'Shape', kind: 'int', min: 3, step: 1, def: 5, types: ['star'] }),
  f({ path: ['innerRadius'], label: 'Inner radius', section: 'Shape', kind: 'number', min: 0, step: 1, def: 0, required: true, types: ['star'] }),
  f({ path: ['outerRadius'], label: 'Outer radius', section: 'Shape', kind: 'number', min: 0, step: 1, def: 0, required: true, types: ['star'] }),
  f({ path: ['radius'], label: 'Radius', section: 'Shape', kind: 'number', min: 0, step: 1, def: 0, required: true, types: ['arc'] }),
  f({ path: ['startAngle'], label: 'Start angle (deg)', section: 'Shape', kind: 'number', step: 1, def: 0, types: ['arc'] }),
  f({ path: ['endAngle'], label: 'End angle (deg)', section: 'Shape', kind: 'number', step: 1, def: 360, types: ['arc'] }),
  f({ path: ['anticlockwise'], label: 'Anticlockwise', section: 'Shape', kind: 'bool', def: false, types: ['arc'] }),
  f({ path: ['iterations'], label: 'Iterations', section: 'Shape', kind: 'number', min: 0.001, step: 0.005, def: 0.01, types: ['arc'] }),
  f({ path: ['points'], label: 'Points', section: 'Shape', kind: 'points', required: true, types: ['triangle', 'line', 'polygon'] }),
  f({ path: ['fill'], label: 'Fill', section: 'Shape', kind: 'presence', enable: { color: '#ffffff' }, types: FILLABLE }),
  f({ path: ['fill', 'color'], label: 'Fill color', section: 'Shape', kind: 'color', def: '#ffffff', required: true, when: hasFill, types: FILLABLE }),
  f({ path: ['fill', 'alpha'], label: 'Fill alpha', section: 'Shape', kind: 'number', min: 0, max: 1, step: 0.05, def: 1, when: hasFill, types: FILLABLE }),
  f({ path: ['stroke'], label: 'Stroke', section: 'Shape', kind: 'presence', enable: { color: '#ffffff', width: 1 }, types: SHAPES.filter(t => t !== 'line') }),
  f({ path: ['stroke', 'color'], label: 'Stroke color', section: 'Shape', kind: 'color', def: '#ffffff', required: true, when: hasStroke, types: SHAPES }),
  f({ path: ['stroke', 'width'], label: 'Stroke width', section: 'Shape', kind: 'number', min: 0, step: 0.5, def: 1, when: hasStroke, types: SHAPES }),
  f({ path: ['stroke', 'alpha'], label: 'Stroke alpha', section: 'Shape', kind: 'number', min: 0, max: 1, step: 0.05, def: 1, when: hasStroke, types: SHAPES }),
  f({ path: ['stroke', 'endWidth'], label: 'End width', section: 'Shape', kind: 'number', min: 0, step: 0.5, when: hasStroke, types: ['line'] }),
];

/** Fields that apply to `type`. Depth-like fields are dropped for nested objects when `topLevel` is false. */
export function fieldsFor(type: string, topLevel = true): FieldDef[] {
  return FIELDS.filter(d => d.types.includes(type) && (topLevel || !d.topLevelOnly));
}

/** Fields of `type` grouped by section in display order (empty sections omitted). */
export function sectionsFor(type: string, topLevel = true): [Section, FieldDef[]][] {
  const fields = fieldsFor(type, topLevel);
  return SECTIONS.map(s => [s, fields.filter(d => d.section === s)] as [Section, FieldDef[]]).filter(([, l]) => l.length > 0);
}

/** Top-level object keys that the Inspector handles itself (never listed under Advanced). */
const ALWAYS_COVERED = ['id', 'type', 'children'];

export function coveredKeys(type: string, topLevel = true): Set<string> {
  return new Set([...ALWAYS_COVERED, ...fieldsFor(type, topLevel).map(d => d.path[0])]);
}

/** True for a well-formed `scripts` value (an array of strings): the Scripts section edits it; anything else stays raw JSON. */
export const isScriptList = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');

/** Moves the item at `from` to `to`; returns the same array when nothing would change. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}

/** Fields present on the object that the table does not cover for its type, in object order: edited as raw JSON. */
export function advancedKeys(obj: PfObject, topLevel = true): string[] {
  const covered = coveredKeys(obj.type, topLevel);
  return Object.keys(obj).filter(k => !covered.has(k) && !(k === 'scripts' && isScriptList(obj[k])));
}

export const radToDeg = (r: number) => Number(((r * 180) / Math.PI).toFixed(4));
export const degToRad = (d: number) => (d * Math.PI) / 180;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads a nested value. */
export function getAt(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) { if (!isRec(cur)) return undefined; cur = cur[k]; }
  return cur;
}

/**
 * The patch that sets `path` to `value` (undefined removes it). Always carries the WHOLE top-level value, so nested edits
 * keep sibling fields: setAt(obj, ['scale','x'], 2) gives { scale: { ...obj.scale, x: 2 } }.
 */
export function setAt(obj: PfObject, path: readonly string[], value: unknown): Record<string, unknown> {
  const rebuild = (cur: unknown, rest: readonly string[]): unknown => {
    if (rest.length === 0) return value;
    const base = isRec(cur) ? { ...cur } : {};
    const [head, ...tail] = rest;
    if (tail.length === 0 && value === undefined) delete base[head];
    else base[head] = rebuild(base[head], tail);
    return base;
  };
  const top = path[0];
  return { [top]: path.length === 1 ? value : rebuild(obj[top], path.slice(1)) };
}

/** `frame` and font sizes accept a number or a string: whole numbers are stored as numbers. */
export function parseNumStr(text: string): number | string | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  return /^-?\d+$/.test(t) ? parseInt(t, 10) : t;
}

export const pointCount = (v: unknown) => (Array.isArray(v) ? v.length : 0);

export const isHexColor = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
