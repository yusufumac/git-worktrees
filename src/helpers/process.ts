import { LocalStorage } from "@raycast/api";
import { ChildProcess, spawn } from "child_process";
import { openSync, closeSync } from "fs";
import { executeCommand } from "./general";
import find from "find-process";
import { DEV_SERVER_SUCCESS_MESSAGE, DEV_SERVER_TIMEOUT_MS } from "#/config/constants";

export interface ProcessInfo {
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startTime: Date;
  outputBuffer: string[];
  errorBuffer: string[];
  status: "running" | "stopped" | "error";
  outputFile?: string;
  errorFile?: string;
}

export interface ProcessOutput {
  type: "stdout" | "stderr";
  data: string;
  timestamp: Date;
}

const PROCESS_STORAGE_KEY = "worktree-processes";
const MAX_OUTPUT_LINES = 50000; // Increased buffer size for more output

// Map to store running processes in memory
const runningProcesses = new Map<string, { process: ChildProcess; info: ProcessInfo }>();

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

// Stored process data structure
interface StoredProcessData {
  pid: number;
  command: string;
  args: string[];
  outputFile?: string;
  errorFile?: string;
  startTime: string;
}

// Get stored process data from LocalStorage
async function getStoredProcesses(): Promise<Record<string, StoredProcessData>> {
  try {
    const stored = await LocalStorage.getItem<string>(PROCESS_STORAGE_KEY);
    if (!stored) return {};
    
    const data = JSON.parse(stored);
    // Handle legacy format (just PIDs)
    if (typeof Object.values(data)[0] === 'number') {
      // Convert legacy format to new format
      const converted: Record<string, StoredProcessData> = {};
      for (const [path, pid] of Object.entries(data)) {
        converted[path] = {
          pid: pid as number,
          command: 'unknown',
          args: [],
          startTime: new Date().toISOString()
        };
      }
      return converted;
    }
    return data;
  } catch {
    return {};
  }
}

// Store process data in LocalStorage
async function storeProcesses(processes: Record<string, StoredProcessData>): Promise<void> {
  await LocalStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(processes));
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

// Find processes running in a specific directory
export async function findProcessesInDirectory(directory: string): Promise<number[]> {
  try {
    // Find only processes named "node"
    const nodeProcesses = await find("name", "node");

    // Filter processes that are related to our directory
    const relevantProcesses: typeof nodeProcesses = [];

    for (const proc of nodeProcesses) {
      // Check if the command includes our directory path (case-insensitive on macOS)
      if (proc.cmd && proc.cmd.toLowerCase().includes(directory.toLowerCase())) {
        // Verify it's actually a Node.js dev server
        const cmdLower = proc.cmd.toLowerCase();

        // Exclude known non-server tools
        const isExcluded =
          cmdLower.includes("biome") ||
          cmdLower.includes("eslint") ||
          cmdLower.includes("prettier") ||
          cmdLower.includes("typescript-language-server") ||
          cmdLower.includes("tsserver") ||
          cmdLower.includes("copilot") ||
          cmdLower.includes("visual studio code") ||
          cmdLower.includes("code helper") ||
          cmdLower.includes("lsp") ||
          cmdLower.includes("language-server") ||
          cmdLower.includes("/typescript/lib/") || // TypeScript lib files
          cmdLower.includes("typingsinstaller");

        // Check if it's a dev server
        const isDevServer =
          !isExcluded &&
          (cmdLower.includes("dev") ||
            cmdLower.includes("start") ||
            cmdLower.includes("serve") ||
            cmdLower.includes("watch") ||
            cmdLower.includes("webpack") ||
            cmdLower.includes("vite") ||
            cmdLower.includes("next") ||
            cmdLower.includes("localhost") ||
            cmdLower.includes(":3000") ||
            cmdLower.includes(":4000") ||
            cmdLower.includes(":5000") ||
            cmdLower.includes(":8000") ||
            cmdLower.includes(":8080"));

        // Only include if it's a dev server
        if (isDevServer) {
          relevantProcesses.push(proc);
        }
      }
    }

    const relevantPids = relevantProcesses.map((p) => p.pid);
    return relevantPids;
  } catch (error) {
    console.error("[Process] Error finding processes:", error);
    return [];
  }
}

