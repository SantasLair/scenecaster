// Rules for bringing files into a project: which files are assets, where the assets folder is, how copies are named
// and what manifest key a new file gets. Pure (no fs, no React), shared by the main process and the renderer.

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] as const;
export const AUDIO_EXTS = ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac'] as const;
/** Atlas and bitmap-font data files. They are copied but get no manifest entry on their own (they belong to an image). */
export const DATA_EXTS = ['.json', '.xml', '.fnt'] as const;

export type ImportKind = 'image' | 'audio' | 'data';

const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i).toLowerCase(); };

/** What kind of asset a file name is, or null if it is not importable. */
export function importKind(name: string): ImportKind | null {
  const ext = extOf(name);
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) return 'image';
  if ((AUDIO_EXTS as readonly string[]).includes(ext)) return 'audio';
  if ((DATA_EXTS as readonly string[]).includes(ext)) return 'data';
  return null;
}

/** Candidates in order of preference. Vite serves `public/` from the site root, so `public/assets` comes first. */
export const ASSET_FOLDER_CANDIDATES = ['public/assets', 'assets', 'public'] as const;

/** The project's assets folder (relative, forward slashes): the first candidate that exists, else `assets` as the place to create. */
export function detectAssetsFolder(isDir: (rel: string) => boolean): { dir: string; exists: boolean } {
  for (const c of ASSET_FOLDER_CANDIDATES) if (isDir(c)) return { dir: c, exists: true };
  return { dir: 'assets', exists: false };
}

/** A safe file name for a copy: no path parts, no characters Windows rejects. */
export const cleanFileName = (name: string): string =>
  name.split(/[\\/]/).pop()!.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() || 'file';

/** `name`, or `name-2.ext`, `name-3.ext`... the first one not in `taken` (compared ignoring case, as Windows does). */
export function uniqueFileName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(t => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) if (!used.has(`${stem}-${i}${ext}`.toLowerCase())) return `${stem}-${i}${ext}`;
}

/** A manifest key from a file name: the stem with word characters only, made unique with `_2`, `_3`... */
export function suggestKey(fileName: string, takenKeys: Iterable<string>, fallback = 'asset'): string {
  const used = new Set(takenKeys);
  const stem = cleanFileName(fileName).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i++) if (!used.has(`${stem}_${i}`)) return `${stem}_${i}`;
}

/** A project-relative folder from user input: forward slashes, no empty, `.` or `..` parts. Null if it escapes or is absolute. */
export function cleanSubfolder(input: string): string | null {
  const parts = input.replace(/\\/g, '/').split('/').filter(p => p !== '' && p !== '.');
  if (parts.some(p => p === '..' || /^[A-Za-z]:$/.test(p) || /[<>:"|?*\u0000-\u001f]/.test(p))) return null;
  return parts.join('/');
}
