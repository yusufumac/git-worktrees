import { Image } from "@raycast/api";

export interface Remote {
  url: string;
}

export type BareRepository = {
  name: string;
  displayPath: string;
  fullPath: string;
  pathParts: string[];
  primaryDirectory: string;
  gitRemotes: Repo[];
};

export type Worktree = {
  id: string;
  path: string;
  commit: string | null;
  branch: string | null;
  dirty: boolean;
  createdAt?: number;
};

export type Project = BareRepository & {
  id: string;
  worktrees: Worktree[];
};

export interface Repo {
  name: string;
  host: string;
  hostDisplayName: string;
  url: string;
  icon: Image;
}

// Proxy related types
export interface ProxyState {
  worktreePath: string;
  targetHost: string;
  ports: number[];
  status: "active" | "inactive";
  caddyServerIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PortMapping {
  localPort: number;
  targetPort: number;
  service?: string;
}
