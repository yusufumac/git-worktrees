export const BARE_REPOSITORY_REMOTE_ORIGIN_FETCH = "+refs/heads/*:refs/remotes/origin/*";
export const UNTRACKED_OR_MODIFIED_FILES_ERROR = "contains modified or untracked files, use --force to delete it";

export const CACHE_KEYS = {
  PROJECTS: "projects",
  WORKTREES: "worktrees",
  DIRECTORIES: "directories",
  LAST_PROJECT_DIR: "lastProjectDir",
};

export const BARE_REPOSITORY = "bare";

export const TEMP_DIR_PREFIX = "git-worktrees-";

// Dev server related constants
export const DEV_SERVER_SUCCESS_MESSAGE = "All apps are now running";
export const DEV_SERVER_TIMEOUT_MS = 60000; // 60 seconds default
export const DEV_SERVER_TIMEOUT_MS_MONOREPO = 120000; // 120 seconds for monorepos

// Proxy server constants
export const PROXY_ADMIN_PORT = 2019;
export const PROXY_CONFIG_PATH = "/tmp/raycast-proxy-config.json";
export const PROXY_STATE_KEY = "proxy-states";
