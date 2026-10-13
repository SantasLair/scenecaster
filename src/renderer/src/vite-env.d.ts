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
  /** Read from the pre-Phase-1 .phaser-forge.json; not yet persisted in scenecaster/project.json. */
  legacy?: boolean;
}

interface SavedScene {
  version: number;
  /** Cast at the disk boundary; not validated on load yet. */
  objects: import('../../shared/protocol').SceneObject[];
}

type IpcResult = { ok: boolean; error?: string };

interface ElectronAPI {
  openFolder: () => Promise<string | null>;
  readAssets: (folder: string) => Promise<AssetEntry[]>;
  fileToDataUrl: (path: string) => Promise<string | null>;
  readProjectConfig: (folder: string) => Promise<ProjectConfig | null>;
  writeProjectConfig: (folder: string, cfg: ProjectConfig) => Promise<IpcResult>;
  readProjectScripts: (folder: string) => Promise<string[]>;
  saveScene: (folder: string, name: string, objects: object[]) => Promise<IpcResult>;
  /** `legacy`: loaded from the pre-Phase-1 forge-scene.json, which stays on disk untouched. */
  loadScene: (folder: string, name: string) => Promise<{ data: SavedScene; legacy: boolean } | null>;
  startDevServer: (folder: string, script?: string) => Promise<IpcResult & { url?: string }>;
  stopDevServer: () => Promise<IpcResult>;
  onDevServerOutput: (cb: (text: string) => void) => void;
  onDevServerStopped: (cb: () => void) => void;
  removeDevServerListeners: () => void;
  openVSCode: (folder: string) => Promise<void>;
  /** `entry`/`importPath` are set when the module entry could be found in index.html. */
  installBridge: (folder: string) => Promise<IpcResult & { entry?: string; importPath?: string }>;
}

interface Window {
  electronAPI: ElectronAPI;
}
