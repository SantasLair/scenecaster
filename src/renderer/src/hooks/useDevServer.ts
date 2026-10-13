import { useCallback, useEffect, useRef, useState } from 'react';

export type DevStatus = 'idle' | 'starting' | 'running' | 'error';

const api = window.electronAPI;

interface Options {
  projectFolder: string | null;
  /** Remember the chosen dev script in the project config. */
  persistDevScript: (script: string) => void;
  showConsole: () => void;
}

/** The project's dev server: status, URL, console output and the choice of `npm run` script. */
export function useDevServer({ projectFolder, persistDevScript, showConsole }: Options) {
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<DevStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState('');
  const [scripts, setScripts] = useState<string[]>([]);
  const [selectedScript, setSelectedScript] = useState('dev');

  const appendLog = useCallback((text: string) => setLogs(prev => prev + text), []);
  const clearLogs = () => setLogs('');

  useEffect(() => {
    api.onDevServerOutput(appendLog);
    api.onDevServerStopped(() => { setStatus('idle'); setUrl(null); });
    return () => api.removeDevServerListeners();
  }, [appendLog]);

  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Prefer a saved choice, then `*:dev:*` variants (monorepos), then plain `dev`.
  const loadScripts = async (folder: string, saved?: string) => {
    const found = await api.readProjectScripts(folder);
    setScripts(found);
    setSelectedScript(
      (saved && found.includes(saved) ? saved : undefined) ??
      found.find(s => /:dev(:|$)/.test(s)) ??
      (found.includes('dev') ? 'dev' : found[0]) ??
      'dev');
  };

  const changeScript = (script: string) => {
    setSelectedScript(script);
    persistDevScript(script);
  };

  const stop = async () => {
    await api.stopDevServer();
    setStatus('idle');
    setUrl(null);
  };

  /** Stops a running server, else starts one. `confirmStart` can veto the start (e.g. unsaved changes). */
  const runStop = async (confirmStart?: () => boolean) => {
    if (status === 'running' || status === 'starting') return stop();
    if (!projectFolder) return;
    if (confirmStart && !confirmStart()) return;
    setStatus('starting');
    setLogs('');
    showConsole();
    const result = await api.startDevServer(projectFolder, selectedScript);
    if (result.ok && result.url) {
      setStatus('running');
      setUrl(result.url);
    } else {
      setStatus('error');
      appendLog(`\n[Error: ${result.error ?? 'Unknown error'}]\n`);
    }
  };

  return {
    status, url, logs, scripts, selectedScript, consoleEndRef,
    appendLog, clearLogs, loadScripts, changeScript, stop, runStop,
  };
}
