import { create } from "zustand";
import { LocalStorage } from "@raycast/api";

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

interface ProcessState {
  processes: Record<string, StoredProcessData>;
  isLoading: boolean;
  isInitialized: boolean;
  initializeStore: () => Promise<void>;
  getStoredProcesses: () => Record<string, StoredProcessData>;
  storeProcess: (worktreePath: string, processData: StoredProcessData) => Promise<void>;
  removeProcess: (worktreePath: string) => Promise<void>;
  updateProcesses: (processes: Record<string, StoredProcessData>) => Promise<void>;
}

const useProcessStore = create<ProcessState>((set, get) => ({
  processes: {},
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
}));

export default useProcessStore;
