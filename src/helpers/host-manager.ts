import useHostAllocationStore, { type HostAllocation } from "#/stores/host-allocation-store";

export type { HostAllocation };

// Helper functions that work with the store
// These are wrapper functions for backward compatibility

export async function allocateHost(worktreePath: string): Promise<string> {
  const store = useHostAllocationStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  return store.allocateHost(worktreePath);
}

export async function deallocateHost(worktreePath: string): Promise<void> {
  const store = useHostAllocationStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  return store.deallocateHost(worktreePath);
}

export async function getHostForWorktree(worktreePath: string): Promise<string | null> {
  const store = useHostAllocationStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  return store.getHostForWorktree(worktreePath);
}

export async function getAllAllocatedHosts(): Promise<Record<string, HostAllocation>> {
  const store = useHostAllocationStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  return store.allocations;
}

export async function cleanupStaleAllocations(activeWorktreePaths: string[]): Promise<void> {
  const store = useHostAllocationStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  return store.cleanupStaleAllocations(activeWorktreePaths);
}
