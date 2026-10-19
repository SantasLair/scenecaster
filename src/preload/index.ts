import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Folder
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // Assets
  readAssets: (folder: string) => ipcRenderer.invoke('fs:readAssets', folder),
  listDir: (dir: string) => ipcRenderer.invoke('fs:listDir', dir),
  findFiles: (dir: string, query: string) => ipcRenderer.invoke('fs:findFiles', dir, query),
  showItem: (path: string) => ipcRenderer.invoke('shell:showItem', path),
  fileToDataUrl: (path: string) => ipcRenderer.invoke('fs:fileToDataUrl', path),

  // Project config
  readProjectConfig: (folder: string) => ipcRenderer.invoke('project:readConfig', folder),
  writeProjectConfig: (folder: string, cfg: object) => ipcRenderer.invoke('project:writeConfig', folder, cfg),
  readProjectScripts: (folder: string) => ipcRenderer.invoke('project:readScripts', folder),

  // Scene
  saveScene: (folder: string, name: string, text: string) => ipcRenderer.invoke('scene:save', folder, name, text),
  confirmUnsaved: (message: string) => ipcRenderer.invoke('dialog:unsaved', message),
  /** An empty folder stops the watcher. */
  watchScene: (folder: string, name: string) => ipcRenderer.invoke('scene:watch', folder, name),
  /** Fires when the scene file was changed by something other than this editor. Returns an unsubscribe function. */
  onSceneChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('scene:changed', listener);
    return () => { ipcRenderer.removeListener('scene:changed', listener); };
  },
  listScenes: (folder: string) => ipcRenderer.invoke('scene:list', folder),
  loadScene: (folder: string, name: string) => ipcRenderer.invoke('scene:load', folder, name),

  // Dev server
  startDevServer: (folder: string, script?: string) => ipcRenderer.invoke('devserver:start', folder, script),
  stopDevServer: () => ipcRenderer.invoke('devserver:stop'),
  onDevServerOutput: (cb: (text: string) => void) =>
    ipcRenderer.on('devserver:output', (_e, text) => cb(text)),
  onDevServerStopped: (cb: () => void) =>
    ipcRenderer.on('devserver:stopped', cb),
  removeDevServerListeners: () => {
    ipcRenderer.removeAllListeners('devserver:output');
    ipcRenderer.removeAllListeners('devserver:stopped');
  },

  // VS Code
  openVSCode: (folder: string) => ipcRenderer.invoke('vscode:open', folder),

  // Browser
  openLocalUrl: (url: string) => ipcRenderer.invoke('shell:openLocal', url),

  // Bridge
  installBridge: (folder: string) => ipcRenderer.invoke('bridge:install', folder),
});
