import { getPreferences } from "#/helpers/raycast";
import { Action, Icon } from "@raycast/api";

export const OpenPreviewUrl = ({ host }: { host: string | null }) => {
  const { previewUrl } = getPreferences();
  if (!host || !previewUrl) return null;

  return (
    <Action.OpenInBrowser
      title="Open Preview URL"
      icon={Icon.Globe}
      url={previewUrl.replace("{host}", host)}
      shortcut={{ modifiers: ["cmd"], key: "o" }}
    />
  );
};
