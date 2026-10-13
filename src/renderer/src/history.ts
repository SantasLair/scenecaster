// Command-based undo/redo. Callers perform the change themselves, then push how to undo and redo it.
import { create } from 'zustand';

export interface Command {
  undo: () => void;
  redo: () => void;
}

interface HistoryState {
  past: Command[];
  future: Command[];
}

const MAX_HISTORY = 100;

export const useHistory = create<HistoryState>(() => ({ past: [], future: [] }));
const get = useHistory.getState;
const set = useHistory.setState;

/** Records a change that has already been applied. Clears redo. */
export function push(cmd: Command) {
  set({ past: [...get().past, cmd].slice(-MAX_HISTORY), future: [] });
}

export function undo() {
  const cmd = get().past.at(-1);
  if (!cmd) return;
  set({ past: get().past.slice(0, -1), future: [cmd, ...get().future] });
  cmd.undo();
}

export function redo() {
  const cmd = get().future[0];
  if (!cmd) return;
  set({ past: [...get().past, cmd], future: get().future.slice(1) });
  cmd.redo();
}

export function clear() { set({ past: [], future: [] }); }
