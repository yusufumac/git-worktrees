import { useCallback, useMemo } from "react";
import { startProcessAndWaitForReady, stopProcess } from "#/helpers/process";
import useHostAllocationStore from "#/stores/host-allocation-store";
import useProcessStore from "#/stores/process-store";
import { showToast, Toast } from "@raycast/api";
import { getPreferences } from "#/helpers/raycast";
import { DEV_SERVER_TIMEOUT_MS_MONOREPO } from "#/config/constants";
import { setupProxyRoutes, removeProxyRoutes, getProxyInfo } from "#/helpers/proxy-manager";

// Hook to monitor a dev server for a specific worktree
export function useDevServer(worktreePath: string) {
  const preferences = getPreferences() as Preferences & { proxyPorts?: string };

  // Use Zustand store for host allocations
  const { allocateHost, deallocateHost, getHostForWorktree } = useHostAllocationStore();

  // Get process info from Zustand store (reactive)
  const processInfo = useProcessStore((state) => state.getProcessInfo(worktreePath));

  // Derive state from store
  const isRunning = !!processInfo && processInfo.status === "running";

  // Extract host from process info or from allocation store
  // Always check allocation store to show host even before process info is loaded
  const host = processInfo?.host || getHostForWorktree(worktreePath);

  // Parse ports from preferences for proxy
  const configuredProxyPorts = useMemo(() => {
    const proxyPorts = preferences.proxyPorts;
    if (!proxyPorts) return [];
    return proxyPorts
      .split(",")
      .map((p: string) => parseInt(p.trim()))
      .filter((p: number) => !isNaN(p) && p > 0 && p < 65536);
  }, [preferences.proxyPorts]);

  // No cleanup effect needed - the proxy and host allocation should persist
  // across component mounts/unmounts since the dev server continues running
  // in the background. Cleanup happens when the process actually stops.

  const start = useCallback(async () => {
    let allocatedHost: string | undefined;
    try {
      // Check if dev server is already running for this worktree
      const currentProcess = useProcessStore.getState().getProcessInfo(worktreePath);
      if (currentProcess && currentProcess.status === "running") {
        await showToast({
          style: Toast.Style.Failure,
          title: "Dev Server Already Running",
          message: `Already running on ${currentProcess.host}`,
        });
        return false;
      }

      // Allocate a host for this worktree using the store
      allocatedHost = await allocateHost(worktreePath);

      await showToast({
        style: Toast.Style.Animated,
        title: "Starting Dev Server",
        message: `Allocating host ${allocatedHost}...`,
      });

      // Get full command from preferences and parse it
      const fullCommand = preferences.runScript || "pnpm run dev";
      const commandParts = fullCommand.trim().split(/\s+/);
      const command = commandParts[0];
      const args = commandParts.slice(1);

      // Start process and wait for it to be ready (use longer timeout for monorepos)
      const result = await startProcessAndWaitForReady(
        worktreePath,
        command,
        args,
        allocatedHost,
        DEV_SERVER_TIMEOUT_MS_MONOREPO,
      );

      if (result.success && result.processInfo) {
        await showToast({
          style: Toast.Style.Success,
          title: "Dev Server Started",
          message: `Running on ${allocatedHost}`,
        });

        // Start proxy if ports are configured
        if (configuredProxyPorts.length > 0) {
          try {
            // Start proxy for this dev server
            // setupProxyRoutes will handle stopping conflicting proxies internally
            await setupProxyRoutes(worktreePath, allocatedHost, configuredProxyPorts);
          } catch (error) {
            // Log proxy error but don't fail the dev server start
            console.error("Failed to setup proxy:", error);
          }
        }

        return true;
      } else {
        // Process failed to start or timed out
        const errorMessage = result.error || "Process failed to start";

        // Deallocate the host since the process failed
        if (allocatedHost) {
          await deallocateHost(worktreePath);
        }

        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to Start Dev Server",
          message: errorMessage,
        });

        // If we have a process info (started but didn't succeed), stop it
        if (result.processInfo) {
          try {
            await stopProcess(worktreePath);
          } catch {
            // Ignore error when stopping process
          }
        }
        return false;
      }
    } catch (error) {
      // Clean up host allocation if it was allocated
      if (allocatedHost) {
        await deallocateHost(worktreePath);
      }

      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Start Dev Server",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      });
      return false;
    }
  }, [worktreePath, preferences.runScript, allocateHost, deallocateHost, configuredProxyPorts]);

  const stop = useCallback(async () => {
    try {
      await stopProcess(worktreePath);

      // Stop proxy if it's running for this worktree
      const proxyInfo = await getProxyInfo(worktreePath);
      if (proxyInfo && proxyInfo.status === "active") {
        try {
          await removeProxyRoutes(worktreePath);
        } catch (error) {
          // Log proxy error but don't fail the dev server stop
          console.error("Failed to stop proxy:", error);
        }
      }

      // Deallocate the host for this worktree
      await deallocateHost(worktreePath);

      await showToast({
        style: Toast.Style.Success,
        title: "Dev Server Stopped",
        message: "Process has been terminated",
      });
      return true;
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Stop Dev Server",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      });
      return false;
    }
  }, [worktreePath, deallocateHost]);

  return {
    isRunning,
    processInfo,
    hasExternalProcess: false, // No longer tracking external processes
    host,
    start,
    stop,
  };
}

// Keep the old name for backwards compatibility (deprecated)
export const useWorktreeProcessStatus = useDevServer;
