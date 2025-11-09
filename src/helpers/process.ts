import { ChildProcess, spawn } from "child_process";
import { openSync, closeSync } from "fs";
import { executeCommand } from "./general";
import { deallocateHost } from "./host-manager";
import { getUserShell, buildCommandWithProfile } from "./shell";
import { DEV_SERVER_SUCCESS_MESSAGE } from "#/config/constants";
import useProcessStore, { type StoredProcessData, type ProcessInfo, type RunningProcess } from "#/stores/process-store";

export type { ProcessInfo } from "#/stores/process-store";

export interface ProcessOutput {
  type: "stdout" | "stderr";
  data: string;
  timestamp: Date;
}

const MAX_OUTPUT_LINES = 50000; // Increased buffer size for more output

// Circular buffer implementation for output storage
class CircularBuffer<T> {
  private buffer: T[];
  private pointer: number = 0;
  private size: number = 0;

  constructor(private maxSize: number) {
    this.buffer = new Array(maxSize);
  }

  push(item: T): void {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.maxSize;
    if (this.size < this.maxSize) {
      this.size++;
    }
  }

  toArray(): T[] {
    if (this.size < this.maxSize) {
      return this.buffer.slice(0, this.size);
    }
    const start = this.pointer;
    return [...this.buffer.slice(start), ...this.buffer.slice(0, start)].filter(Boolean);
  }

  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.pointer = 0;
    this.size = 0;
  }
}

// StoredProcessData type is imported from the store

// Get stored process data from the store
async function getStoredProcesses(): Promise<Record<string, StoredProcessData>> {
  const store = useProcessStore.getState();
  await store.initializeStore();
  return store.getStoredProcesses();
}

// Store process data using the store
async function storeProcesses(processes: Record<string, StoredProcessData>): Promise<void> {
  const store = useProcessStore.getState();
  await store.updateProcesses(processes);
}

// Helper functions to access running processes from store
function getRunningProcess(worktreePath: string): RunningProcess | undefined {
  return useProcessStore.getState().getRunningProcess(worktreePath);
}

function setRunningProcess(worktreePath: string, processData: RunningProcess): void {
  useProcessStore.getState().setRunningProcess(worktreePath, processData);
}

function removeRunningProcess(worktreePath: string): void {
  useProcessStore.getState().removeRunningProcess(worktreePath);
}

// Check if a process is still running
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    const { stdout } = await executeCommand(`ps -p ${pid} -o pid=`);
    return stdout.trim() !== "";
  } catch {
    return false;
  }
}

// Get all child PIDs of a process
async function getChildPids(parentPid: number): Promise<number[]> {
  try {
    // Use pgrep to find all processes whose parent is the given PID
    const { stdout } = await executeCommand(`pgrep -P ${parentPid}`);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((pid) => parseInt(pid, 10))
      .filter((pid) => !isNaN(pid));
  } catch {
    // No children found or pgrep not available
    return [];
  }
}

// Recursively get all descendant PIDs
async function getAllDescendantPids(pid: number): Promise<number[]> {
  const children = await getChildPids(pid);
  const allPids = [...children];

  // Recursively get children of children
  for (const childPid of children) {
    const descendants = await getAllDescendantPids(childPid);
    allPids.push(...descendants);
  }

  return allPids;
}

