// Joins the scene classes found in a game's code to the scenes listed in phaseform.project.json. Pure; both inputs are
// reports of what exists, so nothing here is written anywhere.
import type { GameConfig, SceneClass } from './codeScan';
import { DEFAULT_FIRST_SCENE, isSceneKey } from './phaseform/format';

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

export interface FirstSceneSuggestion {
  /** The key for the new project's first scene and entry. */
  key: string;
  /** The canvas size from the game config, when it is literal. */
  width: number | null;
  height: number | null;
  /** Every usable key found in the code (game config order first), for a picker; the default key is always last. */
  options: { key: string; label: string }[];
  /** Where the suggestion came from; null when the code gave nothing and the default is used. */
  source: string | null;
}

/**
 * What a new project should start with, from the scan: Phaser starts the first scene of the game's scene list, so that
 * class's key becomes the first scene and the entry. Falls back to the default key when no usable key is found.
 */
export function suggestFirstScene(classes: SceneClass[], config: GameConfig | null): FirstSceneSuggestion {
  const ordered = [...(config?.sceneClasses ?? []).map(n => classes.find(c => c.className === n)), ...classes];
  const usable = ordered.filter((c): c is SceneClass => !!c?.key && isSceneKey(c.key));
  const first = usable[0];
  const options = usable.filter((c, i) => usable.findIndex(o => o.key === c.key) === i).map(c => ({ key: c.key!, label: `${c.key} (${c.className})` }));
  if (!options.some(o => o.key === DEFAULT_FIRST_SCENE)) options.push({ key: DEFAULT_FIRST_SCENE, label: `${DEFAULT_FIRST_SCENE} (new)` });
  return {
    key: first?.key ?? DEFAULT_FIRST_SCENE,
    options,
    width: config?.width ?? null,
    height: config?.height ?? null,
    source: first ? `${first.className} (${first.path}:${first.line})` : null,
  };
}
