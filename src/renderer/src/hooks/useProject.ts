import { useRef, useState } from 'react';

const api = window.electronAPI;

/** The opened project folder, its canvas size, and whether scenecaster/project.json has been written yet. */
export function useProject() {
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });
  const [pendingSetupFolder, setPendingSetupFolder] = useState<string | null>(null);
  /** True once scenecaster/project.json exists; opening a project writes nothing, the first save or setting change does. */
  const configPersistedRef = useRef(false);

  const open = (folder: string, config: ProjectConfig, persisted: boolean) => {
    configPersistedRef.current = persisted;
    setProjectFolder(folder);
    setCanvasSize({ w: config.canvasWidth, h: config.canvasHeight });
  };

  const close = () => {
    configPersistedRef.current = false;
    setPendingSetupFolder(null);
    setProjectFolder(null);
    setCanvasSize({ w: 1280, h: 720 });
  };

  /** Folder picker; `onOpen` runs for a folder that already has a config, otherwise the setup dialog asks for the size. */
  const choose = async (onOpen: (folder: string, config: ProjectConfig, persisted: boolean) => void) => {
    const folder = await api.openFolder();
    if (!folder) return;
    const config = await api.readProjectConfig(folder);
    if (config?.canvasWidth && config?.canvasHeight) onOpen(folder, config, true);
    else setPendingSetupFolder(folder);
  };

  const confirmSetup = (onOpen: (folder: string, config: ProjectConfig, persisted: boolean) => void, w: number, h: number) => {
    const folder = pendingSetupFolder;
    if (!folder) return;
    setPendingSetupFolder(null);
    onOpen(folder, { canvasWidth: w, canvasHeight: h }, false);
  };

  const cancelSetup = () => setPendingSetupFolder(null);

  /** Writes the config the first time something is saved. */
  const ensureConfigPersisted = async (folder: string, devScript: string) => {
    if (configPersistedRef.current) return { ok: true } as IpcResult;
    const cfg = await api.writeProjectConfig(folder, { canvasWidth: canvasSize.w, canvasHeight: canvasSize.h, devScript });
    if (cfg.ok) configPersistedRef.current = true;
    return cfg;
  };

  const persistDevScript = (devScript: string) => {
    if (!projectFolder) return;
    api.writeProjectConfig(projectFolder, { canvasWidth: canvasSize.w, canvasHeight: canvasSize.h, devScript })
      .then(r => { configPersistedRef.current = r.ok; });
  };

  return {
    projectFolder, canvasSize, pendingSetupFolder,
    open, close, choose, confirmSetup, cancelSetup, ensureConfigPersisted, persistDevScript,
  };
}
