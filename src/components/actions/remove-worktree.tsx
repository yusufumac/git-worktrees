import { UNTRACKED_OR_MODIFIED_FILES_ERROR } from "#/config/constants";
import { Worktree } from "#/config/types";
import { removeWorktreeFromCache } from "#/helpers/cache";
import { pruneWorktrees, removeBranch, removeWorktree } from "#/helpers/git";
import { stopProcess, getProcessInfo, killProcessesInDirectory } from "#/helpers/process";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";
import { Action, confirmAlert, Icon, showToast, Toast } from "@raycast/api";
import path from "node:path";

export const RemoveWorktree = ({
  worktree,
  revalidateProjects,
}: {
  worktree: Worktree;
  revalidateProjects: () => void;
}) => {
  const { removeRunningProcess } = useViewingWorktreesStore();

  const handleRemoveWorktree = async (worktree: Worktree) => {
    const worktreeName = path.basename(worktree.path);
    const projectPath = path.dirname(worktree.path);
    const projectName = path.basename(projectPath);

    // Always show confirmation dialog with worktree details
    const confirmed = await confirmAlert({
      title: `Remove Worktree: ${worktreeName}`,
      message: `Are you sure you want to remove the worktree "${worktreeName}"${
        worktree.branch ? ` (branch: ${worktree.branch})` : ""
      }? This action cannot be undone.`,
    });

    if (!confirmed) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Aborted Removal",
        message: "The worktree was not removed",
      });
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Removing Worktree",
      message: "Please wait while the worktree is being removed",
    });

    // Check if there's a running dev server in this worktree
    const processInfo = getProcessInfo(worktree.path);
    if (processInfo) {
      toast.title = "Stopping Dev Server";
      toast.message = "Stopping the dev server before removing the worktree";

      try {
        await stopProcess(worktree.path);
        // Remove from store
        removeRunningProcess(worktree.path);
        // Small delay to ensure process is fully stopped
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error("Failed to stop dev server:", error);
        // Continue with removal even if stopping fails
      }
    }

    // Also kill any external processes that might be running in this directory
    try {
      await killProcessesInDirectory(worktree.path);
      // Remove from store in case there were external processes
      removeRunningProcess(worktree.path);
    } catch (error) {
      console.error("Failed to kill external processes:", error);
      // Continue with removal even if killing external processes fails
    }

    try {
      toast.title = "Removing Worktree";
      toast.message = "Please wait while the worktree is being removed";
      await removeWorktree({ parentPath: projectPath, worktreeName });
    } catch (e) {
      if (!(e instanceof Error)) throw e;

      const errorMessage = e.message;

      if (!errorMessage.includes(UNTRACKED_OR_MODIFIED_FILES_ERROR)) throw e;

      const confirmed = await confirmAlert({
        title: `Worktree "${worktreeName}" has unsaved changes`,
        message: `The worktree contains untracked or modified files. Force removal will permanently delete these changes. Are you absolutely sure you want to continue?`,
      });

      if (!confirmed) {
        toast.style = Toast.Style.Failure;
        toast.title = "Aborted Removal";
        toast.message = "The worktree was not removed due to unsaved changes";
        return;
      }

      await removeWorktree({ parentPath: projectPath, worktreeName, force: true });
    }

    toast.title = "Running Cleanup";
    toast.message = "Cleaning up worktrees and branches";
    if (worktree.branch) await removeBranch({ path: projectPath, branch: worktree.branch });
    await pruneWorktrees({ path: projectPath });

    toast.style = Toast.Style.Success;
    toast.title = "Worktree Removed";
    toast.message = "The worktree has been removed";

    removeWorktreeFromCache({ projectName, worktreeId: worktree.id, onSuccess: revalidateProjects });
  };

  return (
    <Action
      title="Remove Worktree"
      icon={Icon.Trash}
      shortcut={{ key: "d", modifiers: ["cmd"] }}
      style={Action.Style.Destructive}
      onAction={() => handleRemoveWorktree(worktree)}
    />
  );
};
