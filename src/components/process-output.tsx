import { Detail, ActionPanel, Action, Icon } from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { getProcessInfo, stopProcess } from "#/helpers/process";
import { useViewingWorktreesStore } from "#/stores/viewing-worktrees";

interface ProcessOutputViewProps {
  worktreePath: string;
  onClose?: () => void;
}

export const ProcessOutputView = ({ worktreePath, onClose }: ProcessOutputViewProps) => {
  const [output, setOutput] = useState<string[]>([]);
  const [processStatus, setProcessStatus] = useState<"running" | "stopped" | "error">("running");
  const outputRef = useRef<string[]>([]);

  // Display last 500 lines
  const DISPLAY_LINES = 500;
  const { removeRunningProcess } = useViewingWorktreesStore();

  useEffect(() => {
    // Load initial output from process info
    const processInfo = getProcessInfo(worktreePath);

    if (processInfo) {
      const combinedOutput = [
        ...processInfo.outputBuffer.map((line) => `[stdout] ${line}`),
        ...processInfo.errorBuffer.map((line) => `[stderr] ${line}`),
      ];

      outputRef.current = combinedOutput;
      setOutput(combinedOutput);
      setProcessStatus(processInfo.status);
    }
  }, [worktreePath]);

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(() => {
      const processInfo = getProcessInfo(worktreePath);
      if (processInfo) {
        const combinedOutput = [
          ...processInfo.outputBuffer.map((line) => `[stdout] ${line}`),
          ...processInfo.errorBuffer.map((line) => `[stderr] ${line}`),
        ];

        if (combinedOutput.length !== outputRef.current.length) {
          outputRef.current = combinedOutput;
          setOutput(combinedOutput);
        }

        setProcessStatus(processInfo.status);
      } else {
        setProcessStatus("stopped");
      }
    }, 500);

    return () => clearInterval(interval);
  }, [worktreePath]);

  const handleStop = async () => {
    await stopProcess(worktreePath);
    removeRunningProcess(worktreePath);
    setProcessStatus("stopped");
  };

  const handleCopyOutput = () => {
    const outputText = output.join("\n");
    navigator.clipboard.writeText(outputText);
  };

  // Process the output to convert ANSI colors to markdown - always show last N lines
  const processedOutput = output.slice(-DISPLAY_LINES).map((line) => {
    // Remove the [stdout] or [stderr] prefix for cleaner output
    return line.replace(/^\[(stdout|stderr)\] /, "");
  });

  const markdown = `\`\`\`ansi
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
