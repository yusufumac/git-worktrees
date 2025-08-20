import { Action, Icon, showToast, Toast } from "@raycast/api";
import { runSetupScript } from "#/helpers/run-setup-script";
import type { Worktree } from "#/config/types";

export function RunSetupScript({ worktree }: { worktree: Worktree }) {
  async function handleRunSetupScript() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Running Setup Script",
      message: "Looking for setup.sh...",
    });

    try {
      const result = await runSetupScript(worktree.path);

      if (!result.scriptPath) {
        toast.style = Toast.Style.Failure;
        toast.title = "No Setup Script Found";
        toast.message = "No setup.sh file found in the repository root";
        return;
      }

      if (result.success) {
        toast.style = Toast.Style.Success;
        toast.title = "Setup Script Completed";
        toast.message = "Successfully ran setup.sh";
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Setup Script Failed";
        toast.message = result.error || "Failed to run setup.sh";

        if (result.errorDetails) {
          const { errorDetails } = result;
          toast.primaryAction = {
            title: "Copy Error",
            onAction: async () => {
              const errorInfo = `Command: ${errorDetails.command}\n\nError: ${result.error}\n\nStderr:\n${errorDetails.stderr || "(empty)"}\n\nStdout:\n${errorDetails.stdout || "(empty)"}`;
              await navigator.clipboard.writeText(errorInfo);
              await showToast({
                style: Toast.Style.Success,
                title: "Error Copied",
                message: "Error details copied to clipboard",
              });
            },
          };
        }
      }
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to Run Setup Script";
      toast.message = error instanceof Error ? error.message : "Unknown error occurred";
    }
  }

  return (
    <Action
      title="Run Setup Script"
      icon={Icon.Terminal}
      onAction={handleRunSetupScript}
      shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
    />
  );
}
