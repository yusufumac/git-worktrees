import { Action, Icon, LaunchType, launchCommand } from "@raycast/api";
import { useDevServer } from "#/hooks/use-dev-server";
import type { Worktree } from "#/config/types";

interface RunWorktreeProps {
	worktree: Worktree;
	onProcessStart?: () => void;
	onProcessStop?: () => void;
}

const refreshMenuBar = () =>
	launchCommand({
		name: "running-worktrees",
		type: LaunchType.Background,
	}).catch(() => {});

export const RunDevServer = ({
	worktree,
	onProcessStart,
	onProcessStop,
}: RunWorktreeProps) => {
	const { isRunning, start, stop } = useDevServer(worktree.path);

	const handleRun = async () => {
		const success = await start();
		if (success) {
			onProcessStart?.();
			refreshMenuBar();
		}
	};

	const handleStop = async () => {
		const success = await stop();
		if (success) {
			onProcessStop?.();
			refreshMenuBar();
		}
	};

	if (isRunning) {
		return (
			<Action
				title="Stop Dev Server"
				icon={Icon.Stop}
				onAction={handleStop}
				shortcut={{ modifiers: ["cmd"], key: "r" }}
			/>
		);
	}

	return (
		<Action
			title="Run Dev Server"
			icon={Icon.Play}
			onAction={handleRun}
			shortcut={{ modifiers: ["cmd"], key: "r" }}
		/>
	);
};
