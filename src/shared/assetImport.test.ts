import { describe, expect, it } from 'vitest';
import { cleanFileName, cleanSubfolder, detectAssetsFolder, importKind, suggestKey, uniqueFileName } from './assetImport';

describe('asset import rules', () => {
  it('classifies files by extension, ignoring case', () => {
    expect(importKind('Hero.PNG')).toBe('image');
    expect(importKind('boom.ogg')).toBe('audio');
    expect(importKind('atlas.json')).toBe('data');
    expect(importKind('notes.txt')).toBeNull();
    expect(importKind('noext')).toBeNull();
  });

  it('finds the assets folder in order of preference, or says where it would be created', () => {
    expect(detectAssetsFolder(d => d === 'public/assets' || d === 'assets')).toEqual({ dir: 'public/assets', exists: true });
    expect(detectAssetsFolder(d => d === 'public')).toEqual({ dir: 'public', exists: true });
    expect(detectAssetsFolder(() => false)).toEqual({ dir: 'assets', exists: false });
  });

  it('numbers a copy that would collide, ignoring case', () => {
    expect(uniqueFileName('a.png', ['b.png'])).toBe('a.png');
    expect(uniqueFileName('a.png', ['A.PNG'])).toBe('a-2.png');
    expect(uniqueFileName('a.png', ['a.png', 'a-2.png'])).toBe('a-3.png');
    expect(uniqueFileName('README', ['readme'])).toBe('README-2');
  });

  it('makes a safe name and a unique key', () => {
    expect(cleanFileName('C:\\x\\we:ird?.png')).toBe('we_ird_.png');
    expect(suggestKey('Hero Sprite (1).png', [])).toBe('Hero_Sprite_1');
    expect(suggestKey('hero.png', ['hero', 'hero_2'])).toBe('hero_3');
    expect(suggestKey('???.png', [])).toBe('asset');
  });

  it('accepts only project-relative subfolders', () => {
    expect(cleanSubfolder('sprites\\enemies/')).toBe('sprites/enemies');
    expect(cleanSubfolder('')).toBe('');
    expect(cleanSubfolder('../outside')).toBeNull();
    expect(cleanSubfolder('a/../../b')).toBeNull();
    expect(cleanSubfolder('C:/x')).toBeNull();
  });
});
