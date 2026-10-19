// The on-disk layout of a Scenecaster project. The folder name is defined once here; docs and
// generated files derive from it so a rename is a one-line change.
export const PROJECT_DIR = 'scenecaster';
export const SCENES_DIR = 'scenes';
export const SCENE_EXT = '.scene.json';
export const PROJECT_FILE = 'project.json';
export const EDITOR_FILE = 'editor.json';
export const DEFAULT_SCENE = 'main';

export const SCENE_NAME_RE = /^[A-Za-z0-9][\w-]*$/;
