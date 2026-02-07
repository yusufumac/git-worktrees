import { useCallback, useState, useEffect } from "react";
import { showToast, Toast } from "@raycast/api";
import {
  startServer,
  stopServer,
  listServers,
  type ServerInfo,
} from "#/helpers/wt-serve-client";

const serverCache = new Map<string, { servers: ServerInfo[]; timestamp: number }>();
const CACHE_TTL = 2000;

async function fetchServers(): Promise<ServerInfo[]> {
  const cached = serverCache.get("all");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.servers;
  const servers = await listServers();
  serverCache.set("all", { servers, timestamp: Date.now() });
  return servers;
}

export function useDevServer(worktreePath: string) {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const servers = await fetchServers();
        const match = servers.find((s) => s.worktreePath === worktreePath);
        if (active) setServerInfo(match ?? null);
      } catch {
        if (active) setServerInfo(null);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [worktreePath]);

  const isRunning = serverInfo?.status === "running";
  const host = serverInfo?.host ?? null;

  const start = useCallback(async () => {
    try {
      if (isRunning) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Dev Server Already Running",
          message: `Already running on ${host}`,
        });
        return false;
      }

      await showToast({
        style: Toast.Style.Animated,
        title: "Starting Dev Server",
      });

      const result = await startServer({ worktreePath });

      if (result.status === "running") {
        setServerInfo({ ...result, uptime: 0, proxy: null, worktreePath } as ServerInfo);
        await showToast({
          style: Toast.Style.Success,
          title: "Dev Server Started",
          message: `Running on ${result.host}`,
        });
        return true;
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to Start Dev Server",
          message: result.error || "Process failed to start",
        });
        return false;
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Start Dev Server",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      });
      return false;
    }
  }, [worktreePath, isRunning, host]);

  const stop = useCallback(async () => {
    try {
      await stopServer(worktreePath);
      setServerInfo(null);
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
  }, [worktreePath]);

  return {
    isRunning,
    processInfo: serverInfo,
    hasExternalProcess: false,
    host,
    start,
    stop,
  };
}

export const useWorktreeProcessStatus = useDevServer;
