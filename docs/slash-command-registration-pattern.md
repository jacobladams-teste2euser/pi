# Slash Command Registration Pattern

This document captures the exact pattern used to register and handle slash commands in the TUI (`packages/coding-agent`). It is intended as a precise reference for any subsequent step that needs to add a new slash command.

---

## Overview

There are **two distinct kinds** of slash commands:

| Kind | Where defined | How handled |
|------|--------------|-------------|
| **Built-in commands** | `src/core/slash-commands.ts` — `BUILTIN_SLASH_COMMANDS` array | Hard-coded `if`/`else if` chain in `InteractiveMode.setupEditorSubmitHandler()` |
| **Extension commands** | Registered at runtime via `pi.registerCommand()` inside an extension factory | Dispatched dynamically by `AgentSession._tryExecuteExtensionCommand()` → `ExtensionRunner.getCommand()` |

---

## 1. Built-in Slash Commands

### Type definition

**File:** `packages/coding-agent/src/core/slash-commands.ts`

```ts
export interface BuiltinSlashCommand {
  name: string;        // e.g. "settings", "model", "quit"
  description: string; // shown in autocomplete
}
```

### Registry

The registry is a `ReadonlyArray<BuiltinSlashCommand>` exported from the same file:

```ts
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
  { name: "settings",      description: "Open settings menu" },
  { name: "model",         description: "Select model (opens selector UI)" },
  { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
  { name: "export",        description: "Export session (HTML default, or specify path: .html/.jsonl)" },
  { name: "import",        description: "Import and resume a session from a JSONL file" },
  { name: "share",         description: "Share session as a secret GitHub gist" },
  { name: "copy",          description: "Copy last agent message to clipboard" },
  { name: "name",          description: "Set session display name" },
  { name: "session",       description: "Show session info and stats" },
  { name: "changelog",     description: "Show changelog entries" },
  { name: "hotkeys",       description: "Show all keyboard shortcuts" },
  { name: "fork",          description: "Create a new fork from a previous user message" },
  { name: "clone",         description: "Duplicate the current session at the current position" },
  { name: "tree",          description: "Navigate session tree (switch branches)" },
  { name: "trust",         description: "Save project trust decision for future sessions" },
  { name: "login",         description: "Configure provider authentication" },
  { name: "logout",        description: "Remove provider authentication" },
  { name: "new",           description: "Start a new session" },
  { name: "compact",       description: "Manually compact the session context" },
  { name: "resume",        description: "Resume a different session" },
  { name: "reload",        description: "Reload keybindings, extensions, skills, prompts, and themes" },
  { name: "quit",          description: `Quit ${APP_NAME}` },
];
```

### How a built-in command is handled

**File:** `packages/coding-agent/src/modes/interactive/interactive-mode.ts`  
**Method:** `InteractiveMode.setupEditorSubmitHandler()` (inside `this.defaultEditor.onSubmit`)

Each built-in command is matched with a literal string comparison:

```ts
if (text === "/settings") {
  this.showSettingsSelector();
  this.editor.setText("");
  return;
}
if (text === "/model" || text.startsWith("/model ")) {
  const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
  this.editor.setText("");
  await this.handleModelCommand(searchTerm);
  return;
}
// … one branch per built-in command …
if (text === "/quit") {
  this.editor.setText("");
  await this.shutdown();
  return;
}
```

### How to add a new built-in command

1. **Declare it** — append an entry to `BUILTIN_SLASH_COMMANDS` in `src/core/slash-commands.ts`:
   ```ts
   { name: "mycommand", description: "What my command does" },
   ```

2. **Handle it** — add an `if` branch inside `setupEditorSubmitHandler()` in `interactive-mode.ts`:
   ```ts
   if (text === "/mycommand" || text.startsWith("/mycommand ")) {
     const arg = text.startsWith("/mycommand ") ? text.slice(12).trim() : undefined;
     this.editor.setText("");
     await this.handleMyCommand(arg);
     return;
   }
   ```
   Place the branch **before** the bash `!` check and before the streaming-queue logic.

3. **Implement the handler** — add a private method `handleMyCommand(arg?: string): Promise<void>` on `InteractiveMode`.

---

## 2. Extension Commands (dynamic, registered at runtime)

### Type definitions

**File:** `packages/coding-agent/src/core/extensions/types.ts`

```ts
export interface RegisteredCommand {
  name: string;
  sourceInfo: SourceInfo;
  description?: string;
  /** Optional argument completions for autocomplete */
  getArgumentCompletions?: (
    argumentPrefix: string
  ) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
  /** Called when the user submits the command */
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

/** RegisteredCommand with a resolved (possibly suffixed) invocation name */
export interface ResolvedCommand extends RegisteredCommand {
  invocationName: string; // may be "name:2" if there is a collision
}
```

`ExtensionCommandContext` extends `ExtensionContext` and adds session-control methods (`newSession`, `fork`, `navigateTree`, `switchSession`, `reload`, `waitForIdle`).

### Registry

Extension commands are stored per-extension in a `Map<string, RegisteredCommand>` on the `Extension` object:

