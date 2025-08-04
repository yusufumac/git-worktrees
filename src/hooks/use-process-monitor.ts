import { useEffect, useRef } from "react";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";
import {
  detectExternalProcesses,
  cleanupOrphanedProcesses,
  getAllRunningProcesses,
  getProcessInfo,
} from "#/helpers/process";
import type { Worktree } from "#/config/types";

// Custom useInterval hook
function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void>(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    function tick() {
      if (savedCallback.current) {
        savedCallback.current();
      }
    }

    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

interface UseProcessMonitorOptions {
  worktrees?: Worktree[];
  enabled?: boolean;
  intervalMs?: number;
}

export function useProcessMonitor({
  worktrees = [],
  enabled = true,
  intervalMs = 3000, // Increased from 2000ms to reduce CPU usage
}: UseProcessMonitorOptions = {}) {
  const { updateExternalProcesses, runningProcesses, setRunningProcess, removeRunningProcess } =
    useViewingWorktreesStore();

  const isInitialized = useRef(false);
  const lastDetectionTime = useRef(0);

  // Clean up orphaned processes and run initial detection on mount
  useEffect(() => {
    if (!isInitialized.current && enabled) {
      isInitialized.current = true;
      cleanupOrphanedProcesses().catch(console.error);

      // Run initial external process detection immediately
      if (worktrees.length > 0) {
        detectExternalProcesses(worktrees.map((w) => w.path))
          .then((externalProcesses) => {
            updateExternalProcesses(externalProcesses);
            lastDetectionTime.current = Date.now();
          })
          .catch(console.error);
      }
    }
  }, [enabled, worktrees, updateExternalProcesses]);

  // Update running processes from our process manager
  useInterval(
    () => {
      if (!enabled) return;

      const currentProcesses = getAllRunningProcesses();

      // Update store with current processes
      currentProcesses.forEach((processInfo, worktreePath) => {
        const existingProcess = runningProcesses.get(worktreePath);

        if (!existingProcess || existingProcess.pid !== processInfo.pid) {
          setRunningProcess(worktreePath, processInfo);
        }
      });

      // Remove processes that are no longer running
      runningProcesses.forEach((processInfo, worktreePath) => {
        if (!currentProcesses.has(worktreePath)) {
          removeRunningProcess(worktreePath);
        }
      });
    },
    enabled ? intervalMs : null,
  );

  // Detect external processes
  useInterval(
    () => {
      if (!enabled || worktrees.length === 0) return;

      // Skip if we just ran detection (within 1 second)
      const now = Date.now();
      if (now - lastDetectionTime.current < 1000) return;

      (async () => {
        const worktreePaths = worktrees.map((w) => w.path);
        const externalProcesses = await detectExternalProcesses(worktreePaths);

        updateExternalProcesses(externalProcesses);
        lastDetectionTime.current = now;
      })();
    },
    enabled ? intervalMs * 2 : null, // Check every 6 seconds for external processes
  );
}

// Hook to monitor a specific worktree
export function useWorktreeProcessStatus(worktreePath: string) {
  const { isWorktreeRunning } = useViewingWorktreesStore();
  const isRunning = isWorktreeRunning(worktreePath);
  const processInfo = getProcessInfo(worktreePath);

  return {
    isRunning,
    processInfo,
    hasExternalProcess: !processInfo && isRunning,
  };
}
