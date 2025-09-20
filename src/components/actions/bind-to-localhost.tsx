import { Action, Icon, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import { useProxy } from "#/hooks/use-proxy";
import type { Worktree } from "#/config/types";

interface BindToLocalhostProps {
  worktree: Worktree;
  onProxyStart?: () => void;
  onProxyStop?: () => void;
}

export const BindToLocalhost = ({ worktree, onProxyStart, onProxyStop }: BindToLocalhostProps) => {
  const { isProxying, configuredPorts, isLoading, startProxy, stopProxy } = useProxy(worktree.path);
  const [isProcessing, setIsProcessing] = useState(false);

  if (configuredPorts.length === 0) {
    return (
      <Action
        title="Configure Proxy Ports"
        icon={Icon.Gear}
        onAction={async () => {
          await showToast({
            style: Toast.Style.Failure,
            title: "No Ports Configured",
            message: "Add ports in extension preferences",
          });
        }}
        shortcut={{ modifiers: ["cmd"], key: "l" }}
      />
    );
  }

  const handleToggleProxy = async () => {
    if (isLoading || isProcessing) return;

    setIsProcessing(true);

    try {
      if (isProxying) {
        await showToast({
          style: Toast.Style.Animated,
          title: "Stopping Proxy...",
        });

        const success = await stopProxy();
        if (success) {
          onProxyStop?.();
        }
      } else {
        await showToast({
          style: Toast.Style.Animated,
          title: "Starting Proxy...",
          message: `Setting up ports ${configuredPorts.join(", ")}`,
        });

        const success = await startProxy();
        if (success) {
          onProxyStart?.();
        }
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (isProxying) {
    return (
      <Action
        title="Unbind from Localhost"
        icon={Icon.XMarkCircle}
        onAction={handleToggleProxy}
        shortcut={{ modifiers: ["cmd"], key: "l" }}
      />
    );
  }

  return (
    <Action
      title="Bind to Localhost"
      icon={Icon.Link}
      onAction={handleToggleProxy}
      shortcut={{ modifiers: ["cmd"], key: "l" }}
    />
  );
};
