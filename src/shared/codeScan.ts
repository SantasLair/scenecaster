// Reads a Phaser game's source text and reports what it can see about scenes and asset loads. Pure (no fs, no React),
// plain pattern matching, never a rewrite: the editor does not change game code. It only reports what is literal in the
// code. Computed values (template strings, variables, loops) are counted as "dynamic" instead of being guessed at.

export interface SourceFile { path: string; text: string }

export interface SceneClass {
  className: string;
  /** The Phaser scene key from `super('key')` or `super({ key: 'key' })`; null if it is computed or not found. */
  key: string | null;
  path: string;
  line: number;
}

export interface AssetLoad {
  /** `image`, `spritesheet`, `atlas`, `audio`, ... : the method after `.load.` */
  method: string;
  /** The key and file when both are string literals. */
  key: string | null;
  url: string | null;
  path: string;
  line: number;
  /** True when the key or the file is computed, so the manifest cannot list it from code. */
  dynamic: boolean;
}

export interface GameConfig {
  path: string;
  /** Class names from `scene: [A, B]`, in order. */
  sceneClasses: string[];
  width: number | null;
  height: number | null;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Removes comments so commented-out code is not reported; string contents are kept. Line numbers are preserved. */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const STRING = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/;

/** The text of a plain string literal (a template string only if it has no `${}`), or null. */
export function literal(expr: string | undefined): string | null {
  const m = expr === undefined ? null : STRING.exec(expr);
  if (!m) return null;
  return m[1] === '`' && m[2].includes('${') ? null : m[2];
}

/** Splits the top-level arguments of a call starting at `open` (the index of "("); null if it never closes. */
function callArgs(text: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0, start = open + 1, quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(text.slice(start, i)); return args; }
    } else if (c === ',' && depth === 1) { args.push(text.slice(start, i)); start = i + 1; }
  }
  return null;
}

/** Scene classes (`class X extends Phaser.Scene` or `extends Scene`) and their keys. */
export function scanSceneClasses(files: SourceFile[]): SceneClass[] {
  const out: SceneClass[] = [];
  for (const f of files) {
    const text = stripComments(f.text);
    const re = /\bclass\s+(\w+)\s+extends\s+(?:Phaser\.)?Scene\b/g;
    for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
      const body = text.slice(m.index);
      const sup = /\bsuper\s*\(/.exec(body);
      let key: string | null = null;
      if (sup) {
        const args = callArgs(body, sup.index + sup[0].length - 1);
        const first = args?.[0]?.trim();
        if (first) {
          key = literal(first);
          if (key === null && first.startsWith('{')) {
            const k = /\bkey\s*:\s*(['"`][^'"`]*['"`])/.exec(first);
            key = k ? literal(k[1]) : null;
          }
        }
      }
      out.push({ className: m[1], key, path: f.path, line: lineOf(text, m.index) });
    }
  }
  return out;
}

const LOAD_METHODS = ['image', 'spritesheet', 'atlas', 'multiatlas', 'audio', 'audioSprite', 'bitmapFont', 'tilemapTiledJSON', 'json', 'xml', 'svg', 'video', 'script', 'text', 'glsl', 'html'];

/** `this.load.image('key', 'path')` style calls. A call with a computed key or file is reported as dynamic. */
export function scanAssetLoads(files: SourceFile[]): AssetLoad[] {
  const out: AssetLoad[] = [];
  for (const f of files) {
    const text = stripComments(f.text);
    const re = new RegExp(`\\.load\\.(${LOAD_METHODS.join('|')})\\s*\\(`, 'g');
    for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
      const args = callArgs(text, m.index + m[0].length - 1);
      const key = literal(args?.[0]);
      const url = literal(args?.[1]);
      out.push({ method: m[1], key, url, path: f.path, line: lineOf(text, m.index), dynamic: key === null || url === null });
    }
  }
  return out;
}

/**
 * The `new Phaser.Game({...})` config: its scene list and canvas size, where they are literal. A project can hold several
 * (a dev preview tool next to the real game), so the one with the most scenes wins; the first one on a tie.
 */
export function scanGameConfig(files: SourceFile[]): GameConfig | null {
  let best: GameConfig | null = null;
  for (const f of files) {
    const text = stripComments(f.text);
    const re = /new\s+(?:Phaser\.)?Game\s*\(/g;
    for (let g: RegExpExecArray | null; (g = re.exec(text)); ) {
      const config = callArgs(text, g.index + g[0].length - 1)?.[0] ?? '';
      const list = /\bscene\s*:\s*\[([^\]]*)\]/.exec(config);
      const single = list ? null : /\bscene\s*:\s*(\w+)\s*[,}\s]/.exec(config);
      const sceneClasses = (list ? list[1].split(',') : single ? [single[1]] : []).map(s => s.trim()).filter(s => /^\w+$/.test(s));
      const num = (name: string) => { const m = new RegExp(`\\b${name}\\s*:\\s*(\\d+)\\s*[,}\\s]`).exec(config); return m ? Number(m[1]) : null; };
      if (!best || sceneClasses.length > best.sceneClasses.length) best = { path: f.path, sceneClasses, width: num('width'), height: num('height') };
    }
  }
  return best;
}
