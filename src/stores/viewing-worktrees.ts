import { create } from "zustand";
import type { ProcessInfo } from "#/helpers/process";

type ViewingWorktreesState = {
  selectedWorktree: string | undefined;
  runningProcesses: Map<string, ProcessInfo>;
  externalProcesses: Map<string, number[]>;
};

type ViewingWorktreesActions = {
  updateSelectedWorktree: (newWorktree: string | undefined) => void;
  setRunningProcess: (worktreePath: string, processInfo: ProcessInfo) => void;
  removeRunningProcess: (worktreePath: string) => void;
  updateExternalProcesses: (processes: Map<string, number[]>) => void;
  isWorktreeRunning: (worktreePath: string) => boolean;
};

type ViewingWorktreesStore = ViewingWorktreesState & ViewingWorktreesActions;

export const useViewingWorktreesStore = create<ViewingWorktreesStore>((set, get) => ({
  selectedWorktree: undefined,
  runningProcesses: new Map(),
  externalProcesses: new Map(),

  updateSelectedWorktree: (selectedWorktree) => set({ selectedWorktree }),

  setRunningProcess: (worktreePath, processInfo) =>
    set((state) => {
      const newProcesses = new Map(state.runningProcesses);
      newProcesses.set(worktreePath, processInfo);
      return { runningProcesses: newProcesses };
    }),

  removeRunningProcess: (worktreePath) =>
    set((state) => {
      const newProcesses = new Map(state.runningProcesses);
      newProcesses.delete(worktreePath);
      return { runningProcesses: newProcesses };
    }),

  updateExternalProcesses: (processes) => set({ externalProcesses: processes }),

  isWorktreeRunning: (worktreePath) => {
    const state = get();
    return state.runningProcesses.has(worktreePath) || state.externalProcesses.has(worktreePath);
  },
}));
