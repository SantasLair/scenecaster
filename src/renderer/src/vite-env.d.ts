/// <reference types="vite/client" />

interface AssetFile {
  name: string;
  type: 'file';
  path: string;
  fullPath: string;
  ext: string;
  /** image, audio, or data (atlas json, font xml or fnt). Only images can be dragged into the viewport. */
  kind: 'image' | 'audio' | 'data';
}

interface AssetFolder {
  name: string;
  type: 'folder';
  path: string;
  children: AssetEntry[];
}

type AssetEntry = AssetFile | AssetFolder;

/** `custom` is true when the folder was chosen in the Assets tab rather than auto-detected. */
interface AssetsInfo { dir: string; exists: boolean; custom: boolean }

/** One row of the FileSystem tree: `path` is absolute. */
interface FsEntry { name: string; type: 'folder' | 'file'; path: string; ext: string }

type IpcResult = { ok: boolean; error?: string };

/** Raw file text for the renderer to parse; `found` is false when the file does not exist. */
type PfReadResult = IpcResult & { found?: boolean; text?: string };

/** Editor-only settings, stored in scenecaster/editor.json (not part of PHASEFORM). */
interface EditorSettings { devScript?: string; assetsDir?: string; adoptStarted?: boolean; adopted?: boolean }

/** What the source scan found in the game's code; null from scanSource means outside the opened project. */
interface SourceScan {
  scenes: import('../../shared/codeScan').SceneClass[];
  loads: import('../../shared/codeScan').AssetLoad[];
  config: import('../../shared/codeScan').GameConfig | null;
  fileCount: number;
  /** True when the file limit was hit, so the report may be incomplete. */
  truncated: boolean;
}

interface ElectronAPI {
  openFolder: () => Promise<string | null>;
  readAssets: (folder: string) => Promise<AssetEntry[]>;
  fileToDataUrl: (path: string) => Promise<string | null>;
  /** Watches the assets folder; an empty string stops. False if there is nothing to watch. */
  watchAssets: (folder: string) => Promise<boolean>;
  /** Fires (debounced) when files in the assets folder change; returns an unsubscribe function. */
  onAssetsChanged: (cb: () => void) => () => void;
  /** Which of these project-relative files do not exist. */
  missingAssetFiles: (folder: string, relPaths: string[]) => Promise<string[]>;
  /** The assets folder (project-relative); `exists` is false when `dir` is only where one would be created. Null outside a project. */
  assetsInfo: (folder: string) => Promise<AssetsInfo | null>;
  /** Opens a folder picker for the assets folder (or, with reset, returns to auto-detection). */
  chooseAssetsFolder: (folder: string, reset?: boolean) => Promise<{ ok: boolean; error?: string; info?: AssetsInfo }>;
  /** Opens the system file picker and returns the chosen paths (empty if cancelled). */
  pickAssets: () => Promise<string[]>;
  /** Copies files into a project subfolder without overwriting; a taken name gets -2, -3... */
  importAssets: (folder: string, destRel: string, sources: string[]) => Promise<{
    ok: boolean; error?: string; results?: { name: string; kind?: 'image' | 'audio' | 'data'; rel?: string; error?: string }[];
  }>;
  /** The disk path of a file dropped from the operating system. */
  pathForFile: (file: File) => string;
  /** null: the folder is outside the opened project or cannot be read. */
  listDir: (dir: string) => Promise<FsEntry[] | null>;
  findFiles: (dir: string, query: string) => Promise<FsEntry[]>;
  showItem: (path: string) => Promise<void>;
  /** Reads the game's scripts (read-only) and reports scene classes, game config and asset loads. */
  scanSource: (folder: string) => Promise<SourceScan | null>;
  /** Writes scenecaster/MIGRATE.md (the only file adoption writes); `path` is project-relative. */
  writeMigrate: (folder: string, text: string) => Promise<IpcResult & { path?: string }>;
  readProjectScripts: (folder: string) => Promise<string[]>;
  confirmUnsaved: (message: string) => Promise<'save' | 'discard' | 'cancel'>;
  readProject: (folder: string) => Promise<PfReadResult>;
  writeProject: (folder: string, text: string) => Promise<IpcResult>;
  /** `relPath` is project-relative, forward slashes, ending in `.phaseform.json`. */
  readScene: (folder: string, relPath: string) => Promise<PfReadResult>;
  writeScene: (folder: string, relPath: string, text: string) => Promise<IpcResult>;
  /** Replaces the watch set (project file and/or scene paths); an empty folder or array stops watching. */
  watchFiles: (folder: string, relPaths: string[]) => Promise<void>;
  onFileChanged: (cb: (relPath: string) => void) => () => void;
  /** null: file missing or invalid. */
  readEditorSettings: (folder: string) => Promise<EditorSettings | null>;
  writeEditorSettings: (folder: string, settings: EditorSettings) => Promise<IpcResult>;
  startDevServer: (folder: string, script?: string) => Promise<IpcResult & { url?: string }>;
  stopDevServer: () => Promise<IpcResult>;
  onDevServerOutput: (cb: (text: string) => void) => void;
  onDevServerStopped: (cb: () => void) => void;
  removeDevServerListeners: () => void;
  openLocalUrl: (url: string) => Promise<void>;
  openVSCode: (folder: string) => Promise<void>;
  /** `entry`/`importPath` are set when the module entry could be found in index.html. */
  installBridge: (folder: string) => Promise<IpcResult & { entry?: string; importPath?: string }>;
}

interface Window {
  electronAPI: ElectronAPI;
}
