import { describe, expect, it } from 'vitest';
import { CLAUDE_POINTER, migrateText } from './migrate';
import type { PfProject } from './phaseform/types';
import { joinScenes } from './sceneRegistry';

const project = { format: 'phaseform-project', version: '0.1', name: 'tiny', entry: 'menu', scenes: [{ key: 'menu', path: 'scenes/menu.phaseform.json' }], assets: [{ key: 'hero', type: 'image' }] } as PfProject;

describe('migrateText', () => {
  it('lists scenes, unmanifested literal loads and computed loads, and ends with the CLAUDE.md pointer', () => {
    const rows = joinScenes(project.scenes, [{ className: 'Menu', key: 'menu', path: 'src/Menu.ts', line: 4 }, { className: 'Battle', key: 'battle', path: 'src/Battle.ts', line: 2 }], null);
    const text = migrateText({
      project, rows, configPath: 'src/main.ts',
      loads: [
        { method: 'image', key: 'hero', url: 'a.png', path: 'src/Menu.ts', line: 9, dynamic: false },
        { method: 'image', key: 'tree', url: 'tree.png', path: 'src/Battle.ts', line: 7, dynamic: false },
        { method: 'audio', key: null, url: null, path: 'src/Battle.ts', line: 8, dynamic: true },
      ],
    });
    expect(text).toContain('# Adopting tiny into PHASEFORM');
    expect(text).toContain('- `menu`: layout+code; class `Menu` (src/Menu.ts:4); layout `scenes/menu.phaseform.json`.');
    expect(text).toContain('- `battle`: code-only;');
    expect(text).toContain('- src/Battle.ts:7 `image` "tree" (tree.png)');
    expect(text).not.toContain('"hero"');
    expect(text).toContain('src/Battle.ts:8 `audio`');
    expect(text).toContain(CLAUDE_POINTER);
  });
});
