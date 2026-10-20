import { useCallback, useEffect, useMemo, useState } from 'react';
import { joinScenes, type SceneRow, type SceneState } from '../../../shared/sceneRegistry';
import { isSceneKey } from '../../../shared/phaseform/format';
import { CLAUDE_POINTER, MIGRATE_FILE, migrateText } from '../../../shared/migrate';
import { driftReport, findDrift } from '../../../shared/drift';
import { assetFiles } from '../../../shared/phaseform/assets';
import type { PfProject } from '../../../shared/phaseform/types';

const api = window.electronAPI;

const STATE_LABEL: Record<SceneState, string> = { 'layout+code': 'layout + code', 'code-only': 'code only', 'layout-only': 'layout only' };
const STATE_STYLE: Record<SceneState, string> = {
  'layout+code': 'text-green-400 border-green-800',
  'code-only': 'text-yellow-300 border-yellow-800',
  'layout-only': 'text-blue-300 border-blue-800',
};

interface Props {
  projectFolder: string | null;
  project: PfProject | null;
  onOpenScene: (key: string) => void;
  onCreateLayout: (key: string) => void;
}

/**
 * The project at a glance: its saved settings, what the game's code declares (marked "detected, not saved"), and the scene
 * registry joining the two. Read-only against the game's code; "Create layout" writes a scene file in the project only.
 */
