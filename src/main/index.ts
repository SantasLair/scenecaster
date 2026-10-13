import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

const IS_WIN = process.platform === 'win32';
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const DEV_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/;
const DEV_SERVER_TIMEOUT_MS = 30000;
const BRIDGE_FILES = ['phaser-forge-bridge.js', 'phaser-forge-bridge.d.ts'];

const SCRIPT_NAME_RE = /^[\w:.-]+$/;

let mainWin: BrowserWindow | null = null;
let devProc: ChildProcess | null = null;
/** Canonical (realpath) folder the user picked via `dialog:openFolder`; every path IPC is confined to it. */
let openedFolder: string | null = null;

const isInside = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel));
};

/**
 * Canonicalises `p` (following symlinks, also for not-yet-existing paths via their nearest existing
 * ancestor) and returns it only if it lies inside the opened folder; otherwise null.
 */
function guardPath(p: unknown): string | null {
  if (!openedFolder || typeof p !== 'string' || !p || p.includes('\0')) return null;
  let resolved = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      resolved = path.join(fs.realpathSync.native(resolved), ...rest);
      break;
    } catch {
      const parent = path.dirname(resolved);
      if (parent === resolved) return null;
      rest.unshift(path.basename(resolved));
      resolved = parent;
    }
  }
  return isInside(openedFolder, resolved) ? resolved : null;
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

function writeJson(file: string, data: unknown) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

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
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
  });

  if (process.env['ELECTRON_RENDERER_URL']) mainWin.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Phaser Project Folder',
    });
    const picked = result.canceled ? null : result.filePaths[0] ?? null;
    if (!picked) return null;
    try {
      openedFolder = fs.realpathSync.native(picked);
    } catch {
      return null;
    }
    return openedFolder;
  });

  ipcMain.handle('devserver:start', (_e, folder: unknown, script?: unknown) => {
    const cwd = guardFolder(folder);
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
    const folder = guardFolder(rawFolder);
    if (!folder) return;
    // `code` is a .cmd shim on Windows and needs a shell; quotes are safe there since paths can't contain them.
    spawn('code', [IS_WIN ? `"${folder}"` : folder], { shell: IS_WIN, detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref();
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

  ipcMain.handle('fs:readAssets', (_e, rawFolder: unknown) => {
    const folder = guardFolder(rawFolder);
    if (!folder) return [];
    const assetsDir = guardFolder(path.join(folder, 'assets'));
    const root = assetsDir ?? folder;
    return scanAssets(root, root);
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

  // Legacy file names kept for now (renamed in a later phase).
  const SCENE_FILE = 'forge-scene.json';
  const CONFIG_FILE = '.phaser-forge.json';

  ipcMain.handle('scene:save', (_e, folder: unknown, objects: object[]) => {
    const file = guardFile(folder, SCENE_FILE);
    return file ? writeJson(file, { version: 1, objects }) : false;
  });
  ipcMain.handle('scene:load', (_e, folder: unknown) => {
    const file = guardFile(folder, SCENE_FILE);
    return file ? readJson(file) : null;
  });

  ipcMain.handle('project:readConfig', (_e, folder: unknown) => {
    const file = guardFile(folder, CONFIG_FILE);
    return file ? readJson(file) : null;
  });
  ipcMain.handle('project:writeConfig', (_e, folder: unknown, config: object) => {
    const file = guardFile(folder, CONFIG_FILE);
    return file ? writeJson(file, config) : false;
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

app.on('before-quit', stopDevServer);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
