import http from "http";
import { getPreferenceValues } from "@raycast/api";
import { homedir } from "os";
import { join } from "path";

interface Preferences {
  wtServeSocketPath?: string;
}

function getSocketPath(): string {
  try {
    const prefs = getPreferenceValues<Preferences>();
    return prefs.wtServeSocketPath || join(homedir(), ".config", "wt-serve", "wt-serve.sock");
  } catch {
    return join(homedir(), ".config", "wt-serve", "wt-serve.sock");
  }
}

function encodeId(worktreePath: string): string {
  return Buffer.from(worktreePath).toString("base64url");
}

function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const socketPath = getSocketPath();
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 200, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 200, data });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface ServerInfo {
  id: string;
  worktreePath: string;
  pid: number;
  host: string;
  status: string;
  command: string;
  startTime: string;
  uptime: number;
  proxy: { status: "active" | "inactive"; ports: number[] } | null;
}

export interface StartResult {
  id: string;
  pid: number;
  host: string;
  status: "starting" | "running" | "error";
  startTime: string;
  error?: string;
}

export interface LogEntry {
  type: "stdout" | "stderr";
  data: string;
}

export async function startServer(opts: {
  worktreePath: string;
}): Promise<StartResult> {
  const { data } = await request("POST", "/servers", { ...opts, proxy: true });
  return data;
}

export async function stopServer(worktreePath: string): Promise<void> {
  await request("DELETE", `/servers/${encodeId(worktreePath)}`);
}

export async function listServers(): Promise<ServerInfo[]> {
  const { data } = await request("GET", "/servers");
  return data.servers;
}

export async function getServer(worktreePath: string): Promise<ServerInfo> {
  const { data } = await request("GET", `/servers/${encodeId(worktreePath)}`);
  return data;
}

export async function getServerDetails(worktreePath: string): Promise<Record<string, unknown>> {
  const { data } = await request("GET", `/servers/${encodeId(worktreePath)}`);
  return data;
}

export async function getLogs(worktreePath: string, tail = 100): Promise<LogEntry[]> {
  const { data } = await request("GET", `/servers/${encodeId(worktreePath)}/logs?follow=false&tail=${tail}`);
  return data.logs;
}

export async function enableProxy(worktreePath: string): Promise<void> {
  await request("POST", `/proxy/${encodeId(worktreePath)}`, {});
}

export async function disableProxy(worktreePath: string): Promise<void> {
  await request("DELETE", `/proxy/${encodeId(worktreePath)}`);
}

export async function health(): Promise<{ status: string; serverCount: number }> {
  const { data } = await request("GET", "/health");
  return data;
}
