import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PROJECT_DIR, EDITOR_FILE } from '../shared/layout';
import { AUDIO_EXTS, DATA_EXTS, IMAGE_EXTS as IMPORT_IMAGE_EXTS, ASSET_FOLDER_CANDIDATES, cleanFileName, cleanSubfolder, detectAssetsFolder, importKind, uniqueFileName, type ImportKind } from '../shared/assetImport';

const IS_WIN = process.platform === 'win32';
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const DEV_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/;
const DEV_SERVER_TIMEOUT_MS = 30000;
const BRIDGE_FILES = ['phaser-forge-bridge.js', 'phaser-forge-bridge.d.ts'];

const PF_PROJECT_FILE = 'phaseform.project.json';
const PF_SCENE_SUFFIX = '.phaseform.json';

const SCRIPT_NAME_RE = /^[\w:.-]+$/;

// Packaged builds take the icon from electron-builder (build/icon.png); this covers dev runs.
const APP_ICON = path.join(app.getAppPath(), 'build', 'icon.png');

let mainWin: BrowserWindow | null = null;
let devProc: ChildProcess | null = null;
/** Canonical (realpath) folders the user picked via `dialog:openFolder`; every path IPC is confined to them. A cancelled
 * setup dialog must not lock the project that is still open, so earlier picks stay valid. */
const openedRoots = new Set<string>();

const isInside = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel));
};

/**
 * Canonicalises `p` (following symlinks, also for not-yet-existing paths via their nearest existing
 * ancestor) and returns it only if it lies inside the opened folder; otherwise null.
 */
function guardPath(p: unknown): string | null {
  if (openedRoots.size === 0 || typeof p !== 'string' || !p || p.includes('\0')) return null;
  let resolved = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      resolved = path.join(fs.realpathSync.native(resolved), ...rest);
      break;
    } catch {
      // Something exists here but can't be resolved (a dangling symlink/junction): writing through it would escape.
      try { fs.lstatSync(resolved); return null; } catch { /* genuinely missing: fall through to the parent */ }
      const parent = path.dirname(resolved);
      if (parent === resolved) return null;
      rest.unshift(path.basename(resolved));
      resolved = parent;
    }
  }
  return [...openedRoots].some(root => isInside(root, resolved)) ? resolved : null;
}

/** Guarded folder argument: must exist, be a directory, and be inside the opened folder. */
function guardFolder(folder: unknown): string | null {
  const dir = guardPath(folder);
  try { return dir && fs.statSync(dir).isDirectory() ? dir : null; } catch { return null; }
}

/** `name` inside a guarded folder, re-checked so a symlinked file can't point outside. */
const guardFile = (folder: unknown, name: string) => {
  const dir = guardFolder(folder);
  return dir ? guardPath(path.join(dir, name)) : null;
};

/** Polling watcher for the open PHASEFORM files. Polling (not fs.watch) because editors and git replace files, which fs.watch handles badly. */
const WATCH_POLL_MS = 1000;
type Watched = { file: string; sig: string };
let fileWatch: { files: Map<string, Watched>; timer: NodeJS.Timeout } | null = null;
const fileSig = (file: string) => {
  try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return 'missing'; }
};
function stopFileWatch() {
  if (fileWatch) clearInterval(fileWatch.timer);
  fileWatch = null;
}
function startFileWatch(files: Map<string, Watched>) {
  stopFileWatch();
  if (files.size === 0) return;
  fileWatch = { files, timer: setInterval(() => {
    for (const [rel, w] of files) {
      const sig = fileSig(w.file);
      if (sig === w.sig) continue;
      w.sig = sig;
      if (sig !== 'missing') sendToRenderer('pf:changed', rel);
    }
  }, WATCH_POLL_MS) };
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const toPosix = (p: string) => p.replace(/\\/g, '/');
const sendToRenderer = (channel: string, ...args: unknown[]) => mainWin?.webContents.send(channel, ...args);

function readJson(file: string) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null;
  } catch {
    return null;
  }
}

/** Atomic write: temp file + rename, keeping the previous good file as <file>.bak. Never leaves a half-written file. */
function writeText(file: string, text: string): { ok: boolean; error?: string } {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text);
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: (e as Error).message };
  }
}

