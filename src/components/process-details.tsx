import { Detail, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import { getServerDetails, type ServerInfo } from "#/helpers/wt-serve-client";

interface ProcessDetailsProps {
  worktreePath: string;
  processInfo?: ServerInfo | null;
}

export function ProcessDetails({ worktreePath, processInfo }: ProcessDetailsProps) {
  const [details, setDetails] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDetails() {
      setIsLoading(true);
      try {
        const data = await getServerDetails(worktreePath);
        const lines: string[] = [];
        if (data.command) lines.push(`**Command:** \`${data.command}\``);
        if (data.cpu) {
          lines.push("## Resource Usage\n");
          lines.push(`**CPU:** ${data.cpu}%`);
          lines.push(`**Memory:** ${data.memory}%`);
          if (data.rss) lines.push(`**RSS:** ${data.rss}`);
        }
        if (data.ports && Array.isArray(data.ports)) {
          lines.push("## Open Ports\n");
          (data.ports as string[]).forEach((p) => lines.push(`- ${p}`));
        }
        if (data.host) {
          lines.push("## Host Information\n");
          lines.push(`**Allocated Host:** ${data.host}`);
        }
        lines.push("---");
        lines.push(`*Last updated: ${new Date().toLocaleString()}*`);
        setDetails(lines.join("\n"));
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

**Process Type:** Managed (started by wt-serve)

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
