import ClearCache from "#/components/actions/clear-cache";
import { CopyPath } from "#/components/actions/copy-path";
import { OpenEditor } from "#/components/actions/open-editor";
import { OpenTerminal } from "#/components/actions/open-terminal";
import { RefreshWorktrees } from "#/components/actions/refresh-worktrees";
import { RemoveProject } from "#/components/actions/remove-project";
import { RemoveWorktree } from "#/components/actions/remove-worktree";
import { RenameWorktree } from "#/components/actions/rename-worktree";
import { ResetRanking } from "#/components/actions/reset-ranking";
import { RunDevServer } from "#/components/actions/run-dev-server";
import type { BareRepository, Worktree } from "#/config/types";
import type { WorktreeSortOrder } from "./list";
import { getPreferences } from "#/helpers/raycast";
import { enableProxy, disableProxy } from "#/helpers/wt-serve-client";
import { useBranchInformation } from "#/hooks/use-branch-information";
import { useDevServer } from "#/hooks/use-dev-server";
import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { relative } from "node:path";
import { memo } from "react";
import AddWorktree from "../../add-worktree";
import ViewProcessOutput from "../../view-process-output";
import { ProcessDetails } from "../process-details";

export const Item = memo(
  ({
    project,
    worktree,
    rankBareRepository,
    rankWorktree,
    revalidateProjects,
    sortOrder,
    setSortOrder,
  }: {
    project?: BareRepository;
    worktree: Worktree;
    rankBareRepository?: (key: "increment" | "reset") => void;
    rankWorktree?: (key: "increment" | "reset") => void;
    revalidateProjects: () => void;
    sortOrder?: WorktreeSortOrder;
    setSortOrder?: (order: WorktreeSortOrder) => void;
  }) => {
    const { projectsPath } = getPreferences();
    const gitRemote = project?.gitRemotes?.[0];

    const branchInformation = useBranchInformation({ path: worktree.path });
    const { isRunning, processInfo, host } = useDevServer(worktree.path);
    const isProxying = processInfo?.proxy?.status === "active";

    const isDirty = branchInformation.isDirty === undefined ? worktree.dirty : branchInformation.isDirty;
    const currentCommit = branchInformation.commit === undefined ? worktree.commit : branchInformation.commit;

    return (
      <List.Item
        id={worktree.id}
        key={worktree.branch}
        icon={{ source: "branch.svg" }}
        title={(() => {
          const basePath = project?.fullPath ?? projectsPath;
          // Handle case-insensitive path comparison for macOS
          return worktree.path.toLowerCase().startsWith(basePath.toLowerCase())
            ? worktree.path.slice(basePath.length + 1) // +1 to skip the '/'
            : relative(basePath, worktree.path);
        })()}
        subtitle={`${worktree.branch ?? "detached"} @ ${currentCommit?.slice(0, 7) ?? "none"}`}
        keywords={worktree.branch ? worktree.branch.split("-") : []}
        accessories={[
          ...(isProxying
            ? [
                {
                  text: { value: "localhost", color: Color.Green },
                  tooltip: "Proxied to localhost",
                },
              ]
            : []),
          ...(host
            ? [
                {
                  text: { value: host, color: Color.Green },
                  tooltip: `Dev server running on ${host}`,
                },
              ]
            : []),
          ...(isDirty ? [{ text: { value: "U", color: Color.Yellow }, tooltip: "Unsaved Changes" }] : []),
          ...(gitRemote?.icon ? [{ icon: gitRemote.icon, tooltip: gitRemote.host }] : []),
        ]}
        actions={
          <ActionPanel>
            <ActionPanel.Section title="Worktree Actions">
              <OpenEditor
                worktree={worktree}
                extraActions={async () => {
                  await Promise.all([rankBareRepository?.("increment"), rankWorktree?.("increment")]);
                }}
              />
              <OpenTerminal path={worktree.path} />
              <CopyPath path={worktree.path} />

              <RunDevServer
                worktree={worktree}
                onProcessStart={revalidateProjects}
                onProcessStop={revalidateProjects}
              />

              {isRunning && (
                <Action
                  title={isProxying ? "Unbind from Localhost" : "Bind to Localhost"}
                  icon={isProxying ? Icon.XMarkCircle : Icon.Link}
                  shortcut={{ modifiers: ["cmd"], key: "l" }}
                  onAction={async () => {
                    try {
                      if (isProxying) {
                        await disableProxy(worktree.path);
                        await showToast({ style: Toast.Style.Success, title: "Proxy Disabled" });
                      } else {
                        await enableProxy(worktree.path);
                        await showToast({ style: Toast.Style.Success, title: "Proxy Enabled" });
                      }
                    } catch (err) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "Proxy Error",
                        message: err instanceof Error ? err.message : "Unknown error",
                      });
                    }
                  }}
                />
              )}

              {processInfo && (
                <Action.Push
                  title="View Output"
                  icon={Icon.Terminal}
                  target={<ViewProcessOutput worktreePath={worktree.path} />}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
                />
              )}

              {isRunning && (
                <Action.Push
                  title="View Process Details"
                  icon={Icon.Info}
                  target={<ProcessDetails worktreePath={worktree.path} processInfo={processInfo} />}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
                />
              )}

              <RemoveWorktree worktree={worktree} revalidateProjects={revalidateProjects} />
              <RenameWorktree worktree={worktree} revalidateProjects={revalidateProjects} />
              <Action.Push
                title="Add New Worktree"
                icon={Icon.Plus}
                target={<AddWorktree directory={project?.fullPath} />}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="Extra Actions">
              {setSortOrder && (
                <ActionPanel.Submenu title="Sort Worktrees" icon={Icon.ArrowUp}>
                  <Action
                    title="Creation Date (Newest First)"
                    icon={sortOrder === "creation_desc" ? Icon.Checkmark : undefined}
                    onAction={() => setSortOrder("creation_desc")}
                  />
                  <Action
                    title="Creation Date (Oldest First)"
                    icon={sortOrder === "creation_asc" ? Icon.Checkmark : undefined}
                    onAction={() => setSortOrder("creation_asc")}
                  />
                  <Action
                    title="Alphabetical"
                    icon={sortOrder === "default" ? Icon.Checkmark : undefined}
                    onAction={() => setSortOrder("default")}
                  />
                </ActionPanel.Submenu>
              )}

              <RefreshWorktrees revalidate={revalidateProjects} />

              <ClearCache revalidateProjects={revalidateProjects} />

              <RemoveProject project={project} revalidateProjects={revalidateProjects} />

              {gitRemote?.url && (
                <Action.OpenInBrowser
                  url={gitRemote.url}
                  title="Open Repository in Browser"
                  shortcut={{ modifiers: ["cmd"], key: "b" }}
                />
              )}
              <Action.ShowInFinder
                title="Show in Finder"
                path={worktree.path}
                shortcut={{ modifiers: ["cmd"], key: "f" }}
              />
              <Action.OpenWith
                title="Open with"
                path={worktree.path}
                shortcut={{ modifiers: ["cmd", "opt"], key: "o" }}
              />

              <ResetRanking
                resetRankingRepo={rankBareRepository ? () => rankBareRepository("reset") : undefined}
                resetWorktreeRanking={rankWorktree ? () => rankWorktree("reset") : undefined}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  },
);