// Kill a process by PID (and all its children)
export async function killProcess(pid: number, force = false): Promise<void> {
  try {
    // First try to kill the entire process group (negative PID)
    // This is the most effective way for detached processes started with shells
    try {
      await executeCommand(`kill ${force ? "-9" : "-TERM"} -- -${pid}`);
      // Give it a moment to clean up
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      // Process group kill might fail if process is not a group leader
    }

    // Get all processes in the session (including subprocesses)
    try {
      // Use ps to find all processes with the same session ID (SID)
      const { stdout: sessionProcs } = await executeCommand(
        `ps -eo pid,sid,ppid,command | awk '$2 == ${pid} {print $1}' | grep -v "^${pid}$"`,
      );
      const sessionPids = sessionProcs
        .split("\n")
        .filter(Boolean)
        .map((p) => parseInt(p, 10))
        .filter((p) => !isNaN(p));

      // Kill all session processes
      for (const spid of sessionPids) {
        try {
          await executeCommand(`kill ${force ? "-9" : "-15"} ${spid}`);
        } catch {
          // Process might already be dead
        }
      }
    } catch {
      // Session-based kill might not work on all systems
    }

    // Get all child processes recursively
    const childPids = await getAllDescendantPids(pid);

    // Kill children first (bottom-up to avoid orphans)
    for (const childPid of childPids.reverse()) {
      try {
        await executeCommand(`kill ${force ? "-9" : "-15"} ${childPid}`);
      } catch {
        // Child might already be dead
      }
    }

    // Finally kill the parent process itself
    try {
      await executeCommand(`kill ${force ? "-9" : "-15"} ${pid}`);
    } catch {
      // Parent might already be dead from group kill
    }

    // Double-check with pkill as a fallback
    try {
      // Use pkill to find any remaining processes started by this PID
      await executeCommand(`pkill -P ${pid}`);
    } catch {
      // pkill might not find anything, that's ok
    }
  } catch {
    // If all gentle methods fail and we haven't tried force yet
    if (!force) {
      await killProcess(pid, true);
    }
    // If force kill also fails, the process is likely already gone
  }
}

