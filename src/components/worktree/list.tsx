import type { BareRepository, Worktree } from "#/config/types";
import { getPreferences } from "#/helpers/raycast";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";
import { useFrecencySorting } from "@raycast/utils";
import { memo } from "react";
import { Item } from "./item";

export const List = memo(
  ({
    project,
    worktrees: incomingWorktrees,
    rankBareRepository,
    revalidateProjects,
  }: {
    project?: BareRepository;
    worktrees: Worktree[];
    rankBareRepository?: (key: "increment" | "reset") => void;
    revalidateProjects: () => void;
  }) => {
    const { enableWorktreesFrequencySorting } = getPreferences();
    const { isWorktreeRunning } = useViewingWorktreesStore();

    let worktrees = incomingWorktrees;
    let visitWorktree: ((item: Worktree) => Promise<void>) | undefined;
    let resetWorktreeRanking: ((item: Worktree) => Promise<void>) | undefined;

    if (enableWorktreesFrequencySorting) {
      const {
        data: sortedWorktrees,
        visitItem,
        resetRanking,
      } = useFrecencySorting(worktrees, {
        sortUnvisited: (a, b) => a.id.localeCompare(b.id),
        namespace: "worktrees",
      });

      worktrees = sortedWorktrees;
      visitWorktree = visitItem;
      resetWorktreeRanking = resetRanking;
    }

    // Sort worktrees to put running processes at the top
    worktrees = [...worktrees].sort((a, b) => {
      const aIsRunning = isWorktreeRunning(a.path);
      const bIsRunning = isWorktreeRunning(b.path);

      // If both are running or both are not running, maintain existing order
      if (aIsRunning === bIsRunning) return 0;

      // Running worktrees come first
      return aIsRunning ? -1 : 1;
    });

    return worktrees.map((worktree) => {
      return (
        <Item
          key={worktree.id}
          project={project}
          worktree={worktree}
          rankBareRepository={rankBareRepository}
          rankWorktree={
            enableWorktreesFrequencySorting
              ? (action) => (action === "increment" ? visitWorktree?.(worktree) : resetWorktreeRanking?.(worktree))
              : undefined
          }
          revalidateProjects={revalidateProjects}
        />
      );
    });
  },
);
