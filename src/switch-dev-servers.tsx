import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useMemo, useEffect, useState } from "react";
import { useProjects } from "#/hooks/use-projects";
import { Worktree } from "./components/worktree";
import type { Worktree as WorktreeType } from "./config/types";
import { listServers, type ServerInfo } from "#/helpers/wt-serve-client";

export default function Command() {
  const { projects: incomingProjects, isLoadingProjects, revalidateProjects } = useProjects();
  const [servers, setServers] = useState<ServerInfo[]>([]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const list = await listServers();
        if (active) setServers(list);
      } catch {
        if (active) setServers([]);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const runningPaths = useMemo(() => new Set(servers.filter((s) => s.status === "running").map((s) => s.worktreePath)), [servers]);

  const runningWorktrees = useMemo(() => {
    if (!incomingProjects) return [];
    return incomingProjects.flatMap((project) =>
      project.worktrees
        .filter((wt) => runningPaths.has(wt.path))
        .map((wt) => ({ ...wt, project })),
    );
  }, [incomingProjects, runningPaths]);

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
    />
  );
}
