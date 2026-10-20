import { describe, expect, it } from 'vitest';
import { literal, scanAssetLoads, scanGameConfig, scanSceneClasses, stripComments } from './codeScan';

const f = (path: string, text: string) => ({ path, text });

describe('scene classes', () => {
  it('finds classes and their keys in the shapes the real games use', () => {
    const scenes = scanSceneClasses([
      f('a.ts', `export class MapScene extends Phaser.Scene {\n  constructor() {\n    super('map');\n  }\n}`),
      f('b.js', `class Boot extends Scene { constructor() { super({ key: "Boot", active: true }); } }`),
      f('c.ts', `class Odd extends Phaser.Scene { constructor() { super(SCENE_KEYS.odd); } }`),
      f('d.ts', `class NotAScene extends Base { constructor() { super('x'); } }`),
    ]);
    expect(scenes).toEqual([
      { className: 'MapScene', key: 'map', path: 'a.ts', line: 1 },
      { className: 'Boot', key: 'Boot', path: 'b.js', line: 1 },
      { className: 'Odd', key: null, path: 'c.ts', line: 1 },
    ]);
  });

  it('ignores commented-out code and keeps line numbers', () => {
    const text = `// class Old extends Phaser.Scene { super('old') }\n/* class Older extends Phaser.Scene {\n super('older') } */\nclass Live extends Phaser.Scene { constructor() { super('live'); } }`;
    expect(scanSceneClasses([f('x.js', text)])).toEqual([{ className: 'Live', key: 'live', path: 'x.js', line: 4 }]);
    expect(stripComments('a // b\nc').split('\n').length).toBe(2);
    expect(stripComments(`const u = 'http://x.test'; // gone`)).toBe(`const u = 'http://x.test'; `);
  });
});

describe('asset loads', () => {
  it('reads literal loads and flags computed ones', () => {
    const loads = scanAssetLoads([f('g.ts', [
      `this.load.image('hero', 'assets/hero.png');`,
      "scene.load.spritesheet(baseKey(type), `assets/units/${type}.png`, frame);",
      "this.load.json('world', `${base}assets/world.json`);",
      "this.load.atlas('ui', \"assets/ui.png\", 'assets/ui.json');",
      `for (const [key, sheet] of Object.entries(SHEETS)) this.load.image(key, sheet.path);`,
      `this.load.on('progress', cb);`,
    ].join('\n'))]);
    expect(loads.map(l => [l.method, l.key, l.url, l.dynamic])).toEqual([
      ['image', 'hero', 'assets/hero.png', false],
      ['spritesheet', null, null, true],
      ['json', 'world', null, true],
      ['atlas', 'ui', 'assets/ui.png', false],
      ['image', null, null, true],
    ]);
    expect(loads[0].line).toBe(1);
  });

  it('copes with nested parentheses and an unterminated call', () => {
    const l = scanAssetLoads([f('x.js', `this.load.image(pick('a', 'b'), 'p.png');\nthis.load.image('k'`)]);
    expect(l[0]).toMatchObject({ key: null, url: 'p.png', dynamic: true });
    expect(l[1]).toMatchObject({ key: null, dynamic: true });
  });

  it('only counts plain string literals', () => {
    expect(literal(` 'a b' `)).toBe('a b');
    expect(literal('`plain`')).toBe('plain');
    expect(literal('`x${y}`')).toBeNull();
    expect(literal('name')).toBeNull();
    expect(literal(undefined)).toBeNull();
  });
});

describe('game config', () => {
  it('reads the scene list and size', () => {
    const cfg = scanGameConfig([f('m.ts', `new Phaser.Game({\n  type: Phaser.AUTO,\n  width: 1280,\n  height: 720,\n  scene: [MapScene, UIScene, BattleScene],\n});`)]);
    expect(cfg).toEqual({ path: 'm.ts', sceneClasses: ['MapScene', 'UIScene', 'BattleScene'], width: 1280, height: 720 });
  });

  it('handles a single scene, a computed size and no game', () => {
    expect(scanGameConfig([f('m.js', `const game = new Phaser.Game({ width: W, height: 600, scene: MapScene });`)]))
      .toEqual({ path: 'm.js', sceneClasses: ['MapScene'], width: null, height: 600 });
    expect(scanGameConfig([f('n.js', `const x = 1;`)])).toBeNull();
  });

  it('prefers the game with the most scenes over a one-scene preview tool', () => {
    const cfg = scanGameConfig([
      f('preview.ts', `new Phaser.Game({ scene: [PreviewScene] });`),
      f('main.ts', `new Phaser.Game({ scene: [MapScene, UIScene] });`),
    ]);
    expect(cfg?.path).toBe('main.ts');
  });
});