// Start a new process
export async function startProcess(
  worktreePath: string,
  command: string,
  args: string[] = [],
  onOutput?: (output: ProcessOutput) => void,
  host?: string,
  trackProcess: boolean = true, // New parameter: whether to track this process in LocalStorage
): Promise<ProcessInfo> {
  // Invalidate cache when starting a process
  invalidateProcessCache();

  // Check if directory exists
  try {
    const { stdout: dirCheck } = await executeCommand(`test -d "${worktreePath}" && echo "exists"`);
    if (dirCheck.trim() !== "exists") {
      throw new Error(`Directory does not exist: ${worktreePath}`);
    }
  } catch {
    throw new Error(`Directory does not exist: ${worktreePath}`);
  }

  // Check if package.json exists (for npm/pnpm/yarn commands)
  const baseCommand = command.split("/").pop() || command;
  if (["npm", "pnpm", "yarn", "bun", "turbo", "nx"].includes(baseCommand)) {
    try {
      const { stdout: pkgCheck } = await executeCommand(`test -f "${worktreePath}/package.json" && echo "exists"`);
      if (pkgCheck.trim() !== "exists") {
        throw new Error(`No package.json found in ${worktreePath}. This doesn't appear to be a Node.js project.`);
      }
    } catch {
      throw new Error(`No package.json found in ${worktreePath}. This doesn't appear to be a Node.js project.`);
    }
  }

  // Stop any running process we're tracking
  const existing = getRunningProcess(worktreePath);
  if (existing) {
    await stopProcess(worktreePath);
  }

  const outputBuffer = new CircularBuffer<string>(MAX_OUTPUT_LINES);
  const errorBuffer = new CircularBuffer<string>(MAX_OUTPUT_LINES);

  // Set up environment with proper PATH
  // Get Node.js binary path
  const nodePath = process.execPath;
  const nodeDir = nodePath.substring(0, nodePath.lastIndexOf("/"));

  // Common paths where package managers might be installed
  const homeDir = process.env.HOME || "";
  const additionalPaths = [
    `${homeDir}/.local/share/pnpm`,
    `${homeDir}/.pnpm`,
    `${homeDir}/Library/pnpm`,
    `${homeDir}/.npm-global/bin`,
    `${homeDir}/.yarn/bin`,
    `${homeDir}/.config/yarn/global/node_modules/.bin`,
    `${homeDir}/.bun/bin`,
    `${homeDir}/.deno/bin`,
    `${homeDir}/.cargo/bin`,
    `${homeDir}/.volta/bin`,
    `${homeDir}/.fnm`,
    "/opt/homebrew/bin",
    "/opt/homebrew/opt/node/bin",
    "/usr/local/bin",
    nodeDir,
  ]
    .filter(Boolean)
    .join(":");

  const processEnv = {
    ...process.env,
    FORCE_COLOR: "1",
    // Add common paths to PATH to ensure child processes can find commands
    PATH: `${additionalPaths}:${process.env.PATH || "/usr/bin:/bin"}`,
    // Set HOST for dev server if provided
    ...(host ? { HOST: host } : {}),
  };

  // Create output log files
  const timestamp = Date.now();
  const outputFile = `/tmp/raycast-worktree-output-${timestamp}.log`;
  const errorFile = `/tmp/raycast-worktree-error-${timestamp}.log`;

  // Open file descriptors for output redirection
  const out = openSync(outputFile, "a");
  const err = openSync(errorFile, "a");

  // Combine command and args into a single command string for shell execution
  const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;

  // Get the user's default shell and build command with profile
  const userShell = getUserShell();
  const commandWithProfile = buildCommandWithProfile(fullCommand);

  // Spawn the process through a shell for better compatibility
  // Using -c to execute the command (not -l which might be slower)
  const childProcess = spawn(userShell, ["-c", commandWithProfile], {
    cwd: worktreePath,
    env: processEnv,
    detached: true,
    stdio: ["ignore", out, err], // Ignore stdin, redirect stdout/stderr to files
    shell: false, // We're already using shell with -c
  });

  // Close the file descriptors in the parent
  closeSync(out);
  closeSync(err);

  // Unref the child process so parent can exit independently
  childProcess.unref();

  const pid = childProcess.pid;

  if (!pid) {
    throw new Error("Failed to start detached process");
  }

  // Set up tail processes to read the output files
  const tailStdout = spawn("tail", ["-f", outputFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tailStderr = spawn("tail", ["-f", errorFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Check if the process actually started
  if (!pid) {
    throw new Error("Failed to spawn process - no PID returned");
  }

  const info: ProcessInfo = {
    pid: pid,
    command: args.length > 0 ? `${command} ${args.join(" ")}` : command,
    args: [],
    cwd: worktreePath,
    startTime: new Date(),
    outputBuffer: [],
    errorBuffer: [],
    status: "running",
    outputFile,
    errorFile,
    host,
  };

  // Clean up tail processes and files when main process exits
  const cleanup = async () => {
    tailStdout.kill();
    tailStderr.kill();
    // Keep files for a while in case user wants to check them
    setTimeout(() => {
      executeCommand(`rm -f "${outputFile}" "${errorFile}"`).catch(() => {});
    }, 60000); // Clean up after 1 minute
  };

  // Monitor the actual process
  const monitorProcess = setInterval(async () => {
    const isRunning = await isProcessRunning(pid);
    if (!isRunning) {
      clearInterval(monitorProcess);
      cleanup();
      // Update status
      info.status = "stopped";
      // Emit exit event
      removeRunningProcess(worktreePath);
      const stored = await getStoredProcesses();
      if (stored[worktreePath]) {
        await deallocateHost(worktreePath);
        delete stored[worktreePath];
        await storeProcesses(stored);
      }
    }
  }, 1000);

  // Handle stdout from tail process
  tailStdout.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    const lines = text.split("\n");

    lines.forEach((line: string) => {
      if (line.trim()) {
        // Only push non-empty lines
        outputBuffer.push(line);
        onOutput?.({ type: "stdout", data: line, timestamp: new Date() });
      }
    });
    info.outputBuffer = outputBuffer.toArray();
  });

  // Handle stderr from tail process
  tailStderr.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    const lines = text.split("\n");

    lines.forEach((line: string) => {
      if (line.trim()) {
        // Only push non-empty lines
        errorBuffer.push(line);
        onOutput?.({ type: "stderr", data: line, timestamp: new Date() });
      }
    });
    info.errorBuffer = errorBuffer.toArray();
  });

  // Handle process error (detached processes don't emit error events to parent)
  // Errors will be captured in the stderr file instead

  // Only track process if requested (don't track setup scripts)
  if (trackProcess) {
    // Store process info with tail processes for cleanup
    setRunningProcess(worktreePath, { process: childProcess, info, tailProcesses: [tailStdout, tailStderr] });

    // Update LocalStorage with full process data
    const stored = await getStoredProcesses();
    stored[worktreePath] = {
      pid: childProcess.pid!,
      command,
      args,
      outputFile,
      errorFile,
      startTime: info.startTime.toISOString(),
      host,
    };
    await storeProcesses(stored);
  }

  // Add minimal initial message if no output yet
  if (info.outputBuffer.length === 0 && info.errorBuffer.length === 0) {
    info.outputBuffer.push("Starting dev server...");
  }

  return info;
}

