import { create } from "zustand";
import { LocalStorage } from "@raycast/api";
import type { ProxyState } from "#/config/types";

const PROXY_STATE_KEY = "proxy-states";

// Load initial data from LocalStorage synchronously if possible, async as fallback
const initialProxyStates: Record<string, ProxyState> = {};

interface ProxyStoreState {
  proxyStates: Record<string, ProxyState>;
  saveProxyState: (worktreePath: string, state: ProxyState) => Promise<void>;
  removeProxyState: (worktreePath: string) => Promise<void>;
  getProxyState: (worktreePath: string) => ProxyState | null;
  getAllProxyStates: () => Record<string, ProxyState>;
}

const useProxyStore = create<ProxyStoreState>((set, get) => ({
  proxyStates: initialProxyStates,

  saveProxyState: async (worktreePath: string, state: ProxyState) => {
    const updatedStates = {
      ...get().proxyStates,
      [worktreePath]: state,
    };

    set({ proxyStates: updatedStates });
    await LocalStorage.setItem(PROXY_STATE_KEY, JSON.stringify(updatedStates));
  },

  removeProxyState: async (worktreePath: string) => {
    const updatedStates = { ...get().proxyStates };
    delete updatedStates[worktreePath];

    set({ proxyStates: updatedStates });
    await LocalStorage.setItem(PROXY_STATE_KEY, JSON.stringify(updatedStates));
  },

  getProxyState: (worktreePath: string) => {
    return get().proxyStates[worktreePath] || null;
  },

  getAllProxyStates: () => {
    return get().proxyStates;
  },
}));

// Load initial data after store creation
(async () => {
  try {
    const stored = await LocalStorage.getItem<string>(PROXY_STATE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      useProxyStore.setState({ proxyStates: parsed });
    }
  } catch {
    // Ignore errors
  }
})();

export default useProxyStore;
