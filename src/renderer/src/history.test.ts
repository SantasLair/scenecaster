import { beforeEach, expect, it } from 'vitest';
import * as history from './history';

let value = 0;
const change = (to: number) => {
  const from = value;
  value = to;
  history.push({ undo: () => { value = from; }, redo: () => { value = to; } });
};

beforeEach(() => { value = 0; history.clear(); });

it('undoes and redoes in order', () => {
  change(1); change(2);
  history.undo(); expect(value).toBe(1);
  history.undo(); expect(value).toBe(0);
  history.undo(); expect(value).toBe(0);
  history.redo(); history.redo(); expect(value).toBe(2);
});

it('a new change clears redo', () => {
  change(1); history.undo(); change(5);
  history.redo();
  expect(value).toBe(5);
});

it('keeps at most 100 steps', () => {
  for (let i = 1; i <= 120; i++) change(i);
  expect(history.useHistory.getState().past).toHaveLength(100);
});
