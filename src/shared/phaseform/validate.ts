// Validation of PHASEFORM scene and project documents: the JSON Schemas plus the rules the schemas cannot express
// (ported from the reference CLI's check-scene and check-project). Never throws; always returns problems.
import Ajv2020 from 'ajv/dist/2020';
import sceneSchema from './schema/phaseform.schema.json';
import projectSchema from './schema/phaseform.project.schema.json';
import type { PfObject, PfProject, PfScene, Problem } from './types';
import { walk } from './tree';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const checkSceneSchema = ajv.compile(sceneSchema);
const checkProjectSchema = ajv.compile(projectSchema);

const TEXTURE_TYPES = new Set(['image', 'spritesheet', 'atlas', 'bitmapFont']);
const IMAGE_REF_TYPES = new Set(['image', 'spritesheet', 'atlas']);
const REF_FIELDS: Record<string, string[]> = { mask: ['source'], imageLight: ['modelRotationSource'], normalTools: ['rotationSource'] };
const MAX_SCHEMA_ERRORS = 25;

/** `/objects/3/children/1/fill` becomes `"coin" fill`, so the report names the object rather than an index. */
function describePath(path: string, scene: PfScene): string {
  const parts = path.split('/').filter(Boolean);
  let list: PfObject[] | undefined = scene.objects;
  let label = '';
  let i = 0;
  if (parts[0] === 'objects') {
    i = 1;
    while (i < parts.length && list && /^\d+$/.test(parts[i])) {
      const o: PfObject | undefined = list[Number(parts[i])];
      if (!o) break;
      label = `"${o.id}"`;
      i++;
      if (parts[i] === 'children') { list = o.children; i++; } else { list = undefined; }
    }
  }
  const rest = parts.slice(i).join('.');
  return [label, rest].filter(Boolean).join(' ') || '(scene)';
}

export function* filtersOf(o: PfObject): Generator<Record<string, unknown>> {
  function* list(l: unknown): Generator<Record<string, unknown>> {
    if (!Array.isArray(l)) return;
    for (const f of l) {
      if (!f || typeof f !== 'object') continue;
      const filter = f as Record<string, unknown>;
      yield filter;
      if (filter.type === 'parallel') { yield* list(filter.top); yield* list(filter.bottom); }
    }
  }
  const filters = o.filters as { internal?: unknown; external?: unknown } | undefined;
  if (filters) { yield* list(filters.internal); yield* list(filters.external); }
}

/** A script path must be relative to the project root: forward slashes, no drive or leading slash, no ".." segment. */
const isRelativeScriptPath = (p: string) => !p.includes('\\') && !/^([a-zA-Z]:|\/)/.test(p) && !p.split('/').includes('..');

export function validateScene(scene: unknown): Problem[] {
  const problems: Problem[] = [];
  if (!checkSceneSchema(scene)) {
    const errors = checkSceneSchema.errors ?? [];
    for (const e of errors.slice(0, MAX_SCHEMA_ERRORS)) {
      problems.push({ level: 'error', message: `${describePath(e.instancePath, scene as PfScene)}: ${e.message ?? 'invalid'}` });
    }
    if (errors.length > MAX_SCHEMA_ERRORS) problems.push({ level: 'error', message: `${errors.length - MAX_SCHEMA_ERRORS} more schema errors not shown.` });
    return problems;
  }
  const doc = scene as PfScene;
  const ids = new Set<string>();
  const entries = [...walk(doc.objects)];
  for (const { obj } of entries) {
    if (ids.has(obj.id)) problems.push({ level: 'error', message: `Duplicate id "${obj.id}".` });
    ids.add(obj.id);
  }
  const ancestorsOf = (target: PfObject) => {
    const chain: string[] = [];
    for (let p = entries.find(e => e.obj === target)?.parent ?? null; p; p = entries.find(e => e.obj === p)?.parent ?? null) chain.push(p.id);
    return chain;
  };
  // Anchors follow the game's edges, so they only make sense on root objects: a container's children follow the container.
  for (const { obj, parent } of entries) {
    if (parent && obj.anchor !== undefined) problems.push({ level: 'warning', message: `"${obj.id}": anchor is ignored on a child of "${parent.id}" (anchors apply to root objects).` });
  }
  // Scripts are paths relative to the project root, run in order; a repeat runs twice, and params do nothing without scripts.
  for (const { obj } of entries) {
    const scripts = Array.isArray(obj.scripts) ? obj.scripts.filter((s): s is string => typeof s === 'string') : [];
    for (const [i, s] of scripts.entries()) {
      if (scripts.indexOf(s) !== i) problems.push({ level: 'warning', message: `"${obj.id}": script "${s}" is attached more than once.` });
      else if (!isRelativeScriptPath(s)) problems.push({ level: 'warning', message: `"${obj.id}": script path "${s}" should be relative to the project root, with forward slashes and no "..".` });
    }
    if (obj.params !== undefined && scripts.length === 0) problems.push({ level: 'warning', message: `"${obj.id}": params are set but no script is attached to read them.` });
  }
  for (const { obj } of entries) {
    for (const f of filtersOf(obj)) {
      for (const field of REF_FIELDS[String(f.type)] ?? []) {
        const ref = f[field];
        if (ref === undefined) continue;
        if (typeof ref !== 'string' || !ids.has(ref)) problems.push({ level: 'error', message: `"${obj.id}": ${String(f.type)}.${field} refers to missing id "${String(ref)}".` });
        else if (f.type === 'mask' && (ref === obj.id || ancestorsOf(obj).includes(ref))) problems.push({ level: 'error', message: `"${obj.id}": mask source "${ref}" is the object or one of its ancestors.` });
      }
    }
  }
  return problems;
}

