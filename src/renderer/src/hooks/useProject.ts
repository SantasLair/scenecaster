import { useState } from 'react';

const api = window.electronAPI;

/**
 * The opened project folder, and the folder (if any) waiting for the setup dialog because it has no
 * phaseform.project.json yet. Opening a project writes nothing: the project file appears on the first save.
 */
export function useProject() {
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [pendingSetupFolder, setPendingSetupFolder] = useState<string | null>(null);

  const open = (folder: string) => { setPendingSetupFolder(null); setProjectFolder(folder); };

  const close = () => { setPendingSetupFolder(null); setProjectFolder(null); };

  /** Folder picker. */
  const choose = async (onOpen: (folder: string) => void) => {
    const folder = await api.openFolder();
    if (folder) onOpen(folder);
  };

  /** The folder has no PHASEFORM project: ask for a canvas size, then the scene hook creates one in memory. */
  const requestSetup = (folder: string) => setPendingSetupFolder(folder);
  const cancelSetup = () => setPendingSetupFolder(null);

  /** Remembers the chosen dev script (the one editor-only setting). */
  const persistDevScript = (devScript: string) => {
    if (projectFolder) void api.writeEditorSettings(projectFolder, { devScript });
  };

  return { projectFolder, pendingSetupFolder, open, close, choose, requestSetup, cancelSetup, persistDevScript };
}
