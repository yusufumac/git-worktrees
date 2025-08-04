import { Action, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";
import {
  startProcess,
  stopProcess,
  detectExternalProcesses,
  killAllWorktreeDevServers,
  getAllWorktreePaths,
} from "#/helpers/process";
import { withToast } from "#/helpers/toast";
import { getPreferences } from "#/helpers/raycast";
import ViewProcessOutput from "../../view-process-output";
import type { Worktree } from "#/config/types";

interface RunWorktreeProps {
  worktree: Worktree;
  onProcessStart?: () => void;
  onProcessStop?: () => void;
}

export const RunWorktree = ({ worktree, onProcessStart, onProcessStop }: RunWorktreeProps) => {
  const { setRunningProcess, removeRunningProcess, isWorktreeRunning, updateExternalProcesses } =
    useViewingWorktreesStore();
  const { push } = useNavigation();
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
        title: "Starting Process",
        message: `Running ${fullCommand} in ${worktree.path}`,
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

      const processInfo = await startProcess(worktree.path, command, args);

      setRunningProcess(worktree.path, processInfo);
      onProcessStart?.();

      // Refresh external process detection immediately
      setTimeout(async () => {
        const externalProcesses = await detectExternalProcesses([worktree.path]);
        updateExternalProcesses(externalProcesses);
      }, 100); // Small delay to ensure process is fully started

      // Open the output viewer after process is started
      push(<ViewProcessOutput worktreePath={worktree.path} />);

      await showToast({
        style: Toast.Style.Success,
        title: "Process Started",
        message: `Running ${fullCommand} in ${worktree.branch}`,
      });
    } catch (error) {
      // Store error in a temporary process info so it can be displayed
      const errorInfo = {
        pid: -1,
        command: fullCommand,
        args: [],
        cwd: worktree.path,
        startTime: new Date(),
        outputBuffer: [],
        errorBuffer: [
          `Failed to start process: ${error instanceof Error ? error.message : "Unknown error"}`,
          "",
          "Command: " + fullCommand,
          "Directory: " + worktree.path,
          "",
          "Error Details:",
          error instanceof Error ? error.stack || error.message : String(error),
        ],
        status: "error" as const,
      };

      setRunningProcess(worktree.path, errorInfo);

      // Open the output viewer to show the error
      push(<ViewProcessOutput worktreePath={worktree.path} />);

      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Start Process",
        message: "Check the output window for details",
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
        shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
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
      shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
    />
  );
};
