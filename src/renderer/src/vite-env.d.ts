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

interface ProjectConfig {
  canvasWidth: number;
  canvasHeight: number;
  devScript?: string;
}

type LoadedScene = IpcResult & { found?: boolean; data?: unknown };

type IpcResult = { ok: boolean; error?: string };

interface ElectronAPI {
  openFolder: () => Promise<string | null>;
  readAssets: (folder: string) => Promise<AssetEntry[]>;
  fileToDataUrl: (path: string) => Promise<string | null>;
  readProjectConfig: (folder: string) => Promise<ProjectConfig | null>;
  writeProjectConfig: (folder: string, cfg: ProjectConfig) => Promise<IpcResult>;
  readProjectScripts: (folder: string) => Promise<string[]>;
  saveScene: (folder: string, name: string, text: string) => Promise<IpcResult>;
  watchScene: (folder: string, name: string) => Promise<void>;
  onSceneChanged: (cb: () => void) => () => void;
  loadScene: (folder: string, name: string) => Promise<LoadedScene>;
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