// Stop a process
export async function stopProcess(worktreePath: string): Promise<void> {
  // Invalidate cache when stopping a process
  invalidateProcessCache();

  const running = getRunningProcess(worktreePath);

  if (running) {
    const { info, tailProcesses } = running;

    // Kill tail processes first
    if (tailProcesses) {
      tailProcesses.forEach((tail) => {
        try {
          tail.kill();
        } catch {
          // Tail process might already be dead
        }
      });
    }

    // Kill the process by PID (since it's detached)
    try {
      await killProcess(info.pid);

      // Wait a bit to ensure processes are terminated
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Double-check if any processes are still running
      const isStillRunning = await isProcessRunning(info.pid);
      if (isStillRunning) {
        // Force kill if still running
        await killProcess(info.pid, true);
      }
    } catch {
      // Try force kill
      try {
        await killProcess(info.pid, true);
      } catch {
        // Process might have already exited
      }
    }

    // Additional cleanup: Try to kill any orphaned node processes in the worktree directory
    try {
      // Find any node/npm/yarn/pnpm processes still running in this directory
      const { stdout: orphans } = await executeCommand(
        `ps aux | grep -E "(node|npm|yarn|pnpm|bun|deno|tsx|ts-node)" | grep "${worktreePath}" | grep -v grep | awk '{print $2}'`,
      );
      const orphanPids = orphans
        .split("\n")
        .filter(Boolean)
        .map((p) => parseInt(p, 10))
        .filter((p) => !isNaN(p));

      for (const orphanPid of orphanPids) {
        try {
          await executeCommand(`kill -9 ${orphanPid}`);
        } catch {
          // Orphan might already be dead
        }
      }
    } catch {
      // No orphans found or command failed
    }

    info.status = "stopped";
    removeRunningProcess(worktreePath);
  }

  // Update stored processes and deallocate host
  const stored = await getStoredProcesses();
  if (stored[worktreePath]) {
    // Deallocate the host if one was allocated
    await deallocateHost(worktreePath);
    delete stored[worktreePath];
    await storeProcesses(stored);
  }
}

// Get process info for a worktree
export function getProcessInfo(worktreePath: string): ProcessInfo | null {
  return useProcessStore.getState().getProcessInfo(worktreePath);
}

// Get all running processes
export function getAllRunningProcesses(): Map<string, ProcessInfo> {
  return useProcessStore.getState().getAllRunningProcesses();
}

