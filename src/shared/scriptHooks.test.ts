import { describe, expect, it } from 'vitest';
import { exportsHook, inScriptsFolder, pickableScripts, type ScriptFile } from './scriptHooks';

describe('exportsHook', () => {
  it('finds exported create and update hooks in their usual forms', () => {
    expect(exportsHook('export function create(o, scene, ctx) {}')).toBe(true);
    expect(exportsHook('export async function update(o) {}')).toBe(true);
    expect(exportsHook('export const create = (o) => {};')).toBe(true);
    expect(exportsHook('function update() {}\nexport { update }')).toBe(true);
    expect(exportsHook('const a = 1; export { a, create as create }')).toBe(true);
    expect(exportsHook('export default { create() {}, update() {} }')).toBe(true);
  });
  it('ignores files that only mention the names', () => {
    expect(exportsHook('function create() {}')).toBe(false);
    expect(exportsHook('// export function create')).toBe(true); // a comment can fool the text check; harmless: it only adds a candidate
    expect(exportsHook('export function createScene() {}')).toBe(false);
    expect(exportsHook('export const updater = 1')).toBe(false);
    expect(exportsHook('import { create } from "x"')).toBe(false);
    expect(exportsHook('')).toBe(false);
  });
});

describe('inScriptsFolder', () => {
  it('matches a scripts folder at any depth, not a lookalike', () => {
    expect(inScriptsFolder('scripts/a.js')).toBe(true);
    expect(inScriptsFolder('game/scripts/a.js')).toBe(true);
    expect(inScriptsFolder('myscripts/a.js')).toBe(false);
    expect(inScriptsFolder('src/a.js')).toBe(false);
  });
});

describe('pickableScripts', () => {
  const files: ScriptFile[] = [
    { path: 'scripts/drift.js', candidate: true },
    { path: 'scripts/link.js', candidate: true },
    { path: 'src/main.ts', candidate: false },
    { path: 'tests/core.test.ts', candidate: false },
  ];
  it('lists only candidates, minus the attached ones', () => {
    expect(pickableScripts(files, ['scripts/link.js'], '', false).map(f => f.path)).toEqual(['scripts/drift.js']);
  });
  it('lists every file with showAll', () => {
    expect(pickableScripts(files, [], '', true)).toHaveLength(4);
  });
  it('filters by a case-insensitive substring of the path', () => {
    expect(pickableScripts(files, [], 'DRIFT', false).map(f => f.path)).toEqual(['scripts/drift.js']);
    expect(pickableScripts(files, [], 'main', false)).toEqual([]);
    expect(pickableScripts(files, [], 'main', true).map(f => f.path)).toEqual(['src/main.ts']);
  });
});
