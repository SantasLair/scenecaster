// The scene file format and its validation. Pure functions, no I/O.
// One object per line keeps diffs small and lets an AI edit the file safely.
import { PROPS, PROP_KEYS, PROP_DEFAULTS, describe, extensionKeys, type EngineId, type ObjectProps } from './props';
import { ANCHORS, type Anchor, type SceneObject, type Shape } from './protocol';

export const SCENE_VERSION = 1;
const SHAPES: Shape[] = ['rect', 'circle', 'triangle'];

export interface SceneDoc {
  version: number;
  /** Must match the Phaser scene key in the game's code. */
  key: string;
  /** The scene draws over another one: neutral backdrop, canvas size comes from the game. */
  overlay: boolean;
  objects: SceneObject[];
}

export interface SceneProblem { level: 'error' | 'warning'; message: string }

export const newId = () => crypto.randomUUID();

/** `base`, or `base 2`, `base 3`... the first name not in `taken` (case-insensitive). */
/** A name usable as a code identifier (the code contract for UI scenes). */
export const isIdentifier = (n: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n);

/** Turns any text into a valid identifier. */
export function toIdentifier(s: string): string {
  const t = s.trim().replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+(?=.)|_+$/g, '');
  return !t ? 'Object' : /^[0-9]/.test(t) ? '_' + t : t;
}

/** `base`, or `base2`, `base3`... the first name not in `taken` (case-insensitive). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
}

/** Keys in a fixed order so saving an unchanged scene never produces a diff. */
function orderObject(o: SceneObject, engine: EngineId): Record<string, unknown> {
  const out: Record<string, unknown> = { id: o.id, name: o.name, kind: o.kind };
  if (o.kind === 'sprite') out.asset = o.asset; else out.shape = o.shape;
  for (const k of PROP_KEYS) if (!describe(k).engine) out[k] = o[k];
  out.anchor = o.anchor;
  out.interactive = o.interactive;
  const ext: Record<string, unknown> = {};
  for (const k of extensionKeys(engine)) ext[k] = o[k];
  out[engine] = ext;
  return out;
}

export function formatScene(doc: SceneDoc, engine: EngineId): string {
  const head = `  "version": ${doc.version},\n  "key": ${JSON.stringify(doc.key)},\n  "overlay": ${doc.overlay},\n`;
  const body = doc.objects.length
    ? `  "objects": [\n${doc.objects.map(o => '    ' + JSON.stringify(orderObject(o, engine))).join(',\n')}\n  ]\n`
    : '  "objects": []\n';
  return `{\n${head}${body}}\n`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Never throws. Bad objects are skipped and reported; missing props take defaults. */
/** `fatal`: the file could not be understood at all; the returned doc is empty and must never be saved over the file. */
export function parseScene(raw: unknown, expectedKey: string, engine: EngineId): { doc: SceneDoc; problems: SceneProblem[]; fatal: boolean } {
  const problems: SceneProblem[] = [];
  const err = (message: string) => problems.push({ level: 'error', message });
  const warn = (message: string) => problems.push({ level: 'warning', message });
  const doc: SceneDoc = { version: SCENE_VERSION, key: expectedKey, overlay: false, objects: [] };

  if (!isRecord(raw)) { err('Scene file is not a JSON object.'); return { doc, problems, fatal: true }; }
  if (raw.version !== SCENE_VERSION) {
    err(`Unsupported scene version ${JSON.stringify(raw.version)} (expected ${SCENE_VERSION}); nothing was loaded.`);
    return { doc, problems, fatal: true };
  }
  if (raw.key !== expectedKey) warn(`Scene key ${JSON.stringify(raw.key)} does not match the file name "${expectedKey}"; using "${expectedKey}".`);
  doc.overlay = raw.overlay === true;
  if (!Array.isArray(raw.objects)) { err('"objects" must be an array.'); return { doc, problems, fatal: true }; }

  const ids = new Set<string>();
  const names = new Set<string>();
  raw.objects.forEach((r, i) => {
    const at = `Object #${i + 1}`;
    if (!isRecord(r)) return err(`${at} is not an object; skipped.`);
    if (typeof r.id !== 'string' || !r.id) return err(`${at} has no id; skipped.`);
    if (ids.has(r.id)) return err(`${at}: duplicate id ${r.id}; skipped.`);
    if (typeof r.name !== 'string' || !r.name) return err(`${at} (${r.id}) has no name; skipped.`);
    const label = `"${r.name}"`;
    if (r.kind !== 'sprite' && r.kind !== 'primitive') return err(`${label}: unknown kind ${JSON.stringify(r.kind)}; skipped.`);

    const props = { ...PROP_DEFAULTS } as Record<string, unknown>;
    const extSrc = isRecord(r[engine]) ? r[engine] as Record<string, unknown> : {};
    const extKeys: string[] = extensionKeys(engine);
    for (const k of Object.keys(extSrc)) if (!extKeys.includes(k)) warn(`${label}: "${k}" is not a ${engine} extension field; ignored.`);
    for (const [ns, val] of Object.entries(r)) if (ns !== engine && isRecord(val)) warn(`${label}: extension "${ns}" does not belong to the ${engine} engine; ignored.`);
    for (const k of PROP_KEYS) {
      const e = describe(k).engine;
      if (e && e !== engine) continue;
      const v = e ? extSrc[k] : r[k];
      if (v === undefined) continue;
      if (typeof v === typeof PROPS[k].default && !(typeof v === 'number' && !Number.isFinite(v))) props[k] = v;
      else warn(`${label}: invalid value for "${k}"; using the default.`);
    }
    if (r.depth === undefined) props.depth = i; // default depth = list order
    let anchor: Anchor | null = null;
    if (r.anchor !== undefined && r.anchor !== null) {
      if (ANCHORS.includes(r.anchor as Anchor)) anchor = r.anchor as Anchor;
      else warn(`${label}: unknown anchor ${JSON.stringify(r.anchor)}; using none.`);
    }
    const meta = { id: r.id, name: r.name, anchor, interactive: r.interactive === true };
    if (!isIdentifier(r.name)) warn(`${label} is not a valid code identifier (letters, digits, _ and $; no spaces, not starting with a digit).`);
    let obj: SceneObject;
    if (r.kind === 'sprite') {
      if (typeof r.asset !== 'string' || !r.asset) return err(`${label}: sprite has no "asset"; skipped.`);
      if (/^([a-zA-Z]:|[\/])/.test(r.asset) || r.asset.split(/[\/]/).includes('..')) {
        warn(`${label}: asset path should be relative to the project folder (${r.asset}).`);
      }
      obj = { ...meta, kind: 'sprite', asset: r.asset, ...props as ObjectProps };
    } else {
      if (!SHAPES.includes(r.shape as Shape)) return err(`${label}: unknown shape ${JSON.stringify(r.shape)}; skipped.`);
      obj = { ...meta, kind: 'primitive', shape: r.shape as Shape, ...props as ObjectProps };
    }
    if (names.has(r.name.toLowerCase())) warn(`Duplicate name ${label}; names should be unique.`);
    ids.add(r.id);
    names.add(r.name.toLowerCase());
    doc.objects.push(obj);
  });

  return { doc, problems, fatal: false };
}