// Restore a process from stored data
async function restoreProcessFromStorage(worktreePath: string, data: StoredProcessData): Promise<void> {
  // If the process has a host, restore the allocation in the host store
  if (data.host) {
    const hostStore = (await import("#/stores/host-allocation-store")).default;
    const state = hostStore.getState();

    // Check if this host is already allocated to this worktree
    const existingHost = state.getHostForWorktree(worktreePath);
    if (!existingHost) {
      // Manually add the allocation
      const updatedAllocations = {
        ...state.allocations,
        [worktreePath]: {
          host: data.host,
          worktreePath,
          allocatedAt: data.startTime,
        },
      };

      // Update the store
      hostStore.setState({ allocations: updatedAllocations });

      // Persist to LocalStorage
      const { LocalStorage } = await import("@raycast/api");
      await LocalStorage.setItem("worktree-host-allocations", JSON.stringify(updatedAllocations));
    }
  }

  // Check if files still exist
  let hasOutputFile = false;
  let hasErrorFile = false;

  if (data.outputFile) {
    try {
      const { stdout } = await executeCommand(`test -f "${data.outputFile}" && echo "exists"`);
      hasOutputFile = stdout.trim() === "exists";
    } catch {
      hasOutputFile = false;
    }
  }

  if (data.errorFile) {
    try {
      const { stdout } = await executeCommand(`test -f "${data.errorFile}" && echo "exists"`);
      hasErrorFile = stdout.trim() === "exists";
    } catch {
      hasErrorFile = false;
    }
  }

  // If we have at least one log file, restore the process
  if (hasOutputFile || hasErrorFile) {
    const outputBuffer = new CircularBuffer<string>(MAX_OUTPUT_LINES);
    const errorBuffer = new CircularBuffer<string>(MAX_OUTPUT_LINES);

    // Read existing content from files
    if (hasOutputFile && data.outputFile) {
      try {
        const { stdout } = await executeCommand(`tail -n 1000 "${data.outputFile}"`);
        stdout.split("\n").forEach((line) => {
          if (line.trim()) outputBuffer.push(line);
        });
      } catch {
        // Ignore errors reading file
      }
    }

    if (hasErrorFile && data.errorFile) {
      try {
        const { stdout } = await executeCommand(`tail -n 1000 "${data.errorFile}"`);
        stdout.split("\n").forEach((line) => {
          if (line.trim()) errorBuffer.push(line);
        });
      } catch {
        // Ignore errors reading file
      }
    }

    const info: ProcessInfo = {
      pid: data.pid,
      command: data.command,
      args: data.args,
      cwd: worktreePath,
      startTime: new Date(data.startTime),
      outputBuffer: outputBuffer.toArray(),
      errorBuffer: errorBuffer.toArray(),
      status: "running",
      outputFile: data.outputFile,
      errorFile: data.errorFile,
      host: data.host,
    };

    // Array to store tail processes for cleanup
    const tailProcesses: ChildProcess[] = [];

    // Set up tail processes to continue reading output
    if (hasOutputFile && data.outputFile) {
      const tailStdout = spawn("tail", ["-f", data.outputFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      tailProcesses.push(tailStdout);

      tailStdout.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n");

        lines.forEach((line: string) => {
          if (line.trim()) {
            outputBuffer.push(line);
          }
        });
        info.outputBuffer = outputBuffer.toArray();
      });
    }

    if (hasErrorFile && data.errorFile) {
      const tailStderr = spawn("tail", ["-f", data.errorFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      tailProcesses.push(tailStderr);

      tailStderr.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n");

        lines.forEach((line: string) => {
          if (line.trim()) {
            errorBuffer.push(line);
          }
        });
        info.errorBuffer = errorBuffer.toArray();
      });
    }

    // Store in running processes map (without ChildProcess since it's detached)
    setRunningProcess(worktreePath, { process: {} as ChildProcess, info, tailProcesses });

    // Monitor the process
    const monitorProcess = setInterval(async () => {
      const isRunning = await isProcessRunning(data.pid);
      if (!isRunning) {
        clearInterval(monitorProcess);
        // Clean up tail processes
        tailProcesses.forEach((tail) => {
          try {
            tail.kill();
          } catch {
            // Tail process might already be dead
          }
        });
        removeRunningProcess(worktreePath);
        const stored = await getStoredProcesses();
        if (stored[worktreePath]) {
          await deallocateHost(worktreePath);
          delete stored[worktreePath];
          await storeProcesses(stored);
        }
      }
    }, 5000); // Check every 5 seconds
  }
}

// Clean up orphaned processes and restore running ones
export async function cleanupOrphanedProcesses(): Promise<void> {
  // Ensure process store is initialized
  const store = useProcessStore.getState();
  await store.initializeStore();

  // First, kill any orphaned tail processes
  try {
    // Find all tail processes that might be orphaned
    const { stdout: tailPids } = await executeCommand(
      `ps aux | grep 'tail -f /tmp/raycast-worktree' | grep -v grep | awk '{print $2}'`,
    );
    const pids = tailPids
      .split("\n")
      .filter(Boolean)
      .map((p) => parseInt(p, 10))
      .filter((p) => !isNaN(p));

    // Kill all orphaned tail processes
    for (const pid of pids) {
      try {
        await executeCommand(`kill -9 ${pid}`);
      } catch {
        // Process might already be dead
      }
    }
  } catch {
    // No tail processes found or command failed
  }

  const stored = await getStoredProcesses();

  for (const [path, data] of Object.entries(stored)) {
    // Check if the worktree directory still exists
    let directoryExists = false;
    try {
      const { stdout: dirCheck } = await executeCommand(`test -d "${path}" && echo "exists"`);
      directoryExists = dirCheck.trim() === "exists";
    } catch {
      directoryExists = false;
    }

    // If directory doesn't exist, clean up the process info
    if (!directoryExists) {
      delete stored[path];
      await deallocateHost(path);
      continue;
    }

    // Check if process is still running
    const isRunning = await isProcessRunning(data.pid);

    if (!isRunning) {
      // Process is dead - clean it up
      delete stored[path];
      await deallocateHost(path);
    } else {
      // Process is still running, try to restore it
      await restoreProcessFromStorage(path, data);
    }
  }

  await storeProcesses(stored);
}

