// Drift: places where the game's code and the PHASEFORM files disagree. Pure; reports only, never fixes anything.
import type { AssetLoad } from './codeScan';
import { assetFiles } from './phaseform/assets';
import type { PfProject } from './phaseform/types';
import type { SceneRow } from './sceneRegistry';

export type DriftKind = 'scene-class-without-layout' | 'layout-without-scene-class' | 'asset-not-in-manifest' | 'manifest-file-missing';

export interface DriftItem { kind: DriftKind; message: string }

/**
 * `rows` come from joinScenes, `loads` from the source scan, `missingFiles` are the manifest files not on disk.
 * Computed scene keys and asset loads cannot be compared, so they are left out rather than guessed at.
 */
export function findDrift(project: PfProject, rows: SceneRow[], loads: AssetLoad[], missingFiles: Set<string>): DriftItem[] {
  const out: DriftItem[] = [];
  for (const r of rows) {
    if (r.state === 'code-only' && r.key && r.cls) {
      out.push({ kind: 'scene-class-without-layout', message: `Scene class ${r.cls.className} (${r.cls.path}:${r.cls.line}) uses key "${r.key}", which is not in ${'phaseform.project.json'} scenes.` });
    } else if (r.state === 'layout-only' && r.key) {
      out.push({ kind: 'layout-without-scene-class', message: `Scene "${r.key}" (${r.path}) has no scene class in the code with that key.` });
    }
  }
  const keys = new Set(project.assets.map(a => a.key));
  const seen = new Set<string>();
  for (const l of loads) {
    if (l.dynamic || !l.key || keys.has(l.key) || seen.has(`${l.key}|${l.path}`)) continue;
    seen.add(`${l.key}|${l.path}`);
    out.push({ kind: 'asset-not-in-manifest', message: `${l.path}:${l.line} loads ${l.method} "${l.key}" (${l.url}), which is not in the manifest.` });
  }
  for (const a of project.assets) {
    const files = assetFiles(a).filter(f => missingFiles.has(f));
    if (files.length) out.push({ kind: 'manifest-file-missing', message: `Manifest entry "${a.key}" points to missing file${files.length > 1 ? 's' : ''}: ${files.join(', ')}.` });
  }
  return out;
}

/** Text to paste to an AI assistant. */
export function driftReport(items: DriftItem[]): string {
  if (items.length === 0) return 'No drift between the code and the PHASEFORM files.';
  return [
    `The game code and the PHASEFORM files disagree in ${items.length} place${items.length > 1 ? 's' : ''}. Bring them back in line; keep game behaviour identical.`,
    '',
    ...items.map(i => `- ${i.message}`),
  ].join('\n');
}