export default function ProjectPanel({ projectFolder, project, onOpenScene, onCreateLayout }: Props) {
  const [scan, setScan] = useState<SourceScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [settings, setSettings] = useState<EditorSettings>({});
  const [adoptError, setAdoptError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectFolder) { setScan(null); return; }
    setLoading(true);
    const result = await api.scanSource(projectFolder);
    setScan(result);
    setLoading(false);
  }, [projectFolder]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(
    () => (scan ? joinScenes(project?.scenes ?? [], scan.scenes, scan.config) : (project?.scenes ?? []).map((e): SceneRow => ({ state: 'layout-only', key: e.key, path: e.path }))),
    [scan, project]);

  // Manifest files that are not on disk, re-checked whenever the manifest or the scan changes.
  useEffect(() => {
    if (!projectFolder || !project) { setMissing(new Set()); return; }
    let live = true;
    void api.missingAssetFiles(projectFolder, [...new Set(project.assets.flatMap(assetFiles))]).then(m => { if (live) setMissing(new Set(m)); });
    return () => { live = false; };
  }, [projectFolder, project?.assets, scan]);

  const drift = useMemo(() => (project && scan ? findDrift(project, rows, scan.loads, missing) : []), [project, scan, rows, missing]);

  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard unavailable */ }
  };

  useEffect(() => {
    if (!projectFolder) { setSettings({}); return; }
    void api.readEditorSettings(projectFolder).then(s => setSettings(s ?? {}));
  }, [projectFolder]);

  const saveSettings = async (patch: EditorSettings) => {
    if (!projectFolder) return;
    const r = await api.writeEditorSettings(projectFolder, patch);
    if (r.ok) setSettings(s => ({ ...s, ...patch }));
  };

  // Once adoption was started and the code and the files agree, record it.
  useEffect(() => {
    if (settings.adoptStarted && !settings.adopted && project && scan && drift.length === 0) void saveSettings({ adopted: true });
  }, [settings, project, scan, drift]);

  /** Writes scenecaster/MIGRATE.md (nothing in the game changes). */
  const adopt = async () => {
    if (!projectFolder || !project || !scan) return;
    setAdoptError(null);
    const text = migrateText({ project, rows, loads: scan.loads, configPath: scan.config?.path ?? null });
    const r = await api.writeMigrate(projectFolder, text);
    if (!r.ok) { setAdoptError(r.error ?? 'Could not write the file.'); return; }
    await saveSettings({ adoptStarted: true, adopted: false });
  };

  if (!projectFolder) return <p className="text-gray-600 text-xs text-center py-6">Open a project to see its scenes and settings.</p>;

  const dynamicLoads = scan?.loads.filter(l => l.dynamic).length ?? 0;

  return (
    <div className="px-3 py-2 text-xs space-y-3 select-text">
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-gray-400 uppercase tracking-wider text-[10px]">Project</h3>
          <button onClick={() => void refresh()} disabled={loading} className="text-gray-500 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700 disabled:opacity-50">
            {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
        {project ? (
          <dl className="grid grid-cols-[6rem_1fr] gap-y-0.5">
            <dt className="text-gray-500">Name</dt><dd>{project.name}</dd>
            <dt className="text-gray-500">Entry scene</dt><dd>{project.entry}</dd>
            <dt className="text-gray-500">Scenes</dt><dd>{project.scenes.length}</dd>
            <dt className="text-gray-500">Assets</dt><dd>{project.assets.length} in the manifest</dd>
          </dl>
        ) : <p className="text-gray-500">No phaseform.project.json yet. It is created when you save.</p>}
      </section>

      <section>
        <h3 className="text-gray-400 uppercase tracking-wider text-[10px] mb-1">Detected in code <span className="normal-case text-gray-600">(not saved)</span></h3>
        {!scan ? <p className="text-gray-500">{loading ? 'Scanning…' : 'The source could not be scanned.'}</p> : (
          <dl className="grid grid-cols-[6rem_1fr] gap-y-0.5">
            <dt className="text-gray-500">Game config</dt>
            <dd>{scan.config ? <>{scan.config.path}{scan.config.width && scan.config.height ? ` (${scan.config.width}×${scan.config.height})` : ''}</> : <span className="text-gray-500">no new Phaser.Game found</span>}</dd>
            <dt className="text-gray-500">Scene classes</dt><dd>{scan.scenes.length}</dd>
            <dt className="text-gray-500">Asset loads</dt>
            <dd>{scan.loads.length}{dynamicLoads > 0 && <span className="text-gray-500"> ({dynamicLoads} computed, not readable)</span>}</dd>
            <dt className="text-gray-500">Scanned</dt>
            <dd>{scan.fileCount} script files{scan.truncated && <span className="text-yellow-300"> (limit reached, may be incomplete)</span>}</dd>
          </dl>
        )}
      </section>

      <section>
        <h3 className="text-gray-400 uppercase tracking-wider text-[10px] mb-1">Scenes</h3>
        {rows.length === 0 ? <p className="text-gray-500">No scenes yet.</p> : (
          <ul className="space-y-1">
            {rows.map((r, i) => (
              <li key={`${r.key ?? r.cls?.className}-${i}`} className="flex items-center gap-2">
                <span className={`border rounded px-1 py-px text-[10px] whitespace-nowrap ${STATE_STYLE[r.state]}`}>{STATE_LABEL[r.state]}</span>
                <span className="font-medium">{r.key ?? <span className="text-gray-500">(computed key)</span>}</span>
                {r.cls && (
                  <span className="text-gray-500 truncate" title={`${r.cls.path}:${r.cls.line}`}>
                    {r.cls.className}{r.inGameConfig === false && ' · not in game config'}
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {r.state !== 'code-only' && r.key && (
                    <button onClick={() => onOpenScene(r.key!)} className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700">Open</button>
                  )}
                  {r.state === 'code-only' && r.key && project && isSceneKey(r.key) && (
                    <button onClick={() => onCreateLayout(r.key!)} className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700">Create layout</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {project && scan && (
        <section>
          <h3 className="text-gray-400 uppercase tracking-wider text-[10px] mb-1">Adoption</h3>
          {settings.adopted ? <p className="text-green-400">Adopted: the code and the PHASEFORM files agree.</p> : (
            <div className="space-y-1.5">
              <p className="text-gray-500">
                {settings.adoptStarted
                  ? `${MIGRATE_FILE} is written. Ask your AI to follow it; this turns to "adopted" when the Drift section below is clean.`
                  : `Writes scenecaster/${MIGRATE_FILE} for an AI to follow. Nothing in the game is changed by the editor.`}
              </p>
              <button onClick={() => void adopt()} className="text-gray-200 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">
                {settings.adoptStarted ? `Rewrite ${MIGRATE_FILE}` : 'Adopt this project'}
              </button>
              {adoptError && <p className="text-red-400">{adoptError}</p>}
              {settings.adoptStarted && (
                <div>
                  <p className="text-gray-500 mb-0.5">Add this line to CLAUDE.md or AGENTS.md yourself:</p>
                  <pre className="whitespace-pre-wrap bg-gray-950 rounded p-1.5 text-gray-300">{CLAUDE_POINTER}</pre>
                  <button onClick={() => void copy('pointer', CLAUDE_POINTER)} className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700">{copied === 'pointer' ? 'Copied' : 'Copy line'}</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {project && scan && (
        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-gray-400 uppercase tracking-wider text-[10px]">Drift</h3>
            {drift.length > 0 && (
              <button onClick={() => void copy('drift', driftReport(drift))} className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700">{copied === 'drift' ? 'Copied' : 'Copy for AI'}</button>
            )}
          </div>
          {drift.length === 0 ? <p className="text-green-400">The code and the PHASEFORM files agree.</p> : (
            <ul className="space-y-1">
              {drift.map((d, i) => <li key={i} className="text-yellow-300">⚠ {d.message}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
