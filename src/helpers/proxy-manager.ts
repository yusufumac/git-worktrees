import { showToast, Toast } from "@raycast/api";
import { PROXY_ADMIN_PORT } from "#/config/constants";
import type { ProxyState } from "#/config/types";
import useProxyStore from "#/stores/proxy-store";

// Check if Caddy API is accessible
export async function isProxyServerInstalled(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${PROXY_ADMIN_PORT}/config/`, {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Create a unique ID for worktree
function getWorktreeId(worktreePath: string): string {
  return Buffer.from(worktreePath)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "");
}

// Setup proxy routes for a worktree
export async function setupProxyRoutes(worktreePath: string, targetHost: string, ports: number[]): Promise<boolean> {
  // Check if Caddy API is accessible
  const isAccessible = await isProxyServerInstalled();
  if (!isAccessible) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Caddy Server Not Running",
      message: "Please ensure Caddy is running on port 2019",
    });
    return false;
  }

  // First, check if any other worktree is using the same ports and remove them
  const allStates = await getAllProxyStates();
  for (const [otherWorktreePath, state] of Object.entries(allStates)) {
    if (otherWorktreePath !== worktreePath && state.status === "active") {
      const conflictingPorts = state.ports.filter(p => ports.includes(p));
      if (conflictingPorts.length > 0) {
        // Remove the proxy for the other worktree
        await removeProxyRoutes(otherWorktreePath);
      }
    }
  }

  const worktreeId = getWorktreeId(worktreePath);
  const serverIds: string[] = [];

  try {
    for (const port of ports) {
      const serverId = `srv_${worktreeId}_${port}`;
      serverIds.push(serverId);

      const serverConfig = {
        listen: [`:${port}`],
        routes: [
          {
            handle: [
              {
                handler: "reverse_proxy",
                upstreams: [{ dial: `${targetHost}:${port}` }],
                headers: {
                  request: {
                    set: {
                      "X-Forwarded-Host": ["localhost"],
                    },
                  },
                },
              },
            ],
          },
        ],
      };

      const response = await fetch(`http://localhost:${PROXY_ADMIN_PORT}/config/apps/http/servers/${serverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverConfig),
      });

      if (!response.ok) {
        throw new Error(`Failed to configure port ${port}: ${response.statusText}`);
      }
    }

    // Save proxy state
    await saveProxyState(worktreePath, {
      worktreePath,
      targetHost,
      ports,
      status: "active",
      caddyServerIds: serverIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await showToast({
      style: Toast.Style.Success,
      title: "Proxy Enabled",
    });

    return true;
  } catch (error) {
    // Clean up any partially configured servers
    for (const serverId of serverIds) {
      try {
        await fetch(`http://localhost:${PROXY_ADMIN_PORT}/config/apps/http/servers/${serverId}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to Setup Proxy",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

// Remove proxy routes for a worktree
export async function removeProxyRoutes(worktreePath: string): Promise<boolean> {
  const state = await getProxyState(worktreePath);
  if (!state) {
    return false;
  }

  const worktreeId = getWorktreeId(worktreePath);

  try {
    for (const port of state.ports) {
      const serverId = `srv_${worktreeId}_${port}`;
      await fetch(`http://localhost:${PROXY_ADMIN_PORT}/config/apps/http/servers/${serverId}`, {
        method: "DELETE",
      });
    }

    await removeProxyState(worktreePath);

    await showToast({
      style: Toast.Style.Success,
      title: "Proxy Disabled",
      message: "Localhost proxy has been removed",
    });

    return true;
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to Remove Proxy",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

// Get proxy state for a worktree
export async function getProxyState(worktreePath: string): Promise<ProxyState | null> {
  const allStates = await getAllProxyStates();
  return allStates[worktreePath] || null;
}

// Get proxy info for a worktree
export async function getProxyInfo(worktreePath: string): Promise<ProxyState | null> {
  return getProxyState(worktreePath);
}

// Save proxy state
async function saveProxyState(worktreePath: string, state: ProxyState): Promise<void> {
  const store = useProxyStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  await store.saveProxyState(worktreePath, state);
}

// Remove proxy state
async function removeProxyState(worktreePath: string): Promise<void> {
  const store = useProxyStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  await store.removeProxyState(worktreePath);
}

// Get all proxy states
async function getAllProxyStates(): Promise<Record<string, ProxyState>> {
  const store = useProxyStore.getState();
  // Ensure store is initialized
  if (!store.isInitialized) {
    await store.initializeStore();
  }
  return store.getAllProxyStates();
}

// Stop all active proxies
export async function stopAllProxies(): Promise<void> {
  const allStates = await getAllProxyStates();
  for (const [worktreePath, state] of Object.entries(allStates)) {
    if (state.status === "active") {
      await removeProxyRoutes(worktreePath);
    }
  }
}