const writeJson = (file: string, data: unknown) => writeText(file, JSON.stringify(data, null, 2));

// `npm run` goes through a shell, so killing the child alone would orphan the dev server.
function stopDevServer() {
  const proc = devProc;
  devProc = null;
  if (!proc?.pid || proc.exitCode !== null) return;
  if (IS_WIN) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']).on('error', () => {});
  else try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill(); }
}

/** The local `<script type="module" src>` in index.html, i.e. where the bridge should be installed. */
function findEntryScript(folder: string): string | null {
  const indexFile = guardPath(path.join(folder, 'index.html'));
  if (!indexFile) return null;
  let html: string;
  try { html = fs.readFileSync(indexFile, 'utf-8'); } catch { return null; }
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!/\btype\s*=\s*["']module["']/i.test(tag) || !src || /^[a-z]+:/i.test(src)) continue;
    const file = guardPath(path.join(folder, src.replace(/^\//, '')));
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

function scanAssets(dir: string, base: string): unknown[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const results: unknown[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      const children = scanAssets(fullPath, base);
      if (children.length > 0) results.push({ name: entry.name, type: 'folder', path: relPath, children });
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTS.includes(ext)) results.push({ name: entry.name, type: 'file', path: relPath, fullPath, ext });
    }
  }
  return results;
}

function createWindow(): void {
  mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false, // lets the file:// renderer embed the localhost game iframe
    },
    title: 'Scenecaster',
    icon: APP_ICON,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
  });

  if (process.env['ELECTRON_RENDERER_URL']) mainWin.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
}

const hasPackage = (dir: string) => fs.existsSync(path.join(dir, 'package.json'));

/** package.json folders below `dir` (breadth first, shallow, skipping dependency and dot folders), nearest first. */
function findProjectsBelow(dir: string, maxDepth = 3): string[] {
  const found: string[] = [];
  let level = [dir];
  for (let depth = 0; depth < maxDepth && found.length < 8; depth++) {
    const next: string[] = [];
    for (const d of level) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const sub = path.join(d, e.name);
        (hasPackage(sub) ? found : next).push(sub);
      }
    }
    level = next;
  }
  return found;
}

function findProjectAbove(dir: string): string | null {
  for (let d = path.dirname(dir); d !== path.dirname(d); d = path.dirname(d)) if (hasPackage(d)) return d;
  return null;
}

/** Remembered choices live in userData/settings.json: the last project, and which project root each picked folder resolved to. */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings(): { lastRoot?: string; roots?: Record<string, string> } {
  const s = readJson(settingsFile());
  return s && typeof s === 'object' ? s : {};
}
function rememberRoot(picked: string, root: string) {
  const s = readSettings();
  writeJson(settingsFile(), { lastRoot: root, roots: { ...s.roots, [picked]: root } });
}

