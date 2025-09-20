// Export all stores from a central location
export { default as useHostAllocationStore } from "./host-allocation-store";
export { default as useProcessStore } from "./process-store";
export { default as useProxyStore } from "./proxy-store";

// Export types as well
export type { HostAllocation } from "./host-allocation-store";
export type { StoredProcessData } from "./process-store";
