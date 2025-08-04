# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Raycast extension for managing Git worktrees. It provides a streamlined interface to clone projects as bare repos, create/manage worktrees, and integrate with editors and terminals.

## Key Commands

### Development
- `npm run dev` - Start Raycast development mode
- `npm run build` - Build the extension
- `npm run lint` - Run linting
- `npm run fix-lint` - Fix linting issues
- `npm run check:types` - Run TypeScript type checking

### Publishing
- `npm run publish` - Publish to Raycast Store (uses `npx @raycast/api@latest publish`)

## Architecture Overview

### Extension Structure
The extension defines 4 main commands in `package.json`:
- `clone-project` - Clone repos as bare repositories
- `view-projects` - List all Git projects with frecency sorting
- `view-worktrees` - View worktrees across projects
- `add-worktree` - Create new worktrees

### Core Components Architecture

**Entry Points** (`src/`):
- `clone-project.tsx` - UI for cloning new repositories
- `view-projects.tsx` - Lists all projects with actions
- `view-worktrees.tsx` - Shows worktrees with filtering
- `add-worktree.tsx` - Form for creating worktrees

**State Management**:
- Uses Zustand for state (`src/stores/viewing-worktrees.ts`)
- Caching layer for worktree data (`src/helpers/cache.ts`)

**Key Abstractions**:
- `src/hooks/use-projects.ts` - Main hook for project discovery and management
- `src/helpers/git.ts` - Git operations (worktree management, bare repo setup)
- `src/components/worktree/` - Reusable worktree UI components
- `src/components/actions/` - Raycast action components

**Configuration**:
- Preferences handled via Raycast API (`getPreferences()`)
- Constants in `src/config/constants.ts`
- Types in `src/config/types.ts`

### Important Implementation Details

1. **Bare Repository Pattern**: Projects are cloned as bare repos to enable efficient worktree management
2. **Frecency Sorting**: Projects/worktrees can be sorted by frequency of use
3. **Caching**: Optional caching to avoid filesystem scanning on every command
4. **Editor Integration**: Opens worktrees in configured editor with optional window resizing
5. **Branch Name Cleaning**: Automatically removes prefixes like "git checkout -b" when pasting

### Dependencies
- `@raycast/api` - Raycast extension API
- `@raycast/utils` - Raycast utilities
- `fast-glob` - Fast file system scanning
- `parse-url` - URL parsing for Git remotes
- `zustand` - State management