```ts
// packages/coding-agent/src/core/extensions/types.ts
export interface Extension {
  path: string;
  resolvedPath: string;
  sourceInfo: SourceInfo;
  handlers: Map<string, HandlerFn[]>;
  tools: Map<string, RegisteredTool>;
  messageRenderers: Map<string, MessageRenderer>;
  commands: Map<string, RegisteredCommand>;   // ← command registry per extension
  flags: Map<string, ExtensionFlag>;
  shortcuts: Map<KeyId, ExtensionShortcut>;
}
```

All extensions are held in `ExtensionRunner.extensions: Extension[]`.

### Registration API

**File:** `packages/coding-agent/src/core/extensions/loader.ts`  
**Inside:** `createExtensionAPI()` → `api.registerCommand()`

```ts
registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void {
  runtime.assertActive();
  extension.commands.set(name, {
    name,
    sourceInfo: extension.sourceInfo,
    ...options,
  });
},
```

Extensions call this via the `ExtensionAPI`:

```ts
// ExtensionAPI (packages/coding-agent/src/core/extensions/types.ts)
registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
```

### How an extension command is dispatched

**File:** `packages/coding-agent/src/core/agent-session.ts`  
**Method:** `AgentSession._tryExecuteExtensionCommand(text: string)`

```ts
private async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
  const spaceIndex = text.indexOf(" ");
  const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
  const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

  const command = this._extensionRunner.getCommand(commandName);
  if (!command) return false;

  const ctx = this._extensionRunner.createCommandContext();
  try {
    await command.handler(args, ctx);
    return true;
  } catch (err) {
    this._extensionRunner.emitError({ ... });
    return true;
  }
}
```

`ExtensionRunner.getCommand(name)` calls `resolveRegisteredCommands()` which iterates all extensions and resolves name collisions by appending `:N` suffixes.

### How to write an extension command

```ts
// packages/coding-agent/examples/extensions/commands.ts (illustrative)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  pi.registerCommand("mycommand", {
    description: "Does something useful",

    // Optional: provide argument completions for autocomplete
    getArgumentCompletions: (prefix) => {
      const options = ["option-a", "option-b"];
      const filtered = options.filter((o) => o.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map((v) => ({ value: v, label: v }))
        : null;
    },

    // Required: the actual handler
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      ctx.ui.notify(`mycommand called with: "${trimmed}"`, "info");
      // ctx has full ExtensionCommandContext: ctx.ui, ctx.model, ctx.newSession(), etc.
    },
  });
}
```

---

## 3. Autocomplete Integration

**File:** `packages/coding-agent/src/modes/interactive/interactive-mode.ts`  
**Method:** `InteractiveMode.createBaseAutocompleteProvider()`

Both built-in and extension commands are converted to `SlashCommand` objects (from `@earendil-works/pi-tui`) and passed to `CombinedAutocompleteProvider`:

```ts
// Built-in commands
const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
  name: command.name,
  description: command.description,
}));

// Extension commands (excluding those that shadow built-ins)
const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
const extensionCommands: SlashCommand[] = this.session.extensionRunner
  .getRegisteredCommands()
  .filter((cmd) => !builtinCommandNames.has(cmd.name))
  .map((cmd) => ({
    name: cmd.invocationName,
    description: this.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
    getArgumentCompletions: cmd.getArgumentCompletions,
  }));

return new CombinedAutocompleteProvider(
  [...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
  this.sessionManager.getCwd(),
  this.fdPath,
);
```

The `SlashCommand` interface (from `packages/tui/src/autocomplete.ts`):

```ts
export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  getArgumentCompletions?(
    argumentPrefix: string
  ): Awaitable<AutocompleteItem[] | null>;
}
```

---

## 4. `SlashCommandInfo` — the public info type

**File:** `packages/coding-agent/src/core/slash-commands.ts`

Used by `pi.getCommands()` (the `ExtensionAPI` method) to expose all active commands to extensions:

```ts
export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: SlashCommandSource;
  sourceInfo: SourceInfo;
}
```

---

## 5. Key file locations

| Purpose | File |
|---------|------|
| Built-in command list & `SlashCommandInfo` type | `packages/coding-agent/src/core/slash-commands.ts` |
| `RegisteredCommand` / `ResolvedCommand` / `ExtensionAPI` types | `packages/coding-agent/src/core/extensions/types.ts` |
| `Extension` object (per-extension command `Map`) | `packages/coding-agent/src/core/extensions/types.ts` |
| `registerCommand()` implementation | `packages/coding-agent/src/core/extensions/loader.ts` |
| Command resolution & `getCommand()` | `packages/coding-agent/src/core/extensions/runner.ts` |
| Built-in command dispatch (`onSubmit` handler) | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| Extension command dispatch | `packages/coding-agent/src/core/agent-session.ts` (`_tryExecuteExtensionCommand`) |
| Autocomplete integration | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (`createBaseAutocompleteProvider`) |
| `SlashCommand` interface (TUI autocomplete) | `packages/tui/src/autocomplete.ts` |
| Example extension command | `packages/coding-agent/examples/extensions/commands.ts` |
