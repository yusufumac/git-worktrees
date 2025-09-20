// Helper functions for shell operations

/**
 * Get the user's default shell
 */
export function getUserShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

/**
 * Get the profile source command for the user's shell
 */
export function getProfileSource(): string {
  const userShell = getUserShell();

  if (userShell.includes("zsh")) {
    // Source zsh profile files in order
    return "[ -f ~/.zshenv ] && source ~/.zshenv; [ -f ~/.zshrc ] && source ~/.zshrc; ";
  } else if (userShell.includes("bash")) {
    // Source bash profile files
    return "[ -f ~/.bash_profile ] && source ~/.bash_profile; [ -f ~/.bashrc ] && source ~/.bashrc; ";
  }

  return "";
}

/**
 * Build a command with profile sourcing
 */
export function buildCommandWithProfile(command: string): string {
  return getProfileSource() + command;
}
