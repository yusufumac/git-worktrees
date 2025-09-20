import { create } from "zustand";
import { LocalStorage } from "@raycast/api";
import type { ProxyState } from "#/config/types";

const PROXY_STATE_KEY = "proxy-states";

interface ProxyStoreState {
  proxyStates: Record<string, ProxyState>;
  isLoading: boolean;
  isInitialized: boolean;
  initializeStore: () => Promise<void>;
  saveProxyState: (worktreePath: string, state: ProxyState) => Promise<void>;
  removeProxyState: (worktreePath: string) => Promise<void>;
  getProxyState: (worktreePath: string) => ProxyState | null;
  getAllProxyStates: () => Record<string, ProxyState>;
}

const useProxyStore = create<ProxyStoreState>((set, get) => ({
  proxyStates: {},
  isLoading: false,
  isInitialized: false,

  initializeStore: async () => {
    if (get().isInitialized) return;

    set({ isLoading: true });
    try {
      const stored = await LocalStorage.getItem<string>(PROXY_STATE_KEY);
      const proxyStates = stored ? JSON.parse(stored) : {};
      set({ proxyStates, isInitialized: true });
    } catch {
      set({ proxyStates: {}, isInitialized: true });
    } finally {
      set({ isLoading: false });
    }
  },

  saveProxyState: async (worktreePath: string, state: ProxyState) => {
    const currentState = get();

    // Ensure store is initialized
    if (!currentState.isInitialized) {
      await currentState.initializeStore();
    }

    const updatedStates = {
      ...get().proxyStates,
      [worktreePath]: state,
    };

    set({ proxyStates: updatedStates });
    await LocalStorage.setItem(PROXY_STATE_KEY, JSON.stringify(updatedStates));
  },

  removeProxyState: async (worktreePath: string) => {
    const currentState = get();

    // Ensure store is initialized
    if (!currentState.isInitialized) {
      await currentState.initializeStore();
    }

    const updatedStates = { ...get().proxyStates };
    delete updatedStates[worktreePath];

    set({ proxyStates: updatedStates });
    await LocalStorage.setItem(PROXY_STATE_KEY, JSON.stringify(updatedStates));
  },

  getProxyState: (worktreePath: string) => {
    const state = get();
    return state.proxyStates[worktreePath] || null;
  },

  getAllProxyStates: () => {
    return get().proxyStates;
  },
}));

export default useProxyStore;
