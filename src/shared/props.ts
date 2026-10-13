// The editor's single property table. Shared by the store, the viewport (phaser-main) and the inspector.
// Phaser is imported as a type only, so no Phaser code reaches the editor bundle.
import type * as Phaser from 'phaser';
type Sprite = Phaser.GameObjects.Sprite;

export type PropKind = 'number' | 'boolean' | 'color';
type KindValue = { number: number; boolean: boolean; color: string };

export type PropSection =
  | 'Position' | 'Rotation' | 'Scale' | 'Appearance'
  | 'Depth (Z-order)' | 'Origin (Pivot)' | 'Flip' | 'Scroll Factor';

export interface PropUi {
  section: PropSection;
  label: string;
  /** 'field' = InspectorField (default); 'toggle' = PresetButton that flips a boolean and commits. */
  control?: 'field' | 'toggle';
  min?: number; max?: number; step?: number;
  /** Clamp edits to [min, max] (the input's min/max alone does not clamp). */
  clamp?: boolean;
  /** Math.round edits. */
  integer?: boolean;
}

export interface PropDescriptor<K extends PropKind = PropKind> {
  kind: K;
  default: KindValue[K];
  /** round2 values coming from the viewport (OBJECT_SELECTED / OBJECT_TRANSFORMED). */
  round?: boolean;
  /** Editable in live mode via FORGE_SET_PROP (must match bridge SETTABLE_PROPS + depth). */
  live?: boolean;
  /** Defaults: read/assign sprite[key]. Method syntax on purpose (bivariant params). */
  get?(s: Sprite): KindValue[K];
  set?(s: Sprite, v: KindValue[K]): void;
  ui: PropUi;
}
type AnyPropDescriptor = { [K in PropKind]: PropDescriptor<K> }[PropKind];

export const round2 = (n: number) => Math.round(n * 100) / 100;
const hexTint = (s: Sprite) => '#' + (s.tintTopLeft ?? 0xffffff).toString(16).padStart(6, '0');

/** THE property list. Order = inspector order. Adding a property = adding one entry here. */
export const PROPS = {
  x:        { kind: 'number', default: 0, round: true, live: true, ui: { section: 'Position', label: 'X', step: 1 } },
  y:        { kind: 'number', default: 0, round: true, live: true, ui: { section: 'Position', label: 'Y', step: 1 } },
  rotation: { kind: 'number', default: 0, round: true, live: true, ui: { section: 'Rotation', label: 'Angle (rad)' } },
  scaleX:   { kind: 'number', default: 1, round: true, live: true, ui: { section: 'Scale', label: 'Scale X', min: 0 } },
  scaleY:   { kind: 'number', default: 1, round: true, live: true, ui: { section: 'Scale', label: 'Scale Y', min: 0 } },
  alpha:    { kind: 'number', default: 1, round: true, live: true, ui: { section: 'Appearance', label: 'Alpha', min: 0, max: 1, clamp: true } },
  tint:     { kind: 'color', default: '#ffffff',
              get: (s: Sprite) => hexTint(s),
              set: (s: Sprite, v: string) => { s.setTint(parseInt(v.replace('#', ''), 16)); },
              ui: { section: 'Appearance', label: 'Tint' } },
  visible:  { kind: 'boolean', default: true, live: true, ui: { section: 'Appearance', label: 'Visible' } },
  depth:    { kind: 'number', default: 0, live: true,
              set: (s: Sprite, v: number) => { s.setDepth(v); },
              ui: { section: 'Depth (Z-order)', label: 'Depth', step: 1, integer: true } },
  originX:  { kind: 'number', default: 0.5, round: true,
              set: (s: Sprite, v: number) => { s.setOrigin(v, s.originY); },
              ui: { section: 'Origin (Pivot)', label: 'Origin X', min: 0, max: 1, clamp: true } },
  originY:  { kind: 'number', default: 0.5, round: true,
              set: (s: Sprite, v: number) => { s.setOrigin(s.originX, v); },
              ui: { section: 'Origin (Pivot)', label: 'Origin Y', min: 0, max: 1, clamp: true } },
  flipX:    { kind: 'boolean', default: false, ui: { section: 'Flip', label: 'Flip X', control: 'toggle' } },
  flipY:    { kind: 'boolean', default: false, ui: { section: 'Flip', label: 'Flip Y', control: 'toggle' } },
  scrollFactorX: { kind: 'number', default: 1, ui: { section: 'Scroll Factor', label: 'Factor X', step: 0.1, min: 0, max: 1 } },
  scrollFactorY: { kind: 'number', default: 1, ui: { section: 'Scroll Factor', label: 'Factor Y', step: 0.1, min: 0, max: 1 } },
} as const satisfies Record<string, AnyPropDescriptor>;

export type PropKey = keyof typeof PROPS;
export type ObjectProps = { -readonly [K in PropKey]: KindValue[(typeof PROPS)[K]['kind']] };
export type LiveProp = { [K in PropKey]: (typeof PROPS)[K] extends { live: true } ? K : never }[PropKey];

export const PROP_KEYS = Object.keys(PROPS) as PropKey[];
export const describe = (k: PropKey): PropDescriptor => PROPS[k];
export const PROP_DEFAULTS = Object.fromEntries(PROP_KEYS.map(k => [k, PROPS[k].default])) as ObjectProps;

export const pickProps = (s: ObjectProps): ObjectProps =>
  Object.fromEntries(PROP_KEYS.map(k => [k, s[k]])) as ObjectProps;

/** Props present in a viewport message, rounded per descriptor. Replaces the OBJECT_SELECTED mapping and the OBJECT_TRANSFORMED key loop. */
export function readWireProps(src: Partial<Record<PropKey, unknown>>): Partial<ObjectProps> {
  const out: Partial<Record<PropKey, unknown>> = {};
  for (const k of PROP_KEYS) {
    const v = src[k];
    if (v !== undefined) out[k] = describe(k).round && typeof v === 'number' ? round2(v) : v;
  }
  return out as Partial<ObjectProps>;
}

/** Inspector edit normalization (alpha/origin clamp, depth integer). */
export function normalizeEdit<V>(k: PropKey, v: V): V {
  const ui = describe(k).ui;
  if (typeof v !== 'number') return v;
  let n: number = v;
  if (ui.integer) n = Math.round(n);
  if (ui.clamp) n = Math.min(ui.max ?? Infinity, Math.max(ui.min ?? -Infinity, n));
  return n as V;
}
