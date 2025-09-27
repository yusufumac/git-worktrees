import { shouldOpenWorktree } from "#/helpers/general";
import { withToast } from "#/helpers/toast";
import { useProjects } from "#/hooks/use-projects";
import { Action, ActionPanel, Icon, List, LocalStorage, open, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import path from "node:path";
import { useState, useEffect } from "react";
import { CACHE_KEYS } from "./config/constants";
import { Project } from "./config/types";
import { updateCache } from "./helpers/cache";
import { formatPath } from "./helpers/file";
import {
  addNewWorktree,
  checkIfBranchExistsOnRemote,
  fetch,
  getCurrentCommit,
  shouldPushWorktree,
} from "./helpers/git";
import { fetchLinearIssues, LinearIssue } from "./helpers/linear";
import { getPreferences, resizeEditorWindow } from "./helpers/raycast";

const LAST_SELECTED_PROJECT_KEY = "linear-last-selected-project";

export default function Command() {
  const { pop } = useNavigation();
  const [searchText, setSearchText] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);

  const preferences = getPreferences();

  const { projects, isLoadingProjects, revalidateProjects } = useProjects();

  // Extract bare repositories from projects
  const bareRepos = projects.map(({ id: _id, worktrees: _worktrees, ...project }) => project);

  // Load last selected project on mount
  useEffect(() => {
    LocalStorage.getItem<string>(LAST_SELECTED_PROJECT_KEY).then((stored) => {
      if (stored && !selectedProject) {
        // Only set if project still exists
        const projectExists = bareRepos.some((p) => p.fullPath === stored);
        if (projectExists) {
          setSelectedProject(stored);
        }
      }
    });
  }, [bareRepos]);

  // Save selected project when it changes
  useEffect(() => {
    if (selectedProject) {
      LocalStorage.setItem(LAST_SELECTED_PROJECT_KEY, selectedProject);
    }
  }, [selectedProject]);

  // Fetch Linear issues with network search
  const { isLoading: isLoadingIssues, data: issues = [] } = useCachedPromise(
    async (searchQuery: string) => {
      if (!preferences.linearApiKey) {
        return [];
      }
      return await fetchLinearIssues(searchQuery, 10);
    },
    [searchText],
    {
      keepPreviousData: true,
      onError: (error) => {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to fetch Linear issues",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      },
    },
  );

  async function handleCreateWorktree(issue: LinearIssue) {
    if (!selectedProject) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Please select a project first",
      });
      return;
    }

    if (!issue.branchName) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No branch name available",
        message: "This issue doesn't have a branch name configured in Linear",
      });
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Creating Worktree",
      message: `Creating worktree for ${issue.identifier}: ${issue.title}`,
    });

    setIsCreating(true);

    try {
      // Fetch latest changes from remote
      await fetch(selectedProject);

      // Check if branch already exists on remote
      const branchExists = await checkIfBranchExistsOnRemote({
        path: selectedProject,
        branch: issue.branchName,
      });

      if (branchExists) {
        toast.style = Toast.Style.Failure;
        toast.title = "Branch already exists";
        toast.message = `Branch '${issue.branchName}' already exists on remote`;
        return;
      }

      // Create the new worktree
      const newWorktreePath = path.join(selectedProject, issue.branchName);

      // Try to detect the default branch (main or master)
      const trackingBranch = (await checkIfBranchExistsOnRemote({ path: selectedProject, branch: "main" }))
        ? "main"
        : "master";

      await addNewWorktree({
        newBranch: issue.branchName,
        newWorktreePath,
        trackingBranch,
        parentPath: selectedProject,
      });

      // Push the branch to remote
      await shouldPushWorktree({
        path: newWorktreePath,
        branch: issue.branchName,
      });

      // Update the worktree cache if enabled
      if (preferences.enableWorktreeCaching) {
        const commit = await getCurrentCommit({ path: newWorktreePath });

        await updateCache<Project[]>({
          key: CACHE_KEYS.WORKTREES,
          updater: (projects) => {
            if (!projects) return;

            const projectIndex = projects.findIndex((p) => p.id === selectedProject);
            if (projectIndex === -1) return;

            const project = projects[projectIndex];

            project.worktrees.push({
              id: newWorktreePath,
              path: newWorktreePath,
              commit,
              branch: issue.branchName,
              dirty: false,
            });

            return projects;
          },
        });
      }

      // Revalidate projects after cache update
      revalidateProjects();

      toast.style = Toast.Style.Success;
      toast.title = "Worktree Created";
      toast.message = `Worktree '${issue.branchName}' has been created`;
      toast.primaryAction = {
        title: "Open Worktree",
        onAction: withToast({
          action: async () => {
            if (!preferences?.editorApp) return;

            await Promise.all([open(newWorktreePath, preferences?.editorApp?.bundleId)]);

            return resizeEditorWindow(preferences.editorApp);
          },
          onSuccess: () => `Opening worktree in ${preferences?.editorApp?.name}`,
          onFailure: () => `Failed to open worktree in ${preferences?.editorApp?.name}`,
        }),
      };

      await shouldOpenWorktree({ path: newWorktreePath, branch: issue.branchName });

      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Error creating worktree";
      toast.message = error instanceof Error ? error.message : "An unknown error occurred";
    } finally {
      setIsCreating(false);
    }
  }

  if (!preferences.linearApiKey) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Key}
          title="Linear API Key Required"
          description="Please set your Linear API key in the extension preferences to use this feature"
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoadingProjects || isLoadingIssues || isCreating}
      searchBarPlaceholder="Search Linear issues by title or ID..."
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown tooltip="Select Project" value={selectedProject} onChange={setSelectedProject}>
          <List.Dropdown.Item title="Select a project..." value="" />
          {bareRepos.map((project) => (
            <List.Dropdown.Item
              key={project.fullPath}
              title={`${project.name} (${formatPath(project.fullPath)})`}
              value={project.fullPath}
            />
          ))}
        </List.Dropdown>
      }
    >
      {issues.length === 0 ? (
        <List.EmptyView
          title={searchText ? "No matching issues found" : "No Linear issues available"}
          description={searchText ? "Try adjusting your search query" : "Start typing to search for issues"}
        />
      ) : (
        issues.map((issue) => (
          <List.Item
            key={issue.id}
            title={`${issue.identifier}: ${issue.title}`}
            accessories={[
              { text: issue.state.name },
              issue.assignee ? { text: issue.assignee.name } : null,
              { text: issue.team.name },
            ].filter((item): item is { text: string } => item !== null)}
            actions={
              <ActionPanel>
                {selectedProject ? (
                  <Action
                    title="Create Worktree from Issue"
                    icon={Icon.Plus}
                    onAction={() => handleCreateWorktree(issue)}
                  />
                ) : (
                  <Action
                    title="Select a Project First"
                    icon={Icon.ExclamationMark}
                    onAction={() =>
                      showToast({
                        style: Toast.Style.Failure,
                        title: "Please select a project",
                        message: "Use the dropdown in the search bar to select a project",
                      })
                    }
                  />
                )}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
