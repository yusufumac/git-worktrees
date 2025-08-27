import type { BareRepository, Worktree } from "#/config/types";
import { getPreferences } from "#/helpers/raycast";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";
import { useFrecencySorting } from "@raycast/utils";
import { memo, useState } from "react";
import { Item } from "./item";

export type WorktreeSortOrder = "default" | "creation_desc" | "creation_asc";

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
    const [sortOrder, setSortOrder] = useState<WorktreeSortOrder>("creation_desc");

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
    } else if (sortOrder && sortOrder !== "default") {
      // Apply creation date sorting when frecency sorting is disabled
      worktrees = [...worktrees].sort((a, b) => {
        // If creation dates are not available, fall back to alphabetical
        if (!a.createdAt || !b.createdAt) {
          return a.id.localeCompare(b.id);
        }

        if (sortOrder === "creation_desc") {
          // Newest first
          return b.createdAt - a.createdAt;
        } else if (sortOrder === "creation_asc") {
          // Oldest first
          return a.createdAt - b.createdAt;
        }

        return 0;
      });
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
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
        />
      );
    });
  },
);
