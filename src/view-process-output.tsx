import { useNavigation } from "@raycast/api";
import { ProcessOutputView } from "./components/process-output";

interface ViewProcessOutputProps {
  worktreePath: string;
}

export default function ViewProcessOutput({ worktreePath }: ViewProcessOutputProps) {
  const { pop } = useNavigation();

  return <ProcessOutputView worktreePath={worktreePath} onClose={pop} />;
}
