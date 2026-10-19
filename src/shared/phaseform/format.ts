// Reading and writing PHASEFORM files. Documents are plain JSON kept in their own key order, so saving an unchanged
// document produces the same bytes and an edit produces a minimal diff.
import type { PfProject, PfScene } from './types';

export const PF_VERSION = '0.1.0';
export const PROJECT_FILE = 'phaseform.project.json';
export const SCENE_EXT = '.phaseform.json';
export const SCENES_DIR = 'scenes';
export const DEFAULT_SIZE = { width: 1280, height: 720 };

export const formatJson = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

export function newScene(key: string, size = DEFAULT_SIZE): PfScene {
  return { format: 'phaseform', version: PF_VERSION, key, size: { ...size }, background: '#1e1e1e', objects: [] };
}

export function newProject(name: string, sceneKey: string, scenePath: string): PfProject {
  return { format: 'phaseform-project', version: PF_VERSION, name, entry: sceneKey, scenes: [{ key: sceneKey, path: scenePath }], assets: [] };
}

/** The scene file path for a key, relative to the project root. */
export const scenePathFor = (key: string) => `${SCENES_DIR}/${key.replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase()}${SCENE_EXT}`;

export const isSceneKey = (key: string) => /^[A-Za-z][\w-]*$/.test(key);
