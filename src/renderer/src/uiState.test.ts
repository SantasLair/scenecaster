import { describe, it, expect } from 'vitest';
import { deriveUiState } from './uiState';

const p = '/proj';
describe('deriveUiState', () => {
  it('no project: nothing is available', () => {
    const s = deriveUiState({ projectFolder: null, sceneStatus: 'open' });
    expect(s).toMatchObject({ mode: 'no-project', canvasAvailable: false, canEditScene: false, canSave: false, canRun: false });
  });
  it('project without a scene: no canvas, run allowed', () => {
    const s = deriveUiState({ projectFolder: p, sceneStatus: 'none' });
    expect(s).toMatchObject({ mode: 'no-scene', canvasAvailable: false, canEditScene: false, canSave: false, canRun: true });
  });
  it('loading keeps the canvas off', () => {
    expect(deriveUiState({ projectFolder: p, sceneStatus: 'loading' })).toMatchObject({ mode: 'loading', canvasAvailable: false });
  });
  it('blocked scene keeps the designer unavailable', () => {
    expect(deriveUiState({ projectFolder: p, sceneStatus: 'blocked' })).toMatchObject({ mode: 'scene-blocked', canvasAvailable: false, canSave: false });
  });
  it('open scene enables everything', () => {
    expect(deriveUiState({ projectFolder: p, sceneStatus: 'open' })).toMatchObject({ mode: 'scene', canvasAvailable: true, canEditScene: true, canSave: true });
  });
  it('live mode shows the canvas but is read-only', () => {
    expect(deriveUiState({ projectFolder: p, sceneStatus: 'none', live: true })).toMatchObject({ canvasAvailable: true, canEditScene: false, canSave: false });
  });
});