// Kill a process by PID
export async function killProcess(pid: number, force = false): Promise<void> {
  try {
    await executeCommand(`kill ${force ? "-9" : "-15"} ${pid}`);
  } catch (error) {
    if (force) {
      throw error;
    }
    // If gentle kill fails, try force kill
    await killProcess(pid, true);
  }
}

// Kill all processes in a directory
export async function killProcessesInDirectory(directory: string): Promise<void> {
  const pids = await findProcessesInDirectory(directory);

  for (const pid of pids) {
    try {
      await killProcess(pid);
    } catch (error) {
      console.error(`Failed to kill process ${pid}:`, error);
    }
  }
}

// Start a new process
export async function startProcess(
  worktreePath: string,
  command: string,
  args: string[] = [],
  onOutput?: (output: ProcessOutput) => void,
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
  if (["npm", "pnpm", "yarn"].includes(baseCommand)) {
    try {
      const { stdout: pkgCheck } = await executeCommand(`test -f "${worktreePath}/package.json" && echo "exists"`);
      if (pkgCheck.trim() !== "exists") {
        throw new Error(`No package.json found in ${worktreePath}. This doesn't appear to be a Node.js project.`);
      }
    } catch {
      throw new Error(`No package.json found in ${worktreePath}. This doesn't appear to be a Node.js project.`);
    }
  }

  // Check if command is available and get full path
  let commandPath = command;

  // First check if the command is already a full path
  if (command.startsWith("/")) {
    try {
      const { stdout: exists } = await executeCommand(`test -x "${command}" && echo "exists"`);
      if (exists.trim() === "exists") {
        commandPath = command;
      } else {
        throw new Error(`Command not found at path: ${command}`);
      }
    } catch {
      throw new Error(`Command not found at path: ${command}`);
    }
  } else {
    try {
      // Try with standard which
      const { stdout: cmdCheck } = await executeCommand(`which ${command}`);
      commandPath = cmdCheck.trim();
    } catch {
      // Try common paths for package managers
      const commonPaths = [
        `/usr/local/bin/${command}`,
        `/opt/homebrew/bin/${command}`,
        `$HOME/.npm/bin/${command}`,
        `$HOME/.yarn/bin/${command}`,
        `$HOME/.pnpm/${command}`,
        `/usr/bin/${command}`,
        `/bin/${command}`,
        // nvm paths
        `$HOME/.nvm/versions/node/*/bin/${command}`,
        // fnm paths
        `$HOME/.fnm/node-versions/*/installation/bin/${command}`,
        `$HOME/Library/Application Support/fnm/node-versions/*/installation/bin/${command}`,
        // volta paths
        `$HOME/.volta/bin/${command}`,
        // asdf paths
        `$HOME/.asdf/installs/nodejs/*/bin/${command}`,
      ];

      let found = false;

      for (const path of commonPaths) {
        try {
          const expandedPath = path.replace("$HOME", process.env.HOME || "");

          // For paths with wildcards, use find
          if (expandedPath.includes("*")) {
            const dir = expandedPath.substring(0, expandedPath.lastIndexOf("/"));
            const pattern = expandedPath.substring(expandedPath.lastIndexOf("/") + 1);
            const { stdout: findResult } = await executeCommand(
              `find "${dir}" -name "${pattern}" -type f -executable 2>/dev/null | head -1`,
            );
            if (findResult.trim()) {
              commandPath = findResult.trim();
              found = true;
              break;
            }
          } else {
            // For exact paths, use test
            const { stdout: exists } = await executeCommand(`test -x "${expandedPath}" && echo "exists"`);
            if (exists.trim() === "exists") {
              commandPath = expandedPath;
              found = true;
              break;
            }
          }
        } catch {
          // Path doesn't exist or isn't executable, continue searching
        }
      }

      if (!found) {
        // Try to find it with a more comprehensive search
        try {
          const { stdout: findResult } = await executeCommand(
            `find /usr/local/bin /opt/homebrew/bin $HOME/.npm/bin $HOME/.yarn/bin /usr/bin -name "${command}" -type f -executable 2>/dev/null | head -1`,
          );
          if (findResult.trim()) {
            commandPath = findResult.trim();
            found = true;
          }
        } catch {
          // Comprehensive search failed
        }
      }

      if (!found) {
        throw new Error(
          `Command not found: ${command}. You may need to use npm instead of pnpm, or specify the full path in preferences.`,
        );
      }
    }
  }

  // Stop any running process we're tracking
  const existing = runningProcesses.get(worktreePath);
  if (existing) {
    await stopProcess(worktreePath);
  }

  const outputBuffer = new CircularBuffer<string>(MAX_OUTPUT_LINES);
  const errorBuffer = new CircularBuffer<string>(MAX_OUTPUT_LINES);

  // Set up environment with proper PATH
  // Get Node.js binary path
  const nodePath = process.execPath;
  const nodeDir = nodePath.substring(0, nodePath.lastIndexOf("/"));

  const processEnv = {
    ...process.env,
    FORCE_COLOR: "1",
    // Add common paths to PATH to ensure child processes can find commands
    // Include the directory containing the current Node.js binary
    PATH: `${nodeDir}:/usr/local/bin:/opt/homebrew/bin:${process.env.HOME}/.npm/bin:${process.env.HOME}/.yarn/bin:${process.env.HOME}/.nvm/versions/node/*/bin:${process.env.HOME}/.fnm/node-versions/*/installation/bin:${process.env.HOME}/.volta/bin:${process.env.PATH || "/usr/bin:/bin"}`,
  };

  // Create output log files
  const timestamp = Date.now();
  const outputFile = `/tmp/raycast-worktree-output-${timestamp}.log`;
  const errorFile = `/tmp/raycast-worktree-error-${timestamp}.log`;

  // Open file descriptors for output redirection
  const out = openSync(outputFile, "a");
  const err = openSync(errorFile, "a");

  // Spawn the process as completely detached
  const childProcess = spawn(commandPath, args, {
    cwd: worktreePath,
    env: processEnv,
    detached: true,
    stdio: ["ignore", out, err], // Ignore stdin, redirect stdout/stderr to files
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
      // Emit exit event
      runningProcesses.delete(worktreePath);
      const stored = await getStoredProcesses();
      delete stored[worktreePath];
      await storeProcesses(stored);
    }
  }, 1000);

  // Check if the process actually started
  if (!pid) {
    throw new Error("Failed to spawn process");
  }

  const info: ProcessInfo = {
    pid: pid,
    command,
    args,
    cwd: worktreePath,
    startTime: new Date(),
    outputBuffer: [],
    errorBuffer: [],
    status: "running",
    outputFile,
    errorFile,
  };

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

  // Store process info
  runningProcesses.set(worktreePath, { process: childProcess, info });

  // Update LocalStorage with full process data
  const stored = await getStoredProcesses();
  stored[worktreePath] = {
    pid: childProcess.pid!,
    command,
    args,
    outputFile,
    errorFile,
    startTime: info.startTime.toISOString(),
  };
  await storeProcesses(stored);

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

  const running = runningProcesses.get(worktreePath);

  if (running) {
    const { info } = running;

    // Kill the process by PID (since it's detached)
    try {
      await killProcess(info.pid);
    } catch {
      // Try force kill
      try {
        await killProcess(info.pid, true);
      } catch {
        // Process might have already exited
      }
    }

    info.status = "stopped";
    runningProcesses.delete(worktreePath);
  }

  // Also kill any processes we might have missed
  await killProcessesInDirectory(worktreePath);

  // Update stored processes
  const stored = await getStoredProcesses();
  delete stored[worktreePath];
  await storeProcesses(stored);
}

