import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useMemo, useEffect } from "react";
import { useProjects } from "#/hooks/use-projects";
import { Worktree } from "./components/worktree";
import type { Worktree as WorktreeType } from "./config/types";
import useProcessStore from "#/stores/process-store";
import { cleanupOrphanedProcesses } from "#/helpers/process";

export default function Command() {
  const { projects: incomingProjects, isLoadingProjects, revalidateProjects } = useProjects();

  // Clean up orphaned processes and restore running ones on mount
  useEffect(() => {
    cleanupOrphanedProcesses().catch(() => {
      // Silent error
    });
  }, []);

  // Get the running processes map directly from the store
  const runningProcessesMap = useProcessStore((state) => state.runningProcesses);

  const runningWorktrees = useMemo(() => {
    if (!incomingProjects) return [];

    const allWorktrees = incomingProjects.flatMap((project) =>
      project.worktrees.map((worktree) => ({
        ...worktree,
        project,
      })),
    );

    // Filter to only worktrees with running dev servers
    return allWorktrees.filter((worktree) => {
      const runningProcess = runningProcessesMap.get(worktree.path);
      return runningProcess && runningProcess.info.status === "running";
    });
  }, [incomingProjects, runningProcessesMap]);

  if (runningWorktrees.length === 0 && !isLoadingProjects) {
    return (
      <List>
        <List.EmptyView
          title="No Dev Servers Running"
          description="Start a dev server from a worktree to see it here"
          icon={Icon.XMarkCircle}
          actions={
            <ActionPanel>
              <Action.Open
                title="Open View Worktrees"
                icon={Icon.List}
                target="raycast://extensions/philstainer/git-worktrees/view-worktrees"
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoadingProjects}>
      {runningWorktrees.map((worktree) => (
        <SwitchDevServerItem
          key={worktree.id}
          project={worktree.project}
          worktree={worktree}
          revalidateProjects={revalidateProjects}
        />
      ))}
    </List>
  );
}

// Custom item component for switch dev servers with proxy toggle as primary action
function SwitchDevServerItem({
  worktree,
  project,
  revalidateProjects,
}: {
  worktree: WorktreeType & { project: any };
  project: any;
  revalidateProjects: () => void;
}) {
  return (
    <Worktree.Item
      key={worktree.id}
      project={project}
      worktree={worktree}
      revalidateProjects={revalidateProjects}
      customPrimaryAction="proxy"
    />
  );
}
