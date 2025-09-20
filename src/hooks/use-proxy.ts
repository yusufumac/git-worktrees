import { useEffect, useState, useCallback, useMemo } from "react";
import { showToast, Toast } from "@raycast/api";
import { getPreferences } from "#/helpers/raycast";
import { getHostForWorktree } from "#/helpers/host-manager";
import { setupProxyRoutes, removeProxyRoutes, getProxyInfo, isProxyServerInstalled } from "#/helpers/proxy-manager";

export function useProxy(worktreePath: string) {
  const preferences = getPreferences() as Preferences & { proxyPorts?: string };
  const [isProxying, setIsProxying] = useState(false);
  const [proxiedPorts, setProxiedPorts] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Parse ports from preferences
  const configuredPorts = useMemo(() => {
    const proxyPorts = preferences.proxyPorts;
    if (!proxyPorts) return [];
    return proxyPorts
      .split(",")
      .map((p: string) => parseInt(p.trim()))
      .filter((p: number) => !isNaN(p) && p > 0 && p < 65536);
  }, [preferences.proxyPorts]);

  // Check proxy status on mount and periodically
  useEffect(() => {
    const checkProxyStatus = async () => {
      const proxyInfo = await getProxyInfo(worktreePath);
      if (proxyInfo && proxyInfo.status === "active") {
        setIsProxying(true);
        setProxiedPorts(proxyInfo.ports);
      } else {
        setIsProxying(false);
        setProxiedPorts([]);
      }
    };

    checkProxyStatus();
    const interval = setInterval(checkProxyStatus, 2000);
    return () => clearInterval(interval);
  }, [worktreePath]);

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

    const host = await getHostForWorktree(worktreePath);
    if (!host) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Dev Server Not Running",
        message: "Start the dev server first",
      });
      return false;
    }

    setIsLoading(true);
    try {
      const success = await setupProxyRoutes(worktreePath, host, configuredPorts);
      if (success) {
        setIsProxying(true);
        setProxiedPorts(configuredPorts);
      }
      return success;
    } finally {
      setIsLoading(false);
    }
  }, [worktreePath, configuredPorts]);

  const stopProxy = useCallback(async () => {
    setIsLoading(true);
    try {
      const success = await removeProxyRoutes(worktreePath);
      if (success) {
        setIsProxying(false);
        setProxiedPorts([]);
      }
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
