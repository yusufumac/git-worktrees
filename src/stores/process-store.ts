import { create } from "zustand";
import { LocalStorage } from "@raycast/api";
import type { ChildProcess } from "child_process";

const PROCESS_STORAGE_KEY = "worktree-processes";

export interface StoredProcessData {
  pid: number;
  command: string;
  args: string[];
  outputFile?: string;
  errorFile?: string;
  startTime: string;
  host?: string;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startTime: Date;
  outputBuffer: string[];
  errorBuffer: string[];
  status: "running" | "stopped" | "error";
  outputFile?: string;
  errorFile?: string;
}

export interface RunningProcess {
  process: ChildProcess;
  info: ProcessInfo;
  tailProcesses?: ChildProcess[];
}

interface ProcessState {
  processes: Record<string, StoredProcessData>;
  runningProcesses: Map<string, RunningProcess>;
  isLoading: boolean;
  isInitialized: boolean;
  initializeStore: () => Promise<void>;
  getStoredProcesses: () => Record<string, StoredProcessData>;
  storeProcess: (worktreePath: string, processData: StoredProcessData) => Promise<void>;
  removeProcess: (worktreePath: string) => Promise<void>;
  updateProcesses: (processes: Record<string, StoredProcessData>) => Promise<void>;
  // New methods for reactive process tracking
  setRunningProcess: (worktreePath: string, processData: RunningProcess) => void;
  removeRunningProcess: (worktreePath: string) => void;
  getRunningProcess: (worktreePath: string) => RunningProcess | undefined;
  getProcessInfo: (worktreePath: string) => ProcessInfo | null;
  getAllRunningProcesses: () => Map<string, ProcessInfo>;
}

const useProcessStore = create<ProcessState>((set, get) => ({
  processes: {},
  runningProcesses: new Map(),
  isLoading: false,
  isInitialized: false,

  initializeStore: async () => {
    if (get().isInitialized) return;

    set({ isLoading: true });
    try {
      const stored = await LocalStorage.getItem<string>(PROCESS_STORAGE_KEY);
      if (!stored) {
        set({ processes: {}, isInitialized: true });
        return;
      }

      const data = JSON.parse(stored);
      // Handle legacy format (just PIDs)
      if (typeof Object.values(data)[0] === "number") {
        // Convert legacy format to new format
        const converted: Record<string, StoredProcessData> = {};
        for (const [path, pid] of Object.entries(data)) {
          converted[path] = {
            pid: pid as number,
            command: "unknown",
            args: [],
            startTime: new Date().toISOString(),
          };
        }
        set({ processes: converted, isInitialized: true });
      } else {
        set({ processes: data, isInitialized: true });
      }
    } catch {
      set({ processes: {}, isInitialized: true });
    } finally {
      set({ isLoading: false });
    }
  },

  getStoredProcesses: () => {
    const state = get();
    if (!state.isInitialized) {
      // If not initialized, return empty object
      // The caller should ensure initialization
      return {};
    }
    return state.processes;
  },

  storeProcess: async (worktreePath: string, processData: StoredProcessData) => {
    const state = get();

    // Ensure store is initialized
    if (!state.isInitialized) {
      await state.initializeStore();
    }

    const updatedProcesses = {
      ...get().processes,
      [worktreePath]: processData,
    };

    set({ processes: updatedProcesses });
    await LocalStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(updatedProcesses));
  },

  removeProcess: async (worktreePath: string) => {
    const state = get();

    // Ensure store is initialized
    if (!state.isInitialized) {
      await state.initializeStore();
    }

    const updatedProcesses = { ...get().processes };
    delete updatedProcesses[worktreePath];

    set({ processes: updatedProcesses });
    await LocalStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(updatedProcesses));
  },

  updateProcesses: async (processes: Record<string, StoredProcessData>) => {
    const state = get();

    // Ensure store is initialized
    if (!state.isInitialized) {
      await state.initializeStore();
    }

    set({ processes });
    await LocalStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(processes));
  },

  // New methods for reactive process tracking
  setRunningProcess: (worktreePath: string, processData: RunningProcess) => {
    const newMap = new Map(get().runningProcesses);
    newMap.set(worktreePath, processData);
    set({ runningProcesses: newMap });
  },

  removeRunningProcess: (worktreePath: string) => {
    const newMap = new Map(get().runningProcesses);
    newMap.delete(worktreePath);
    set({ runningProcesses: newMap });
  },

  getRunningProcess: (worktreePath: string) => {
    return get().runningProcesses.get(worktreePath);
  },

  getProcessInfo: (worktreePath: string) => {
    const running = get().runningProcesses.get(worktreePath);
    return running?.info || null;
  },

  getAllRunningProcesses: () => {
    const result = new Map<string, ProcessInfo>();
    get().runningProcesses.forEach((value, key) => {
      result.set(key, value.info);
    });
    return result;
  },
}));

export default useProcessStore;