/** The folder the editor should open for `picked`: itself if it has a package.json, a remembered choice, or the user's pick among nearby projects. */
async function resolveProjectRoot(picked: string): Promise<string> {
  if (hasPackage(picked)) return picked;
  const remembered = readSettings().roots?.[picked];
  if (remembered && hasPackage(remembered) && isInside(picked, remembered)) return remembered;
  const above = findProjectAbove(picked);
  const below = findProjectsBelow(picked);
  const candidates = below.length ? below : above ? [above] : [];
  if (candidates.length === 0) return picked;
  const shown = candidates.slice(0, 6);
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'Choose the project folder',
    message: 'No package.json in the selected folder.',
    detail: `Scenecaster works on the folder that holds package.json. Found:\n${shown.join('\n')}`,
    buttons: [...shown.map(d => path.relative(path.dirname(picked), d) || d), 'Use the selected folder'],
    cancelId: shown.length,
    defaultId: 0,
    noLink: true,
  });
  return shown[choice.response] ?? picked;
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Phaser Project Folder',
      defaultPath: readSettings().lastRoot,
    });
    const picked = result.canceled ? null : result.filePaths[0] ?? null;
    if (!picked) return null;
    const root = await resolveProjectRoot(picked);
    try {
      openedRoots.add(fs.realpathSync.native(root));
    } catch {
      return null;
    }
    rememberRoot(picked, root);
    // Return the path as chosen: realpath turns a mapped drive into a UNC path, which cmd.exe rejects as a cwd.
    return root;
  });

  ipcMain.handle('dialog:unsaved', async (_e, message: unknown) => {
    const r = await dialog.showMessageBox(mainWin!, {
      type: 'warning', title: 'Unsaved changes', message: String(message),
      buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
    });
    return (['save', 'discard', 'cancel'] as const)[r.response];
  });

  ipcMain.handle('devserver:start', (_e, folder: unknown, script?: unknown) => {
    // The checked folder is canonical (possibly UNC); run in the path the user gave, which passed the same check.
    const cwd = guardFolder(folder) ? path.resolve(String(folder)) : null;
    if (!cwd) return { ok: false, error: 'Folder is not inside the opened project.' };
    const runScript = (typeof script === 'string' ? script.trim() : '') || 'dev';
    // The name reaches a shell on Windows, so it must be a plain script key declared by the project.
    const pkgFile = guardPath(path.join(cwd, 'package.json'));
    const scripts = (pkgFile && readJson(pkgFile)?.scripts) || {};
    if (!SCRIPT_NAME_RE.test(runScript) || typeof scripts !== 'object' || !Object.hasOwn(scripts, runScript)) {
      return { ok: false, error: `Unknown or invalid script "${runScript}" (not in package.json scripts).` };
    }
    stopDevServer();

    return new Promise<{ ok: boolean; url?: string; error?: string }>(resolve => {
      let settled = false;
      const settle = (result: { ok: boolean; url?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(
        () => settle({ ok: false, error: `Timeout (${DEV_SERVER_TIMEOUT_MS / 1000}s) — dev server URL not detected.` }),
        DEV_SERVER_TIMEOUT_MS,
      );

      sendToRenderer('devserver:output', `[Running: npm run ${runScript}]\n`);
      // `npm` is a .cmd shim on Windows and needs a shell; runScript is allowlisted + charset-checked above.
      const proc = spawn('npm', ['run', runScript], { cwd, shell: IS_WIN, detached: !IS_WIN });
      devProc = proc;

      const onData = (data: Buffer) => {
        const text = stripAnsi(data.toString());
        sendToRenderer('devserver:output', text);
        const url = text.match(DEV_URL_RE)?.[0];
        if (url) settle({ ok: true, url });
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('error', err => settle({ ok: false, error: err.message }));
      proc.on('exit', code => {
        settle({ ok: false, error: `Dev server exited (code ${code}) before a URL was detected.` });
        // A restart replaces devProc; only report the stop if this is still the active server.
        if (devProc !== proc) return;
        devProc = null;
        sendToRenderer('devserver:output', `\n[Dev server exited — code ${code}]\n`);
        sendToRenderer('devserver:stopped');
      });
    });
  });

  ipcMain.handle('devserver:stop', () => {
    stopDevServer();
    return { ok: true };
  });

  ipcMain.handle('vscode:open', (_e, rawFolder: unknown) => {
    const folder = guardFolder(rawFolder) ? path.resolve(String(rawFolder)) : null;
    if (!folder) return;
    // `code` is a .cmd shim on Windows and needs a shell; quotes are safe there since paths can't contain them.
    spawn('code', [IS_WIN ? `"${folder}"` : folder], { shell: IS_WIN, detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref();
  });

  // Only the local dev server URL the editor itself started may be opened.
  ipcMain.handle('shell:openLocal', (_e, rawUrl: unknown) => {
    try {
      const u = new URL(String(rawUrl));
      if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return;
      shell.openExternal(u.href);
    } catch { /* invalid URL */ }
  });

  ipcMain.handle('bridge:install', (_e, rawFolder: unknown) => {
    const folder = guardFolder(rawFolder);
    if (!folder) return { ok: false, error: 'Folder is not inside the opened project.' };
    const targets = BRIDGE_FILES.map(file => guardPath(path.join(folder, file)));
    if (targets.some(t => !t)) return { ok: false, error: 'Bridge target escapes the opened project.' };
    const sourceDir = [
      path.join(app.getAppPath(), 'src', 'bridge'),
      path.join(process.resourcesPath, 'bridge'),
    ].find(dir => fs.existsSync(path.join(dir, BRIDGE_FILES[0])));
    if (!sourceDir) return { ok: false, error: 'Bridge SDK source file not found.' };
    try {
      BRIDGE_FILES.forEach((file, i) => fs.copyFileSync(path.join(sourceDir, file), targets[i]!));
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const entry = findEntryScript(folder);
    if (!entry) return { ok: true };
    const importPath = toPosix(path.relative(path.dirname(entry), path.join(folder, BRIDGE_FILES[0])));
    return { ok: true, entry: toPosix(path.relative(folder, entry)), importPath: importPath.startsWith('.') ? importPath : `./${importPath}` };
  });

  /** The project's assets folder, found among public/assets, assets and public (symlinks that leave the project do not count). */
  const assetsInfo = (folder: string) => detectAssetsFolder(rel => guardFolder(path.join(folder, ...rel.split('/'))) !== null);

  ipcMain.handle('assets:info', (_e, rawFolder: unknown) => {
    const folder = guardFolder(rawFolder);
    return folder ? assetsInfo(folder) : null;
  });

  /** Which of these project-relative files are not on disk (a path that leaves the project counts as missing). */
  ipcMain.handle('assets:missing', (_e, rawFolder: unknown, rawPaths: unknown): string[] => {
    const folder = guardFolder(rawFolder);
    if (!folder || !Array.isArray(rawPaths)) return [];
    const missing: string[] = [];
    for (const p of rawPaths.slice(0, 5000)) {
      if (typeof p !== 'string') continue;
      const parts = p.split('/');
      const safe = !p.includes('\0') && !p.includes('\\') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !parts.some(s => s === '' || s === '.' || s === '..');
      const target = safe ? guardPath(path.join(folder, ...parts)) : null;
      if (!target || !fs.existsSync(target)) missing.push(p);
    }
    return missing;
  });

  ipcMain.handle('fs:readAssets', (_e, rawFolder: unknown) => {
    const folder = guardFolder(rawFolder);
    if (!folder) return [];
    const info = assetsInfo(folder);
    // A candidate folder that exists but escapes the project (a link) means no assets, not a scan of the whole project.
    if (!info.exists && ASSET_FOLDER_CANDIDATES.some(c => fs.existsSync(path.join(folder, ...c.split('/'))))) return [];
    const root = info.exists ? path.join(folder, ...info.dir.split('/')) : folder;
    return scanAssets(root, root);
  });

  /** The file picker for importing. The paths come from the system dialog, run here, not from the page. */
  ipcMain.handle('assets:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Import assets into the project',
      filters: [
        { name: 'Images and audio', extensions: [...IMPORT_IMAGE_EXTS, ...AUDIO_EXTS].map(e => e.slice(1)) },
        { name: 'Atlas and font data', extensions: DATA_EXTS.map(e => e.slice(1)) },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  const MAX_IMPORT_FILES = 200;
  const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
  type ImportResult = { name: string; kind?: ImportKind; rel?: string; error?: string };

  /** Copies files into a project subfolder, never overwriting: a name that is taken gets -2, -3... The page cannot choose a destination outside the project. */
  ipcMain.handle('assets:import', (_e, rawFolder: unknown, rawDest: unknown, rawSources: unknown): { ok: boolean; error?: string; results?: ImportResult[] } => {
    const folder = guardFolder(rawFolder);
    const sub = typeof rawDest === 'string' ? cleanSubfolder(rawDest) : null;
    if (!folder || !sub || !Array.isArray(rawSources)) return BAD_PATH;
    const dest = guardPath(path.join(folder, ...sub.split('/')));
    if (!dest) return BAD_PATH;
    try { fs.mkdirSync(dest, { recursive: true }); } catch (e) { return { ok: false, error: `Cannot create ${sub}: ${(e as Error).message}` }; }
    const taken = new Set(fs.readdirSync(dest));
    const results: ImportResult[] = [];
    for (const src of rawSources.slice(0, MAX_IMPORT_FILES)) {
      const base = typeof src === 'string' ? path.basename(src) : '?';
      const fail = (error: string) => results.push({ name: base, error });
      if (typeof src !== 'string' || !path.isAbsolute(src) || src.includes('\0')) { fail('Not a file path.'); continue; }
      const kind = importKind(base);
      if (!kind) { fail('Not an image, audio or data file.'); continue; }
      try {
        const st = fs.statSync(src);
        if (!st.isFile()) { fail('Not a file.'); continue; }
        if (st.size > MAX_IMPORT_BYTES) { fail('Larger than 200 MB.'); continue; }
        const name = uniqueFileName(cleanFileName(base), taken);
        const target = path.join(dest, name);
        fs.copyFileSync(src, target, fs.constants.COPYFILE_EXCL);
        taken.add(name);
        results.push({ name, kind, rel: toPosix(path.relative(folder, target)) });
      } catch (e) { fail((e as Error).message); }
    }
    return { ok: true, results };
  });

  /** Names the FileSystem panel never shows: VCS and tool folders, build output, dependency folders and dot-files. */
  const HIDDEN_DIRS = new Set(['node_modules', 'dist', 'out', 'release', 'build', 'coverage']);
  const hidden = (name: string, isDir: boolean) => name.startsWith('.') || (isDir && HIDDEN_DIRS.has(name));
  const MAX_LIST = 3000;

  /** One level of a folder, folders first, for the lazy FileSystem tree. Symlinks that leave the project are skipped. */
  ipcMain.handle('fs:listDir', (_e, rawDir: unknown) => {
    const dir = guardFolder(rawDir);
    if (!dir) return null; // outside the opened project, or not a folder: distinct from an empty folder
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    const out: { name: string; type: 'folder' | 'file'; path: string; ext: string }[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        const real = guardPath(full);
        if (!real) continue;
        try { isDir = fs.statSync(real).isDirectory(); } catch { continue; }
      }
      if (hidden(entry.name, isDir)) continue;
      out.push({ name: entry.name, type: isDir ? 'folder' : 'file', path: full, ext: isDir ? '' : path.extname(entry.name).toLowerCase() });
      if (out.length >= MAX_LIST) break;
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    return [...out.filter(e => e.type === 'folder').sort(byName), ...out.filter(e => e.type === 'file').sort(byName)];
  });

  /** Files and folders whose name contains `query`, searched through the whole project (bounded). */
  ipcMain.handle('fs:findFiles', (_e, rawDir: unknown, rawQuery: unknown) => {
    const root = guardFolder(rawDir);
    const query = typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : '';
    if (!root || !query) return [];
    const found: { name: string; type: 'folder' | 'file'; path: string; ext: string }[] = [];
    let visited = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > 10 || found.length >= 500 || visited > 20000) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        visited++;
        const isDir = entry.isDirectory();
        if (entry.isSymbolicLink() || hidden(entry.name, isDir)) continue;
        const full = path.join(dir, entry.name);
        if (entry.name.toLowerCase().includes(query)) found.push({ name: entry.name, type: isDir ? 'folder' : 'file', path: full, ext: isDir ? '' : path.extname(entry.name).toLowerCase() });
        if (isDir) walk(full, depth + 1);
      }
    };
    walk(root, 0);
    return found;
  });

  ipcMain.handle('shell:showItem', (_e, rawPath: unknown) => {
    const target = guardPath(rawPath);
    if (target) shell.showItemInFolder(target);
  });

  ipcMain.handle('fs:fileToDataUrl', (_e, rawPath: unknown) => {
    const fullPath = guardPath(rawPath);
    if (!fullPath || !IMAGE_EXTS.includes(path.extname(fullPath).toLowerCase())) return null;
    try {
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return `data:${mime};base64,${fs.readFileSync(fullPath).toString('base64')}`;
    } catch {
      return null;
    }
  });

  /**
   * A project-relative path (forward slashes) to a PHASEFORM file, resolved and guarded. The name must end in
   * `.phaseform.json` (or, with `allowProject`, be `phaseform.project.json`); absolute paths, drive letters,
   * `.`/`..`/empty segments, backslashes and NUL are rejected, then the result must pass guardPath (symlink safe).
   */
  const pfFile = (folder: unknown, relPath: unknown, allowProject = false): { rel: string; file: string } | null => {
    const dir = guardFolder(folder);
    if (!dir || typeof relPath !== 'string' || !relPath) return null;
    if (relPath.includes('\0') || relPath.includes('\\') || relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) return null;
    if (relPath.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
    if (!(relPath.endsWith(PF_SCENE_SUFFIX) || (allowProject && relPath === PF_PROJECT_FILE))) return null;
    const file = guardPath(path.join(dir, ...relPath.split('/')));
    return file ? { rel: relPath, file } : null;
  };
  const BAD_PATH = { ok: false, error: 'Invalid folder or file path.' };

  // The renderer parses and formats the text; main only checks it is JSON (on write) and writes atomically.
  const pfRead = (target: { file: string } | null) => {
    if (!target) return BAD_PATH;
    if (!fs.existsSync(target.file)) return { ok: true, found: false };
    try { return { ok: true, found: true, text: fs.readFileSync(target.file, 'utf-8') }; }
    catch (e) { return { ok: false, error: `Cannot read file: ${(e as Error).message}` }; }
  };
  const pfWrite = (target: { rel: string; file: string } | null, text: unknown) => {
    if (!target || typeof text !== 'string') return BAD_PATH;
    try { JSON.parse(text); } catch { return { ok: false, error: 'Text is not valid JSON.' }; }
    const r = writeText(target.file, text);
    // Our own write must not look like an external change.
    const w = fileWatch?.files.get(target.rel);
    if (r.ok && w && w.file === target.file) w.sig = fileSig(target.file);
    return r;
  };

  ipcMain.handle('pf:readProject', (_e, folder: unknown) => pfRead(pfFile(folder, PF_PROJECT_FILE, true)));
  ipcMain.handle('pf:writeProject', (_e, folder: unknown, text: unknown) => pfWrite(pfFile(folder, PF_PROJECT_FILE, true), text));
  ipcMain.handle('pf:readScene', (_e, folder: unknown, relPath: unknown) => pfRead(pfFile(folder, relPath)));
  ipcMain.handle('pf:writeScene', (_e, folder: unknown, relPath: unknown, text: unknown) => pfWrite(pfFile(folder, relPath), text));

  ipcMain.handle('pf:watch', (_e, folder: unknown, relPaths: unknown) => {
    const files = new Map<string, Watched>();
    if (Array.isArray(relPaths)) {
      for (const rel of relPaths) {
        const t = pfFile(folder, rel, true);
        if (t) files.set(t.rel, { file: t.file, sig: fileSig(t.file) });
      }
    }
    startFileWatch(files);
  });

  // Editor-only settings (not part of PHASEFORM) live in <folder>/scenecaster/editor.json.
  const editorFile = (folder: unknown) => {
    const dir = guardFolder(folder);
    return dir ? guardPath(path.join(dir, PROJECT_DIR, EDITOR_FILE)) : null;
  };
  ipcMain.handle('pf:readEditorSettings', (_e, folder: unknown) => {
    const file = editorFile(folder);
    const s = file ? readJson(file) : null;
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  });
  ipcMain.handle('pf:writeEditorSettings', (_e, folder: unknown, settings: unknown) => {
    const file = editorFile(folder);
    if (!file || !settings || typeof settings !== 'object' || Array.isArray(settings)) return BAD_PATH;
    // Merge into the existing file so keys this version does not know are kept.
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      const cur = readJson(file);
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return { ok: false, error: 'editor.json exists but cannot be read; not overwriting it.' };
      existing = cur;
    }
    return writeJson(file, { ...existing, ...settings });
  });

  // Dev-server scripts only: `dev`, `dev:*`, and variants like `engine:dev:fantasy`.
  // Names devserver:start would reject (bad charset) are not offered.
  ipcMain.handle('project:readScripts', (_e, folder: unknown) => {
    const file = guardFile(folder, 'package.json');
    const scripts = (file && readJson(file)?.scripts) || {};
    if (typeof scripts !== 'object') return [];
    return Object.keys(scripts).filter(n =>
      SCRIPT_NAME_RE.test(n) && (n === 'dev' || n.startsWith('dev:') || /:dev(:|$)/.test(n)));
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { stopFileWatch(); stopDevServer(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
