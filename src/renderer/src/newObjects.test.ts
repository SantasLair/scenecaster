import { describe, expect, it } from 'vitest';
import { ADD_LABELS, createImage, createObject, type AddKind } from './newObjects';
import { newScene } from '../../shared/phaseform/format';
import { validateScene } from '../../shared/phaseform/validate';

describe('new objects', () => {
  it('are valid PHASEFORM for every kind the editor can add', () => {
    const kinds = Object.keys(ADD_LABELS) as AddKind[];
    const objects = [...kinds.map((k, i) => createObject(k, `${k}-1`, 10 * i, 20)), createImage('hero', 'hero', 5, 5)];
    expect(validateScene({ ...newScene('Main'), objects })).toEqual([]);
  });
});