// Get process info for a worktree
export function getProcessInfo(worktreePath: string): ProcessInfo | null {
  const running = runningProcesses.get(worktreePath);
  return running?.info || null;
}

// Get all running processes
export function getAllRunningProcesses(): Map<string, ProcessInfo> {
  const result = new Map<string, ProcessInfo>();

  runningProcesses.forEach((value, key) => {
    result.set(key, value.info);
  });

  return result;
}

// Restore a process from stored data
async function restoreProcessFromStorage(worktreePath: string, data: StoredProcessData): Promise<void> {
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
        stdout.split('\n').forEach(line => {
          if (line.trim()) outputBuffer.push(line);
        });
      } catch {
        // Ignore errors reading file
      }
    }
    
    if (hasErrorFile && data.errorFile) {
      try {
        const { stdout } = await executeCommand(`tail -n 1000 "${data.errorFile}"`);
        stdout.split('\n').forEach(line => {
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
    };
    
    // Set up tail processes to continue reading output
    if (hasOutputFile && data.outputFile) {
      const tailStdout = spawn("tail", ["-f", data.outputFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      
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
    runningProcesses.set(worktreePath, { process: {} as ChildProcess, info });
    
    // Monitor the process
    const monitorProcess = setInterval(async () => {
      const isRunning = await isProcessRunning(data.pid);
      if (!isRunning) {
        clearInterval(monitorProcess);
        runningProcesses.delete(worktreePath);
        const stored = await getStoredProcesses();
        delete stored[worktreePath];
        await storeProcesses(stored);
      }
    }, 5000); // Check every 5 seconds
  }
}

// Clean up orphaned processes and restore running ones
export async function cleanupOrphanedProcesses(): Promise<void> {
  const stored = await getStoredProcesses();

  for (const [path, data] of Object.entries(stored)) {
    const isRunning = await isProcessRunning(data.pid);

    if (!isRunning) {
      delete stored[path];
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

      // Get process details using find-process
      try {
        const processes = await find("pid", pid);
        if (processes.length > 0) {
          const proc = processes[0];
          details.push(`**Command:** \`${proc.cmd || "N/A"}\``);
          details.push(`**Name:** ${proc.name}`);
          if (proc.ppid !== undefined) {
            details.push(`**Parent PID:** ${proc.ppid}`);
          }
          details.push("");
        }
      } catch {
        // Failed to get process info
      }

      // Get CPU and memory usage
      try {
        const { stdout: topOutput } = await executeCommand(`ps -p ${pid} -o %cpu,%mem,rss,vsz | tail -n +2`);
        if (topOutput.trim()) {
          const [cpu, mem, rss, vsz] = topOutput.trim().split(/\s+/);
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
    } else {
      // Find all processes in the directory
      const pids = await findProcessesInDirectory(worktreePath);

      if (pids.length > 0) {
        details.push(`## Found ${pids.length} Process${pids.length > 1 ? "es" : ""}\n`);

        for (const processPid of pids) {
          try {
            const { stdout: psOutput } = await executeCommand(`ps -p ${processPid} -o pid,command | tail -n +2`);
            if (psOutput.trim()) {
              const [pidStr, ...commandParts] = psOutput.trim().split(/\s+/);
              details.push(`### PID ${pidStr}`);
              details.push(`\`${commandParts.join(" ")}\``);
              details.push("");
            }
          } catch {
            // Process might have ended
          }
        }
      } else {
        details.push("No processes found running in this worktree directory.");
      }
    }

    // Add timestamp
    details.push("---");
    details.push(`*Last updated: ${new Date().toLocaleString()}*`);
  } catch (error) {
    details.push(`Error getting process details: ${error}`);
  }

  return details.join("\n");
}

// Cache for process detection to avoid repeated lookups
let processCache: {
  timestamp: number;
  processes: Map<string, number[]>;
} | null = null;

const CACHE_TTL = 2000; // 2 seconds cache

// Invalidate the process cache
export function invalidateProcessCache() {
  processCache = null;
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
  } catch (error) {
    console.error("[Process] Error getting worktree paths:", error);
    return [];
  }
}

// Kill all dev servers in worktree directories
export async function killAllWorktreeDevServers(worktreePaths: string[], excludePath?: string): Promise<number> {
  let killedCount = 0;

  try {
    // Find all Node.js processes
    const allNodeProcesses = await find("name", "node");

    for (const proc of allNodeProcesses) {
      if (!proc.cmd) continue;

      // Skip if it's the process we want to keep running (case-insensitive on macOS)
      if (excludePath && proc.cmd.toLowerCase().includes(excludePath.toLowerCase())) continue;

      // Check if this process belongs to any worktree (case-insensitive on macOS)
      let belongsToWorktree = false;
      for (const worktreePath of worktreePaths) {
        if (proc.cmd.toLowerCase().includes(worktreePath.toLowerCase())) {
          belongsToWorktree = true;
          break;
        }
      }

      // Skip if not in a worktree
      if (!belongsToWorktree) continue;

      const cmdLower = proc.cmd.toLowerCase();

      // Skip non-dev server processes
      const isExcluded =
        cmdLower.includes("biome") ||
        cmdLower.includes("eslint") ||
        cmdLower.includes("prettier") ||
        cmdLower.includes("typescript-language-server") ||
        cmdLower.includes("tsserver") ||
        cmdLower.includes("copilot") ||
        cmdLower.includes("visual studio code") ||
        cmdLower.includes("code helper") ||
        cmdLower.includes("lsp") ||
        cmdLower.includes("language-server") ||
        cmdLower.includes("/typescript/lib/") ||
        cmdLower.includes("typingsinstaller");

      if (isExcluded) continue;

      // Check if it's a dev server
      const isDevServer =
        cmdLower.includes("dev") ||
        cmdLower.includes("start") ||
        cmdLower.includes("serve") ||
        cmdLower.includes("watch") ||
        cmdLower.includes("webpack") ||
        cmdLower.includes("vite") ||
        cmdLower.includes("next") ||
        cmdLower.includes("localhost") ||
        cmdLower.includes(":3000") ||
        cmdLower.includes(":4000") ||
        cmdLower.includes(":5000") ||
        cmdLower.includes(":8000") ||
        cmdLower.includes(":8080");

      if (isDevServer) {
        try {
          await killProcess(proc.pid);
          killedCount++;
        } catch (error) {
          console.error(`Failed to kill process ${proc.pid}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("[Process] Error killing worktree dev servers:", error);
  }

  return killedCount;
}

// Monitor external processes - ultra-fast version
export async function detectExternalProcesses(worktreePaths: string[]): Promise<Map<string, number[]>> {
  const now = Date.now();

  // Return cached result if still fresh
  if (processCache && now - processCache.timestamp < CACHE_TTL) {
    // Filter cached results to only requested worktrees
    const result = new Map<string, number[]>();
    for (const path of worktreePaths) {
      const pids = processCache.processes.get(path);
      if (pids) {
        result.set(path, pids);
      }
    }
    return result;
  }
  const result = new Map<string, number[]>();

  try {
    // Find all Node.js processes once
    const allNodeProcesses = await find("name", "node");

    // Build a map in a single pass
    for (const proc of allNodeProcesses) {
      if (!proc.cmd) continue;

      const cmdLower = proc.cmd.toLowerCase();

      // Quick exclusion check first
      if (
        cmdLower.includes("biome") ||
        cmdLower.includes("eslint") ||
        cmdLower.includes("prettier") ||
        cmdLower.includes("lsp") ||
        cmdLower.includes("tsserver") ||
        cmdLower.includes("/typescript/lib/") ||
        cmdLower.includes("code helper") ||
        cmdLower.includes("visual studio code")
      ) {
        continue;
      }

      // Check if it's likely a dev server
      if (
        !(
          cmdLower.includes("dev") ||
          cmdLower.includes("start") ||
          cmdLower.includes("serve") ||
          cmdLower.includes("webpack") ||
          cmdLower.includes("vite")
        )
      ) {
        continue;
      }

      // Find which worktree this process belongs to (case-insensitive on macOS)
      for (const worktreePath of worktreePaths) {
        if (cmdLower.includes(worktreePath.toLowerCase())) {
          if (!result.has(worktreePath)) {
            result.set(worktreePath, []);
          }
          result.get(worktreePath)!.push(proc.pid);
          break; // A process can only belong to one worktree
        }
      }
    }

    // Update cache
    processCache = {
      timestamp: now,
      processes: result,
    };
  } catch (error) {
    console.error("[Process] Error in fast detection:", error);
  }

  return result;
}

// Helper function to check if output contains the success message
function isSuccessMessage(output: string): boolean {
  return output.includes(DEV_SERVER_SUCCESS_MESSAGE);
}

// Start a process and wait for it to be ready
export async function startProcessAndWaitForReady(
  worktreePath: string,
  command: string,
  args: string[] = [],
): Promise<{ success: boolean; processInfo?: ProcessInfo; error?: string }> {
  let processInfo: ProcessInfo | undefined;
  let resolved = false;

  return new Promise((resolve) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({
          success: false,
          processInfo,
          error: `Process did not start successfully within ${DEV_SERVER_TIMEOUT_MS / 1000} seconds`,
        });
      }
    }, DEV_SERVER_TIMEOUT_MS);

    // Start the process
    startProcess(worktreePath, command, args, (output) => {
      // Check if success message appears
      if (!resolved && processInfo && isSuccessMessage(output.data)) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ success: true, processInfo });
      }
    })
      .then((info) => {
        processInfo = info;
        // Process started successfully, now we wait for success message or timeout
      })
      .catch((error) => {
        clearTimeout(timeout);
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
