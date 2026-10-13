// The scene file format and its validation. Pure functions, no I/O.
// One object per line keeps diffs small and lets an AI edit the file safely.
import { PROPS, PROP_KEYS, PROP_DEFAULTS, type ObjectProps } from './props';
import type { SceneObject, Shape } from './protocol';

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
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Keys in a fixed order so saving an unchanged scene never produces a diff. */
function orderObject(o: SceneObject): Record<string, unknown> {
  const out: Record<string, unknown> = { id: o.id, name: o.name, kind: o.kind, parentId: o.parentId };
  if (o.kind === 'sprite') out.asset = o.asset; else out.shape = o.shape;
  for (const k of PROP_KEYS) out[k] = o[k];
  return out;
}

export function formatScene(doc: SceneDoc): string {
  const head = `  "version": ${doc.version},\n  "key": ${JSON.stringify(doc.key)},\n  "overlay": ${doc.overlay},\n`;
  const body = doc.objects.length
    ? `  "objects": [\n${doc.objects.map(o => '    ' + JSON.stringify(orderObject(o))).join(',\n')}\n  ]\n`
    : '  "objects": []\n';
  return `{\n${head}${body}}\n`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Never throws. Bad objects are skipped and reported; missing props take defaults. */
/** `fatal`: the file could not be understood at all; the returned doc is empty and must never be saved over the file. */
export function parseScene(raw: unknown, expectedKey: string): { doc: SceneDoc; problems: SceneProblem[]; fatal: boolean } {
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
    for (const k of PROP_KEYS) {
      if (r[k] === undefined) continue;
      if (typeof r[k] === typeof PROPS[k].default && !(typeof r[k] === 'number' && !Number.isFinite(r[k]))) props[k] = r[k];
      else warn(`${label}: invalid value for "${k}"; using the default.`);
    }
    const meta = { id: r.id, name: r.name, parentId: typeof r.parentId === 'string' ? r.parentId : null };
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

  for (const o of doc.objects) {
    if (o.parentId && !ids.has(o.parentId)) warn(`"${o.name}": parentId ${o.parentId} does not exist.`);
  }
  return { doc, problems, fatal: false };
}