// Get detailed information about a process
export async function getProcessDetails(worktreePath: string, pid?: number): Promise<string> {
  const details: string[] = [];

  try {
    // If we have a specific PID, get its details
    if (pid) {
      details.push("## Process Information\n");

      // Get CPU and memory usage
      try {
        const { stdout: topOutput } = await executeCommand(`ps -p ${pid} -o %cpu,%mem,rss,vsz,command | tail -n +2`);
        if (topOutput.trim()) {
          const parts = topOutput.trim().split(/\s+/);
          const [cpu, mem, rss, vsz] = parts;
          const command = parts.slice(4).join(" ");
          details.push(`**Command:** \`${command}\``);
          details.push("## Resource Usage\n");
          details.push(`**CPU:** ${cpu}%`);
          details.push(`**Memory:** ${mem}%`);
          details.push(`**RSS:** ${(parseInt(rss) / 1024).toFixed(1)} MB`);
          details.push(`**VSZ:** ${(parseInt(vsz) / 1024).toFixed(1)} MB`);
          details.push("");
        }
      } catch {
        // Failed to get resource usage
      }

      // Get open ports
      try {
        const { stdout: lsofOutput } = await executeCommand(
          `lsof -p ${pid} -i -P | grep LISTEN | awk '{print $9}' | sort -u`,
        );
        if (lsofOutput.trim()) {
          details.push("## Open Ports\n");
          const ports = lsofOutput.trim().split("\n");
          ports.forEach((port) => {
            details.push(`- ${port}`);
          });
          details.push("");
        }
      } catch {
        // Failed to get open ports
      }

      // Get environment variables (filter sensitive ones)
      try {
        const { stdout: envOutput } = await executeCommand(
          `ps eww -p ${pid} | tail -n +2 | tr ' ' '\\n' | grep -E '^(NODE_ENV|PORT|HOST)=' | sort`,
        );
        if (envOutput.trim()) {
          details.push("## Environment Variables\n");
          const envVars = envOutput.trim().split("\n");
          envVars.forEach((envVar) => {
            details.push(`- \`${envVar}\``);
          });
          details.push("");
        }
      } catch {
        // Failed to get environment variables
      }

      // Get host information from stored process data
      const stored = await getStoredProcesses();
      const processData = Object.values(stored).find((data) => data.pid === pid);
      if (processData?.host) {
        details.push("## Host Information\n");
        details.push(`**Allocated Host:** ${processData.host}`);
        details.push("");
      }
    } else {
      details.push("No process information available.");
    }

    // Add timestamp
    details.push("---");
    details.push(`*Last updated: ${new Date().toLocaleString()}*`);
  } catch (error) {
    details.push(`Error getting process details: ${error}`);
  }

  return details.join("\n");
}

// Invalidate the process cache (kept for compatibility)
export function invalidateProcessCache() {
  // No longer using cache
}

// Get all worktree paths from projects
export async function getAllWorktreePaths(): Promise<string[]> {
  try {
    const { getWorktreeFromCacheOrFetch } = await import("./file");
    const { getPreferences } = await import("./raycast");
    const { projectsPath } = getPreferences();

    const projects = await getWorktreeFromCacheOrFetch(projectsPath);
    const worktreePaths = projects.flatMap((project) => project.worktrees.map((w) => w.path));

    return worktreePaths;
  } catch {
    return [];
  }
}

// Detect running processes based on LocalStorage
export async function detectExternalProcesses(worktreePaths: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();

  try {
    // Get stored processes
    const stored = await getStoredProcesses();

    // Check which stored processes are still running
    for (const [path, data] of Object.entries(stored)) {
      if (worktreePaths.includes(path)) {
        const isRunning = await isProcessRunning(data.pid);
        if (isRunning) {
          result.set(path, [data.pid]);
        } else {
          // Clean up dead process from storage
          delete stored[path];
        }
      }
    }

    // Update storage if we cleaned up any dead processes
    await storeProcesses(stored);
  } catch {
    // Silent error - process detection failed
  }

  return result;
}

