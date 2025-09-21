import { create } from "zustand";
import { LocalStorage } from "@raycast/api";

const HOST_ALLOCATION_KEY = "worktree-host-allocations";
const BASE_HOST = "127.0.0.";
const START_HOST_INDEX = 2;
const MAX_HOST_INDEX = 255;

// Load initial data from LocalStorage
const initialAllocations: Record<string, HostAllocation> = {};

export interface HostAllocation {
  host: string;
  worktreePath: string;
  allocatedAt: string;
}

interface HostAllocationState {
  allocations: Record<string, HostAllocation>;
  allocateHost: (worktreePath: string) => Promise<string>;
  deallocateHost: (worktreePath: string) => Promise<void>;
  getHostForWorktree: (worktreePath: string) => string | null;
  cleanupStaleAllocations: (activeWorktreePaths: string[]) => Promise<void>;
  // Keep for backward compatibility
  initializeStore: () => Promise<void>;
}

const useHostAllocationStore = create<HostAllocationState>((set, get) => ({
  allocations: initialAllocations,

  // Keep for backward compatibility - no-op since already initialized
  initializeStore: async () => {
    // No-op, already initialized on creation
  },

  allocateHost: async (worktreePath: string) => {
    const currentAllocations = get().allocations;

    // Check if already allocated
    const existing = currentAllocations[worktreePath];
    if (existing) {
      return existing.host;
    }

    // Find an available host
    const usedHosts = new Set(Object.values(currentAllocations).map((a) => a.host));

    for (let i = START_HOST_INDEX; i <= MAX_HOST_INDEX; i++) {
      const host = `${BASE_HOST}${i}`;
      if (!usedHosts.has(host)) {
        const newAllocation: HostAllocation = {
          host,
          worktreePath,
          allocatedAt: new Date().toISOString(),
        };

        const updatedAllocations = {
          ...currentAllocations,
          [worktreePath]: newAllocation,
        };

        // Update state
        set({ allocations: updatedAllocations });

        // Persist to LocalStorage
        await LocalStorage.setItem(HOST_ALLOCATION_KEY, JSON.stringify(updatedAllocations));

        return host;
      }
    }

    throw new Error("No available hosts. Maximum number of dev servers reached.");
  },

  deallocateHost: async (worktreePath: string) => {
    const currentAllocations = { ...get().allocations };
    delete currentAllocations[worktreePath];

    // Update state
    set({ allocations: currentAllocations });

    // Persist to LocalStorage
    await LocalStorage.setItem(HOST_ALLOCATION_KEY, JSON.stringify(currentAllocations));
  },

  getHostForWorktree: (worktreePath: string) => {
    const state = get();
    return state.allocations[worktreePath]?.host || null;
  },

  cleanupStaleAllocations: async (activeWorktreePaths: string[]) => {
    const currentAllocations = { ...get().allocations };
    const activePathsSet = new Set(activeWorktreePaths);

    let hasChanges = false;
    for (const path of Object.keys(currentAllocations)) {
      if (!activePathsSet.has(path)) {
        delete currentAllocations[path];
        hasChanges = true;
      }
    }

    if (hasChanges) {
      // Update state
      set({ allocations: currentAllocations });

      // Persist to LocalStorage
      await LocalStorage.setItem(HOST_ALLOCATION_KEY, JSON.stringify(currentAllocations));
    }
  },
}));

// Load initial data after store creation
(async () => {
  try {
    const stored = await LocalStorage.getItem<string>(HOST_ALLOCATION_KEY);
    if (stored) {
      useHostAllocationStore.setState({ allocations: JSON.parse(stored) });
    }
  } catch {
    // Ignore errors
  }
})();

export default useHostAllocationStore;
