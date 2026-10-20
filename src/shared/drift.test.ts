import { describe, expect, it } from 'vitest';
import { driftReport, findDrift } from './drift';
import type { PfProject } from './phaseform/types';
import { joinScenes } from './sceneRegistry';

const project = {
  format: 'phaseform-project', version: '0.1', name: 'g', entry: 'menu',
  scenes: [{ key: 'menu', path: 'scenes/menu.phaseform.json' }, { key: 'old', path: 'scenes/old.phaseform.json' }],
  assets: [{ key: 'hero', type: 'image', url: 'assets/hero.png' }, { key: 'gone', type: 'image', url: 'assets/gone.png' }],
} as PfProject;
const cls = (className: string, key: string | null) => ({ className, key, path: `${className}.ts`, line: 3 });

describe('findDrift', () => {
  it('reports each kind of disagreement and skips what cannot be compared', () => {
    const rows = joinScenes(project.scenes, [cls('Menu', 'menu'), cls('Battle', 'battle'), cls('Odd', null)], null);
    const loads = [
      { method: 'image', key: 'hero', url: 'assets/hero.png', path: 'a.ts', line: 1, dynamic: false },
      { method: 'image', key: 'tree', url: 'assets/tree.png', path: 'a.ts', line: 2, dynamic: false },
      { method: 'image', key: null, url: null, path: 'a.ts', line: 3, dynamic: true },
    ];
    const items = findDrift(project, rows, loads, new Set(['assets/gone.png']));
    expect(items.map(i => i.kind)).toEqual(['layout-without-scene-class', 'scene-class-without-layout', 'asset-not-in-manifest', 'manifest-file-missing']);
    expect(items[3].message).toContain('gone');
  });

  it('gives a clean report when nothing drifted', () => {
    expect(findDrift(project, [], [], new Set())).toEqual([]);
    expect(driftReport([])).toMatch(/No drift/);
    expect(driftReport([{ kind: 'manifest-file-missing', message: 'x' }])).toContain('- x');
  });
});
