import { isWorktreeDirty } from "#/helpers/file";
import { getCurrentCommit, getPullRequest } from "#/helpers/git";
import { useCachedPromise } from "@raycast/utils";

const getBranchInformation = async (path: string, branch: string) => {
  const [isDirty, commit, pr] = await Promise.all([
    isWorktreeDirty(path),
    getCurrentCommit({ path }),
    getPullRequest({ path, branch }).catch(() => undefined),
  ]);

  return { isDirty, commit: commit ?? undefined, pr };
};

export const useBranchInformation = ({ path, branch }: { path: string; branch?: string | null }) => {
  const { data, isLoading } = useCachedPromise(
    (path, branch) => getBranchInformation(path, branch),
    [path, branch ?? ""],
    {
      keepPreviousData: true,
      execute: !!branch,
    },
  );

  return {
    isDirty: data?.isDirty,
    commit: data?.commit,
    pr: data?.pr,
    isLoadingBranchInformation: isLoading,
  };
};
