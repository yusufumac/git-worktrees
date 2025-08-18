import { Action, Icon, showToast, Toast } from "@raycast/api";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";
import {
  stopProcess,
  detectExternalProcesses,
  killAllWorktreeDevServers,
  getAllWorktreePaths,
  startProcessAndWaitForReady,
} from "#/helpers/process";
import { withToast } from "#/helpers/toast";
import { getPreferences } from "#/helpers/raycast";
import type { Worktree } from "#/config/types";

interface RunWorktreeProps {
  worktree: Worktree;
  onProcessStart?: () => void;
  onProcessStop?: () => void;
}

export const RunWorktree = ({ worktree, onProcessStart, onProcessStop }: RunWorktreeProps) => {
  const { setRunningProcess, removeRunningProcess, isWorktreeRunning, updateExternalProcesses } =
    useViewingWorktreesStore();
  const isRunning = isWorktreeRunning(worktree.path);
  const preferences = getPreferences();

  // Get full command from preferences and parse it
  const fullCommand = preferences.defaultRunCommand || "pnpm run dev";
  const commandParts = fullCommand.trim().split(/\s+/);
  const command = commandParts[0];
  const args = commandParts.slice(1);

  const handleRun = async () => {
    try {
      await showToast({
        style: Toast.Style.Animated,
        title: "Starting Dev Server",
        message: "Waiting for server to be ready...",
      });

      // Get all worktree paths and kill dev servers in them (except current one)
      const worktreePaths = await getAllWorktreePaths();
      const killedCount = await killAllWorktreeDevServers(worktreePaths, worktree.path);

      if (killedCount > 0) {
        await showToast({
          style: Toast.Style.Animated,
          title: "Switching Dev Server",
          message: `Stopped ${killedCount} other worktree dev server${killedCount > 1 ? "s" : ""}`,
        });
      }

      // Also clean up our internal state for any processes we were tracking
      const { runningProcesses } = useViewingWorktreesStore.getState();
      for (const [path] of runningProcesses) {
        if (path !== worktree.path) {
          removeRunningProcess(path);
        }
      }

      // Start process and wait for it to be ready
      const result = await startProcessAndWaitForReady(worktree.path, command, args);

      if (result.success && result.processInfo) {
        setRunningProcess(worktree.path, result.processInfo);
        onProcessStart?.();

        // Refresh external process detection immediately
        setTimeout(async () => {
          const externalProcesses = await detectExternalProcesses([worktree.path]);
          updateExternalProcesses(externalProcesses);
        }, 100);

        await showToast({
          style: Toast.Style.Success,
          title: "Dev Server Started",
          message: `${worktree.branch} is now running`,
        });
      } else {
        // Process failed to start or timed out
        const errorMessage = result.error || "Process failed to start";

        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to Start Dev Server",
          message: errorMessage,
        });

        // If we have a process info (started but didn't succeed), stop it
        if (result.processInfo) {
          try {
            await stopProcess(worktree.path);
          } catch {
            // Ignore error when stopping process
          }
        }
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Start Process",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  const handleStop = async () => {
    try {
      await stopProcess(worktree.path);
      removeRunningProcess(worktree.path);
      onProcessStop?.();

      // Refresh external process detection immediately
      setTimeout(async () => {
        const externalProcesses = await detectExternalProcesses([worktree.path]);
        updateExternalProcesses(externalProcesses);
      }, 100); // Small delay to ensure process is fully stopped

      await showToast({
        style: Toast.Style.Success,
        title: "Process Stopped",
        message: `Stopped process in ${worktree.branch}`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Stop Process",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  if (isRunning) {
    return (
      <Action
        title="Stop Process"
        icon={Icon.Stop}
        onAction={withToast({
          action: handleStop,
          onSuccess: () => "Process stopped",
          onFailure: () => "Failed to stop process",
        })}
        shortcut={{ modifiers: ["cmd"], key: "s" }}
      />
    );
  }

  return (
    <Action
      title="Run Dev Server"
      icon={Icon.Play}
      onAction={withToast({
        action: handleRun,
        onSuccess: () => "Process started",
        onFailure: () => "Failed to start process",
      })}
      shortcut={{ modifiers: ["cmd"], key: "r" }}
    />
  );
};
