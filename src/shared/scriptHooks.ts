// Which project files look like PHASEFORM scripts: modules that export a `create` or `update` hook. A plain text check, so no
// project code is ever run. Used by the Inspector's script picker to leave out sources, tests and tools.

/** One script file as the picker sees it. */
export interface ScriptFile {
  /** Project-relative, forward slashes: the path a scene stores. */
  path: string;
  /** Exports a hook, or sits in a `scripts` folder (a new script may not have its hooks yet). */
  candidate: boolean;
}

const PATTERNS = [
  /\bexport\s+(?:async\s+)?function\s*\*?\s*(?:create|update)\b/,
  /\bexport\s+(?:const|let|var)\s+(?:create|update)\b/,
  /\bexport\s*\{[^}]*\b(?:create|update)\b[^}]*\}/,
  /\bexport\s+default\s*\{[^}]*\b(?:create|update)\b/,
];

/** True when the source exports a `create` or `update` hook. */
export const exportsHook = (source: string): boolean => PATTERNS.some(p => p.test(source));

/** A file inside a folder named `scripts`, at any depth. */
export const inScriptsFolder = (path: string): boolean => /(^|\/)scripts\//.test(path);

/** Files to offer, filtered by `query` (case-insensitive, matched on the whole path) and not already `attached`. Without `showAll`, only candidates. */
export function pickableScripts(files: readonly ScriptFile[], attached: readonly string[], query: string, showAll: boolean): ScriptFile[] {
  const q = query.trim().toLowerCase();
  return files.filter(f => (showAll || f.candidate) && !attached.includes(f.path) && (q === '' || f.path.toLowerCase().includes(q)));
}
