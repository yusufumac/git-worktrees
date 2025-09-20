import { Detail, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import { getProcessDetails, type ProcessInfo } from "#/helpers/process";

interface ProcessDetailsProps {
  worktreePath: string;
  processInfo?: ProcessInfo | null;
}

export function ProcessDetails({ worktreePath, processInfo }: ProcessDetailsProps) {
  const [details, setDetails] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDetails() {
      setIsLoading(true);
      try {
        const pidToCheck = processInfo?.pid;
        const detailsText = await getProcessDetails(worktreePath, pidToCheck);
        setDetails(detailsText);
      } catch (error) {
        setDetails(`Failed to load process details: ${error}`);
      } finally {
        setIsLoading(false);
      }
    }

    loadDetails();
  }, [worktreePath, processInfo?.pid]);

  const displayPid = processInfo?.pid;

  const markdown = `# Process Details

**Worktree Path:** ${worktreePath}

**Process Type:** Managed (started by Raycast)

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
          <Detail.Metadata.Label title="Type" text="Managed" />
        </Detail.Metadata>
      }
    />
  );
}
