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

  // Project scripts
  readProjectScripts: (folder: string) => ipcRenderer.invoke('project:readScripts', folder),
  confirmUnsaved: (message: string) => ipcRenderer.invoke('dialog:unsaved', message),

  // PHASEFORM files
  readProject: (folder: string) => ipcRenderer.invoke('pf:readProject', folder),
  writeProject: (folder: string, text: string) => ipcRenderer.invoke('pf:writeProject', folder, text),
  readScene: (folder: string, relPath: string) => ipcRenderer.invoke('pf:readScene', folder, relPath),
  writeScene: (folder: string, relPath: string, text: string) => ipcRenderer.invoke('pf:writeScene', folder, relPath, text),
  /** Replaces the watch set; an empty folder or array stops watching. */
  watchFiles: (folder: string, relPaths: string[]) => ipcRenderer.invoke('pf:watch', folder, relPaths),
  /** Fires with the relPath of a watched file changed by something other than this editor. Returns an unsubscribe function. */
  onFileChanged: (cb: (relPath: string) => void) => {
    const listener = (_e: unknown, relPath: string) => cb(relPath);
    ipcRenderer.on('pf:changed', listener);
    return () => { ipcRenderer.removeListener('pf:changed', listener); };
  },
  readEditorSettings: (folder: string) => ipcRenderer.invoke('pf:readEditorSettings', folder),
  writeEditorSettings: (folder: string, settings: object) => ipcRenderer.invoke('pf:writeEditorSettings', folder, settings),

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
