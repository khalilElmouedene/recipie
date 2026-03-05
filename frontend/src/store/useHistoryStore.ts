import { create } from "zustand";

export interface Command {
  execute(): void;
  undo(): void;
  /** Optional merge: collapses rapid consecutive same-type commands into one */
  merge?(other: Command): Command | null;
}

const MAX_HISTORY = 100;

interface HistoryState {
  past: Command[];
  future: Command[];
  execute: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  execute(cmd) {
    cmd.execute();
    set((s) => {
      const last = s.past[s.past.length - 1];
      // Attempt merge with last command
      if (last?.merge) {
        const merged = last.merge(cmd);
        if (merged) {
          const past = [...s.past.slice(0, -1), merged].slice(-MAX_HISTORY);
          return { past, future: [] };
        }
      }
      const past = [...s.past, cmd].slice(-MAX_HISTORY);
      return { past, future: [] };
    });
  },

  undo() {
    const { past, future } = get();
    if (!past.length) return;
    const cmd = past[past.length - 1];
    cmd.undo();
    set({ past: past.slice(0, -1), future: [cmd, ...future] });
  },

  redo() {
    const { past, future } = get();
    if (!future.length) return;
    const [cmd, ...rest] = future;
    cmd.execute();
    set({ past: [...past, cmd], future: rest });
  },

  clear: () => set({ past: [], future: [] }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
