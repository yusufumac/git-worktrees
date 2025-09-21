import { create } from "zustand";
import { LocalStorage } from "@raycast/api";
import type { ChildProcess } from "child_process";

const PROCESS_STORAGE_KEY = "worktree-processes";

// Load initial data from LocalStorage
const initialProcesses: Record<string, StoredProcessData> = {};

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
  host?: string;
}

export interface RunningProcess {
  process: ChildProcess;
  info: ProcessInfo;
  tailProcesses?: ChildProcess[];
}

interface ProcessState {
  processes: Record<string, StoredProcessData>;
  runningProcesses: Map<string, RunningProcess>;
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
  // Keep for backward compatibility
  initializeStore: () => Promise<void>;
}

const useProcessStore = create<ProcessState>((set, get) => ({
  processes: initialProcesses,
  runningProcesses: new Map(),

  // Keep backward compatibility - no-op since already initialized
  initializeStore: async () => {
    // No-op, already initialized on creation
  },

  getStoredProcesses: () => {
    return get().processes;
  },

  storeProcess: async (worktreePath: string, processData: StoredProcessData) => {
    const updatedProcesses = {
      ...get().processes,
      [worktreePath]: processData,
    };

    set({ processes: updatedProcesses });
    await LocalStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(updatedProcesses));
  },

  removeProcess: async (worktreePath: string) => {
    const updatedProcesses = { ...get().processes };
    delete updatedProcesses[worktreePath];

    set({ processes: updatedProcesses });
    await LocalStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(updatedProcesses));
  },

  updateProcesses: async (processes: Record<string, StoredProcessData>) => {
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

// Load initial data after store creation
(async () => {
  try {
    const stored = await LocalStorage.getItem<string>(PROCESS_STORAGE_KEY);
    if (stored) {
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
        useProcessStore.setState({ processes: converted });
      } else {
        useProcessStore.setState({ processes: data });
      }
    }
  } catch {
    // Ignore errors
  }
})();

export default useProcessStore;