// Helper function to check if output contains the success message
function isSuccessMessage(output: string): boolean {
  const lowerOutput = output.toLowerCase();
  // Check for various common success indicators
  return (
    output.includes(DEV_SERVER_SUCCESS_MESSAGE) ||
    lowerOutput.includes("ready") ||
    lowerOutput.includes("compiled successfully") ||
    lowerOutput.includes("started on") ||
    lowerOutput.includes("listening on") ||
    lowerOutput.includes("server running") ||
    lowerOutput.includes("dev server running") ||
    (lowerOutput.includes("local") && lowerOutput.includes("http")) ||
    lowerOutput.includes("webpack compiled")
  );
}

// Helper function to check if output indicates a failure
function isFailureMessage(output: string): boolean {
  const lowerOutput = output.toLowerCase();
  return (
    lowerOutput.includes("exited with code") ||
    lowerOutput.includes("command failed") ||
    lowerOutput.includes("elifecycle") ||
    lowerOutput.includes("failed to connect") ||
    lowerOutput.includes("error:") ||
    lowerOutput.includes("cannot find module") ||
    lowerOutput.includes("module not found")
  );
}

// Start a process and wait for it to be ready
export async function startProcessAndWaitForReady(
  worktreePath: string,
  command: string,
  args: string[] = [],
  host?: string,
  timeoutMs?: number,
): Promise<{ success: boolean; processInfo?: ProcessInfo; error?: string }> {
  let processInfo: ProcessInfo | undefined;
  let resolved = false;

  return new Promise((resolve) => {
    // Use provided timeout or default to 60 seconds (good for monorepos)
    const TOTAL_TIMEOUT_MS = timeoutMs || 60000; // Total timeout
    const IDLE_TIMEOUT_MS = 20000; // 20 seconds without output
    let hasReceivedOutput = false;
    let lastOutputTime = Date.now();
    const startTime = Date.now();

    // Check periodically if we should timeout
    const timeoutCheck = setInterval(() => {
      if (resolved) {
        clearInterval(timeoutCheck);
        return;
      }

      const now = Date.now();
      const totalElapsed = now - startTime;
      const idleTime = now - lastOutputTime;

      // Timeout if total time exceeded
      if (totalElapsed > TOTAL_TIMEOUT_MS) {
        resolved = true;
        clearInterval(timeoutCheck);

        if (processInfo && processInfo.status === "running" && hasReceivedOutput) {
          resolve({ success: true, processInfo });
        } else {
          resolve({
            success: false,
            processInfo,
            error: `Process did not start successfully within ${TOTAL_TIMEOUT_MS / 1000} seconds`,
          });
        }
      }
      // Timeout if no output for too long (but only after we've received some output)
      else if (hasReceivedOutput && idleTime > IDLE_TIMEOUT_MS) {
        resolved = true;
        clearInterval(timeoutCheck);

        if (processInfo && processInfo.status === "running") {
          resolve({ success: true, processInfo });
        } else {
          resolve({
            success: false,
            processInfo,
            error: `Process stopped producing output for ${IDLE_TIMEOUT_MS / 1000} seconds`,
          });
        }
      }
    }, 1000); // Check every second

    // Start the process
    startProcess(
      worktreePath,
      command,
      args,
      (output) => {
        hasReceivedOutput = true;
        lastOutputTime = Date.now();

        // Check for failure first
        if (!resolved && isFailureMessage(output.data)) {
          resolved = true;
          clearInterval(timeoutCheck);

          // Extract error message if possible
          let errorMessage = "Process failed to start";
          if (output.data.toLowerCase().includes("exited with code")) {
            errorMessage = output.data;
          } else if (output.data.toLowerCase().includes("failed to connect")) {
            errorMessage = "Failed to connect to daemon";
          } else if (output.data.toLowerCase().includes("command failed")) {
            errorMessage = "Command failed";
          }

          resolve({
            success: false,
            processInfo,
            error: errorMessage,
          });

          // Stop the process if it's still marked as running
          if (processInfo) {
            stopProcess(worktreePath).catch(() => {
              // Ignore errors when stopping failed process
            });
          }
        } else if (!resolved && processInfo && isSuccessMessage(output.data)) {
          // Check if success message appears
          resolved = true;
          clearInterval(timeoutCheck);
          resolve({ success: true, processInfo });
        }
      },
      host,
    )
      .then((info) => {
        processInfo = info;
        // Process started successfully, now we wait for success message or timeout
      })
      .catch((error) => {
        clearInterval(timeoutCheck);
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error occurred",
          });
        }
      });
  });
}
