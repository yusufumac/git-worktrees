import { Action, Icon, Clipboard, showToast, Toast } from "@raycast/api";

export const CopyPath = ({ path }: { path: string }) => {
  return (
    <Action
      title="Copy Path"
      icon={Icon.Clipboard}
      shortcut={{ modifiers: ["cmd"], key: "." }}
      onAction={async () => {
        await Clipboard.copy(path);
        await showToast({
          style: Toast.Style.Success,
          title: "Path Copied",
          message: path,
        });
      }}
    />
  );
};
