// The editor's context in one place: which panels and actions are available follows from project + scene state.
import type { SceneStatus } from './sceneModel';

export type UiMode = 'no-project' | 'no-scene' | 'loading' | 'scene-blocked' | 'scene';

export interface UiState {
  mode: UiMode;
  hasProject: boolean;
  /** The Phaser viewport exists (and loads assets) only here. */
  canvasAvailable: boolean;
  /** Scene-specific actions: add object, undo/redo, tools, snap, camera, selection, inspector. */
  canEditScene: boolean;
  canSave: boolean;
  /** Run/stop, VS Code and the like need only a project. */
  canRun: boolean;
}

export function deriveUiState(i: { projectFolder: string | null; sceneStatus: SceneStatus; live?: boolean }): UiState {
  const hasProject = !!i.projectFolder;
  const mode: UiMode = !hasProject ? 'no-project'
    : i.live ? 'scene'
    : i.sceneStatus === 'open' ? 'scene'
    : i.sceneStatus === 'blocked' ? 'scene-blocked'
    : i.sceneStatus === 'loading' ? 'loading' : 'no-scene';
  const scene = mode === 'scene';
  return {
    mode, hasProject, canvasAvailable: scene,
    canEditScene: scene && !i.live, canSave: scene && !i.live, canRun: hasProject,
  };
}
