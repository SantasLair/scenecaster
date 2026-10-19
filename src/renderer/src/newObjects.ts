// Default PHASEFORM objects for the things the editor can add.
import type { PfObject } from '../../shared/phaseform/types';

export type AddKind = 'container' | 'rectangle' | 'ellipse' | 'triangle' | 'text';

const SIZE = 64;
const WHITE = { color: '#ffffff', alpha: 1 };

export const ADD_LABELS: Record<AddKind, string> = {
  container: 'Container', rectangle: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', text: 'Text',
};

/** A new object of `kind` at (x, y) in its parent's space. */
export function createObject(kind: AddKind, id: string, x: number, y: number): PfObject {
  switch (kind) {
    case 'container': return { id, type: 'container', x, y, children: [] };
    case 'rectangle': return { id, type: 'rectangle', x, y, width: SIZE, height: SIZE, fill: { ...WHITE } };
    case 'ellipse': return { id, type: 'ellipse', x, y, width: SIZE, height: SIZE, fill: { ...WHITE } };
    case 'triangle': return { id, type: 'triangle', x, y, points: [{ x: SIZE / 2, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }], fill: { ...WHITE } };
    case 'text': return { id, type: 'text', x, y, text: 'Text', style: { fontSize: '32px', color: '#ffffff' } };
  }
}

/** An image object for a texture key. */
export const createImage = (id: string, key: string, x: number, y: number): PfObject => ({ id, type: 'image', key, x, y });
