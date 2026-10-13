// The on-disk layout of a Scenecaster project. The folder name is defined once here; docs and
// generated files derive from it so a rename is a one-line change.
export const PROJECT_DIR = 'scenecaster';
export const SCENES_DIR = 'scenes';
export const SCENE_EXT = '.scene.json';
export const PROJECT_FILE = 'project.json';
export const DEFAULT_SCENE = 'main';

// Pre-Phase-1 files, read (never written or deleted) as a fallback.
export const LEGACY_SCENE_FILE = 'forge-scene.json';
export const LEGACY_CONFIG_FILE = '.phaser-forge.json';

export const SCENE_NAME_RE = /^[A-Za-z0-9][\w-]*$/;
