import { Detail, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import { getProcessDetails, type ProcessInfo } from "#/helpers/process";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";

interface ProcessDetailsProps {
  worktreePath: string;
  processInfo?: ProcessInfo | null;
  isExternal: boolean;
}

export function ProcessDetails({ worktreePath, processInfo, isExternal }: ProcessDetailsProps) {
  const [details, setDetails] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const externalProcesses = useViewingWorktreesStore((state) => state.externalProcesses);

  useEffect(() => {
    async function loadDetails() {
      setIsLoading(true);
      try {
        let pidToCheck: number | undefined = processInfo?.pid;

        // If it's an external process without processInfo, get the first PID from the store
        if (isExternal && !pidToCheck) {
          const externalPids = externalProcesses.get(worktreePath);
          if (externalPids && externalPids.length > 0) {
            pidToCheck = externalPids[0];
          }
        }

        const detailsText = await getProcessDetails(worktreePath, pidToCheck);
        setDetails(detailsText);
      } catch (error) {
        setDetails(`Failed to load process details: ${error}`);
      } finally {
        setIsLoading(false);
      }
    }

    loadDetails();
  }, [worktreePath, processInfo?.pid, isExternal, externalProcesses]);

  const externalPids = isExternal ? externalProcesses.get(worktreePath) : undefined;
  const displayPid = processInfo?.pid || (externalPids && externalPids[0]);

  const markdown = `# Process Details

**Worktree Path:** ${worktreePath}

**Process Type:** ${isExternal ? "External (started outside Raycast)" : "Managed (started by Raycast)"}

${displayPid ? `**PID:** ${displayPid}` : ""}

${details}`;

  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      navigationTitle="Process Details"
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Status"
            text="Running"
            icon={{ source: Icon.CircleFilled, tintColor: "#00ff00" }}
          />
          {displayPid && <Detail.Metadata.Label title="PID" text={displayPid.toString()} />}
          <Detail.Metadata.Label title="Type" text={isExternal ? "External" : "Managed"} />
        </Detail.Metadata>
      }
    />
  );
}
