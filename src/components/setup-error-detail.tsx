import { Action, ActionPanel, Detail, Icon } from "@raycast/api";

interface SetupErrorDetailProps {
  command: string;
  error: string;
  stderr?: string;
  stdout?: string;
  worktreePath: string;
}

export function SetupErrorDetail({ command, error, stderr, stdout, worktreePath }: SetupErrorDetailProps) {
  const markdown = `# Setup Script Failed

## Error Message
\`\`\`
${error}
\`\`\`

## Command
\`\`\`bash
${command}
\`\`\`

## Working Directory
\`${worktreePath}\`

${stderr ? `## Error Output\n\`\`\`\n${stderr}\n\`\`\`` : ""}

${stdout ? `## Standard Output\n\`\`\`\n${stdout}\n\`\`\`` : ""}

## What to do next?
1. Check the setup script for errors
2. Ensure the script has proper permissions
3. Verify that required tools are installed
4. Try running the script manually in the terminal
5. The worktree has been created successfully, you can still use it
`;

  return (
    <Detail
      markdown={markdown}
      navigationTitle="Installation Error"
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Error Details" content={markdown} icon={Icon.Clipboard} />
          <Action.CopyToClipboard title="Copy Command" content={command} shortcut={{ modifiers: ["cmd"], key: "c" }} />
        </ActionPanel>
      }
    />
  );
}