export function validateProject(project: unknown): Problem[] {
  if (!checkProjectSchema(project)) {
    return (checkProjectSchema.errors ?? []).slice(0, MAX_SCHEMA_ERRORS)
      .map(e => ({ level: 'error' as const, message: `Project file ${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}` }));
  }
  const p = project as PfProject;
  const problems: Problem[] = [];
  const err = (message: string) => problems.push({ level: 'error', message });
  const textures = new Set<string>(); const audio = new Set<string>();
  for (const a of p.assets) {
    const ns = TEXTURE_TYPES.has(a.type) ? textures : a.type === 'audio' ? audio : null;
    if (!ns) continue;
    if (ns.has(a.key)) err(`Duplicate ${ns === textures ? 'texture' : 'audio'} key "${a.key}".`);
    ns.add(a.key);
  }
  const keys = new Set<string>();
  for (const s of p.scenes) {
    if (keys.has(s.key)) err(`Duplicate scene key "${s.key}".`);
    keys.add(s.key);
  }
  if (!keys.has(p.entry)) err(`Entry "${p.entry}" is not a scene key.`);
  return problems;
}

/** Texture and animation references of one scene against the project's manifest. Warnings only: a scene can be edited without the file. */
export function checkSceneAgainstProject(scene: PfScene, project: PfProject, entry?: { assets?: string[] }): Problem[] {
  const warn = (message: string): Problem => ({ level: 'warning', message });
  const textures = new Map(project.assets.filter(a => TEXTURE_TYPES.has(a.type)).map(a => [a.key, a]));
  const anims = new Set((project.animations ?? []).map(a => (a as { key?: string }).key));
  const out: Problem[] = [];
  for (const { obj: o } of walk(scene.objects)) {
    if (o.animation && !anims.has((o.animation as { key?: string }).key)) out.push(warn(`"${o.id}" plays animation "${(o.animation as { key?: string }).key}" not in the project.`));
    if (o.type === 'bitmapText') {
      const f = textures.get(String(o.font));
      if (!f || f.type !== 'bitmapFont') out.push(warn(`"${o.id}" uses font "${String(o.font)}" which is not a bitmapFont in the manifest.`));
      continue;
    }
    if (o.type !== 'image' && o.type !== 'sprite' && o.type !== 'tileSprite') continue;
    const tex = textures.get(String(o.key));
    if (!tex || !IMAGE_REF_TYPES.has(tex.type)) { out.push(warn(`"${o.id}" uses texture "${String(o.key)}" which is not in the manifest.`)); continue; }
    if (entry?.assets && !entry.assets.includes(tex.key)) out.push(warn(`"${o.id}" uses texture "${tex.key}" which is not in the scene's asset list.`));
    if (o.frame !== undefined && tex.type === 'spritesheet') {
      if (typeof o.frame !== 'number') out.push(warn(`"${o.id}" uses frame name "${String(o.frame)}" on a spritesheet.`));
      else if (typeof tex.frames === 'number' && o.frame >= tex.frames) out.push(warn(`"${o.id}" frame ${o.frame} is outside 0..${tex.frames - 1}.`));
    }
  }
  return out;
}
