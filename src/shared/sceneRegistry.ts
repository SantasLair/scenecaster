// Joins the scene classes found in a game's code to the scenes listed in phaseform.project.json. Pure; both inputs are
// reports of what exists, so nothing here is written anywhere.
import type { GameConfig, SceneClass } from './codeScan';

export type SceneState = 'layout+code' | 'code-only' | 'layout-only';

export interface SceneRow {
  state: SceneState;
  /** The scene key; null for a scene class whose key is computed in code, so it cannot be matched. */
  key: string | null;
  /** Project-relative scene file, when the project lists one. */
  path?: string;
  cls?: SceneClass;
  /** True when the game's `new Phaser.Game` scene list names the class; undefined when no config was found. */
  inGameConfig?: boolean;
}

export function joinScenes(entries: { key: string; path: string }[], classes: SceneClass[], config: GameConfig | null): SceneRow[] {
  const rows: SceneRow[] = [];
  const used = new Set<SceneClass>();
  const listed = (cls: SceneClass) => config ? config.sceneClasses.includes(cls.className) : undefined;
  for (const e of entries) {
    const cls = classes.find(c => c.key === e.key && !used.has(c));
    if (cls) used.add(cls);
    rows.push(cls
      ? { state: 'layout+code', key: e.key, path: e.path, cls, inGameConfig: listed(cls) }
      : { state: 'layout-only', key: e.key, path: e.path });
  }
  for (const cls of classes) {
    if (!used.has(cls)) rows.push({ state: 'code-only', key: cls.key, cls, inGameConfig: listed(cls) });
  }
  return rows;
}
