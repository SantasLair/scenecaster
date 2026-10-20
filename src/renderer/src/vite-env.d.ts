/// <reference types="vite/client" />

interface AssetFile {
  name: string;
  type: 'file';
  path: string;
  fullPath: string;
  ext: string;
}

interface AssetFolder {
  name: string;
  type: 'folder';
  path: string;
  children: AssetEntry[];
}

type AssetEntry = AssetFile | AssetFolder;

/** One row of the FileSystem tree: `path` is absolute. */
interface FsEntry { name: string; type: 'folder' | 'file'; path: string; ext: string }

type IpcResult = { ok: boolean; error?: string };

/** Raw file text for the renderer to parse; `found` is false when the file does not exist. */
type PfReadResult = IpcResult & { found?: boolean; text?: string };

/** Editor-only settings, stored in scenecaster/editor.json (not part of PHASEFORM). */
interface EditorSettings { devScript?: string }

interface ElectronAPI {
  openFolder: () => Promise<string | null>;
  readAssets: (folder: string) => Promise<AssetEntry[]>;
  fileToDataUrl: (path: string) => Promise<string | null>;
  /** The assets folder (project-relative); `exists` is false when `dir` is only where one would be created. Null outside a project. */
  assetsInfo: (folder: string) => Promise<{ dir: string; exists: boolean } | null>;
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
