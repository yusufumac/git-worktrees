import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

// Setup script name
const SETUP_SCRIPT_NAME = "setup.sh";

export async function runSetupScript(worktreePath: string): Promise<{
  success: boolean;
  error?: string;
  errorDetails?: {
    command: string;
    stderr?: string;
    stdout?: string;
  };
  scriptPath?: string;
}> {
  // Check if setup.sh exists
  const setupScriptPath = join(worktreePath, SETUP_SCRIPT_NAME);
  const scriptExists = existsSync(setupScriptPath);

  // If no setup script found, that's fine - not all repos need one
  if (!scriptExists) {
    return { success: true };
  }

  try {
    // Make sure the script is executable
    await execAsync(`chmod +x "${setupScriptPath}"`);

    // Run the setup script
    // Use bash to ensure proper environment loading
    await execAsync(`/bin/bash "${setupScriptPath}"`, {
      cwd: worktreePath,
      env: {
        ...process.env,
        // Pass the worktree path as an environment variable in case the script needs it
        WORKTREE_PATH: worktreePath,
      },
    });

    return {
      success: true,
      scriptPath: setupScriptPath,
    };
  } catch (error) {
    const err = error as { message?: string; stderr?: string; stdout?: string; code?: number };
    const errorMessage = err?.message || "Unknown error occurred";
    const stderr = err?.stderr || "";
    const stdout = err?.stdout || "";

    return {
      success: false,
      error: errorMessage,
      errorDetails: {
        command: setupScriptPath,
        stderr,
        stdout,
      },
      scriptPath: setupScriptPath,
    };
  }
}
