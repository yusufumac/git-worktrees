import { Icon, MenuBarExtra } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { useProjects } from "#/hooks/use-projects";
import { listServers, enableProxy, disableProxy, type ServerInfo } from "#/helpers/wt-serve-client";

export default function Command() {
  const { projects, isLoadingProjects } = useProjects();
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
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const runningServers = useMemo(() => servers.filter((s) => s.status === "running"), [servers]);
  const runningPaths = useMemo(() => new Set(runningServers.map((s) => s.worktreePath)), [runningServers]);
  const proxiedPath = useMemo(
    () => runningServers.find((s) => s.proxy?.status === "active")?.worktreePath,
    [runningServers],
  );

  const runningWorktrees = useMemo(() => {
    if (!projects) return [];
    return projects.flatMap((project) =>
      project.worktrees.filter((wt) => runningPaths.has(wt.path)).map((wt) => ({ ...wt, project })),
    );
  }, [projects, runningPaths]);

  const proxiedBranch = useMemo(() => {
    const branch = runningWorktrees.find((wt) => wt.path === proxiedPath)?.branch;
    if (!branch) return undefined;
    return branch.length > 20 ? branch.slice(0, 19) + "…" : branch;
  }, [runningWorktrees, proxiedPath]);

  return (
    <MenuBarExtra icon={Icon.Globe} title={proxiedBranch} isLoading={isLoadingProjects}>
      {runningWorktrees.map((wt) => (
        <MenuBarExtra.Item
          key={wt.id}
          icon={wt.path === proxiedPath ? Icon.Checkmark : undefined}
          title={wt.branch ?? wt.path}
          subtitle={wt.project.name}
          onAction={async () => {
            if (wt.path === proxiedPath) {
              await disableProxy(wt.path);
            } else {
              await enableProxy(wt.path);
            }
            try {
              const list = await listServers();
              setServers(list);
            } catch {
              /* next poll will update */
            }
          }}
        />
      ))}
    </MenuBarExtra>
  );
}
