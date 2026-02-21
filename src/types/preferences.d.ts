import { Application } from "@raycast/api";

declare interface Preferences {
  projectsPath: string;
  enableWorktreeCaching: boolean;
  enableWorktreesGrouping: boolean;
  enableProjectsFrequencySorting: boolean;
  enableWorktreesFrequencySorting: boolean;
  maxScanningLevels: string;
  editorApp: Application;
  terminalApp: Application;
  shouldAutomaticallyPushWorktree: "yes" | "no" | "ask";
  skipGitHooksWhenPushing: boolean;
  resizeEditorWindowAfterLaunch?: boolean;
  windowResizeMode?: string;
  branchPrefixesToRemove?: string;
  setupScript?: string;
  shouldAutomaticallyOpenWorktree?: boolean;
  previewUrl?: string;
}
