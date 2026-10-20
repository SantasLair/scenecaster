import { describe, expect, it } from 'vitest';
import { joinScenes } from './sceneRegistry';

const cls = (className: string, key: string | null) => ({ className, key, path: `${className}.ts`, line: 1 });

describe('joinScenes', () => {
  it('marks each scene as layout + code, code only or layout only', () => {
    const rows = joinScenes(
      [{ key: 'menu', path: 'scenes/menu.phaseform.json' }, { key: 'old', path: 'scenes/old.phaseform.json' }],
      [cls('Menu', 'menu'), cls('Battle', 'battle'), cls('Odd', null)],
      { path: 'main.ts', sceneClasses: ['Menu', 'Battle'], width: 800, height: 600 },
    );
    expect(rows.map(r => [r.state, r.key, r.inGameConfig])).toEqual([
      ['layout+code', 'menu', true],
      ['layout-only', 'old', undefined],
      ['code-only', 'battle', true],
      ['code-only', null, false],
    ]);
  });

  it('leaves inGameConfig unknown when no game config was found', () => {
    expect(joinScenes([], [cls('A', 'a')], null)[0].inGameConfig).toBeUndefined();
  });

  it('matches one class per layout when two classes share a key', () => {
    const rows = joinScenes([{ key: 'a', path: 'a.phaseform.json' }], [cls('A1', 'a'), cls('A2', 'a')], null);
    expect(rows.map(r => [r.state, r.cls?.className])).toEqual([['layout+code', 'A1'], ['code-only', 'A2']]);
  });
});
