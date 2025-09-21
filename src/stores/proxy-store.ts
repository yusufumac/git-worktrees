import { create } from "zustand";
import { LocalStorage } from "@raycast/api";
import type { ProxyState } from "#/config/types";

const PROXY_STATE_KEY = "proxy-states";

interface ProxyStoreState {
  proxyStates: Record<string, ProxyState>;
  isLoading: boolean;
  _initPromise: Promise<void> | null;
  _ensureInitialized: () => Promise<void>;
  saveProxyState: (worktreePath: string, state: ProxyState) => Promise<void>;
  removeProxyState: (worktreePath: string) => Promise<void>;
  getProxyState: (worktreePath: string) => ProxyState | null;
  getAllProxyStates: () => Promise<Record<string, ProxyState>>;
}

const useProxyStore = create<ProxyStoreState>((set, get) => ({
  proxyStates: {},
  isLoading: false,
  _initPromise: null,

  _ensureInitialized: async () => {
    // If already initializing, wait for that promise
    const existingPromise = get()._initPromise;
    if (existingPromise) {
      return existingPromise;
    }

    // Create and store the initialization promise
    const initPromise = (async () => {
      set({ isLoading: true });
      try {
        const stored = await LocalStorage.getItem<string>(PROXY_STATE_KEY);
        const proxyStates = stored ? JSON.parse(stored) : {};
        set({ proxyStates });
      } catch {
        set({ proxyStates: {} });
      } finally {
        set({ isLoading: false });
      }
    })();

    set({ _initPromise: initPromise });
    return initPromise;
  },

  saveProxyState: async (worktreePath: string, state: ProxyState) => {
    await get()._ensureInitialized();

    const updatedStates = {
      ...get().proxyStates,
      [worktreePath]: state,
    };

    set({ proxyStates: updatedStates });
    await LocalStorage.setItem(PROXY_STATE_KEY, JSON.stringify(updatedStates));
  },

  removeProxyState: async (worktreePath: string) => {
    await get()._ensureInitialized();

    const updatedStates = { ...get().proxyStates };
    delete updatedStates[worktreePath];

    set({ proxyStates: updatedStates });
    await LocalStorage.setItem(PROXY_STATE_KEY, JSON.stringify(updatedStates));
  },

  getProxyState: (worktreePath: string) => {
    // For synchronous access, return current state (may be empty initially)
    // The component using this will re-render when state updates
    const state = get();
    return state.proxyStates[worktreePath] || null;
  },

  getAllProxyStates: async () => {
    await get()._ensureInitialized();
    return get().proxyStates;
  },
}));

export default useProxyStore;
