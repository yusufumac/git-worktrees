import { Detail, ActionPanel, Action, Icon } from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { getLogs, stopServer } from "#/helpers/wt-serve-client";
import stripAnsi from "strip-ansi";

interface ProcessOutputViewProps {
  worktreePath: string;
  onClose?: () => void;
}

export const ProcessOutputView = ({ worktreePath, onClose }: ProcessOutputViewProps) => {
  const [output, setOutput] = useState<string[]>([]);
  const [processStatus, setProcessStatus] = useState<"running" | "stopped" | "error">("running");
  const outputRef = useRef<string[]>([]);

  const DISPLAY_LINES = 500;

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const logs = await getLogs(worktreePath, 1000);
        if (!active) return;
        const lines = logs.map((l) => `[${l.type}] ${l.data}`);
        if (lines.length !== outputRef.current.length) {
          outputRef.current = lines;
          setOutput(lines);
        }
        setProcessStatus("running");
      } catch {
        if (active) setProcessStatus("stopped");
      }
    };

    poll();
    const interval = setInterval(poll, 500);
    return () => { active = false; clearInterval(interval); };
  }, [worktreePath]);

  const handleStop = async () => {
    await stopServer(worktreePath);
    setProcessStatus("stopped");
  };

  const handleCopyOutput = () => {
    const outputText = output.join("\n");
    navigator.clipboard.writeText(outputText);
  };

  const processedOutput = output.slice(-DISPLAY_LINES).map((line) => {
    const cleanLine = line.replace(/^\[(stdout|stderr)\] /, "");
    return stripAnsi(cleanLine);
  });

  const markdown = `\`\`\`
${processedOutput.join("\n") || "Waiting for output..."}
\`\`\`

${output.length > DISPLAY_LINES ? `\n*Showing last ${DISPLAY_LINES} lines of ${output.length} total.*` : ""}`;

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`Process Output ${processStatus === "running" ? "🟢" : processStatus === "error" ? "🔴" : "⚪"}`}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Process Actions">
            {processStatus === "running" && (
              <Action
                title="Stop Process"
                icon={Icon.Stop}
                onAction={handleStop}
                shortcut={{ modifiers: ["cmd"], key: "s" }}
              />
            )}
            <Action
              title="Copy Output"
              icon={Icon.Clipboard}
              onAction={handleCopyOutput}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Navigation">
            {onClose && (
              <Action
                title="Close"
                icon={Icon.XMarkCircle}
                onAction={onClose}
                shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
};
