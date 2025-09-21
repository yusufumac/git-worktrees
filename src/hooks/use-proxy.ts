import { useState, useCallback, useMemo } from "react";
import { showToast, Toast } from "@raycast/api";
import { getPreferences } from "#/helpers/raycast";
import { setupProxyRoutes, removeProxyRoutes, isProxyServerInstalled } from "#/helpers/proxy-manager";
import useProxyStore from "#/stores/proxy-store";
import useProcessStore from "#/stores/process-store";

export function useProxy(worktreePath: string) {
  const preferences = getPreferences() as Preferences & { proxyPorts?: string };
  const [isLoading, setIsLoading] = useState(false);

  // Get proxy state from Zustand store
  const proxyState = useProxyStore((state) => state.getProxyState(worktreePath));

  // Parse ports from preferences
  const configuredPorts = useMemo(() => {
    const proxyPorts = preferences.proxyPorts;
    if (!proxyPorts) return [];
    return proxyPorts
      .split(",")
      .map((p: string) => parseInt(p.trim()))
      .filter((p: number) => !isNaN(p) && p > 0 && p < 65536);
  }, [preferences.proxyPorts]);

  // Derive state from store
  const isProxying = proxyState?.status === "active" || false;
  const proxiedPorts = proxyState?.ports || [];

  const startProxy = useCallback(async () => {
    if (configuredPorts.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Ports Configured",
        message: "Please configure proxy ports in extension preferences",
      });
      return false;
    }

    // Check if Caddy API is accessible
    const isAccessible = await isProxyServerInstalled();
    if (!isAccessible) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Caddy Not Running",
        message: "Please ensure Caddy server is running on port 2019",
      });
      return false;
    }

    // Check if dev server is running and get its host
    const currentProcessInfo = useProcessStore.getState().getProcessInfo(worktreePath);
    if (!currentProcessInfo || currentProcessInfo.status !== "running" || !currentProcessInfo.host) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Dev Server Not Running",
        message: "Start the dev server first",
      });
      return false;
    }

    const host = currentProcessInfo.host;

    setIsLoading(true);
    try {
      const success = await setupProxyRoutes(worktreePath, host, configuredPorts);
      // Store update is handled in setupProxyRoutes
      return success;
    } finally {
      setIsLoading(false);
    }
  }, [worktreePath, configuredPorts]);

  const stopProxy = useCallback(async () => {
    setIsLoading(true);
    try {
      const success = await removeProxyRoutes(worktreePath);
      // Store update is handled in removeProxyRoutes
      return success;
    } finally {
      setIsLoading(false);
    }
  }, [worktreePath]);

  return {
    isProxying,
    proxiedPorts,
    configuredPorts,
    isLoading,
    startProxy,
    stopProxy,
  };
}
