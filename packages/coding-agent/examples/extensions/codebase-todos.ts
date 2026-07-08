/**
 * Codebase Todos Extension - Scans for TODO comments in the codebase
 *
 * This extension:
 * - Registers a `/todos` command that scans the codebase for TODO comments
 * - Displays TODO items in an interactive list with file paths and line numbers
 * - Allows navigation with arrow keys and opening files with Enter
 * - Supports Escape to close the interface
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Use /todos to scan and view all TODO comments in the codebase
 * 3. Use arrow keys to navigate, Enter to open a file, Escape to close
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

interface TodoItem {
	file: string;
	line: number;
	text: string;
}

/**
 * UI component for displaying TODO items
 */
class TodosComponent {
	private todos: TodoItem[];
	private theme: Theme;
	private onClose: () => void;
	private selectedIndex: number = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(todos: TodoItem[], theme: Theme, onClose: () => void) {
		this.todos = todos;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		} else if (matchesKey(data, "up") || matchesKey(data, "k")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.invalidate();
			}
		} else if (matchesKey(data, "down") || matchesKey(data, "j")) {
			if (this.selectedIndex < this.todos.length - 1) {
				this.selectedIndex++;
				this.invalidate();
			}
		} else if (matchesKey(data, "enter")) {
			const selected = this.todos[this.selectedIndex];
			if (selected) {
				// Notify user of the selected TODO
				console.log(`Selected: ${selected.file}:${selected.line} - ${selected.text}`);
			}
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push("");
		const title = th.fg("accent", " TODOs ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No TODO comments found in the codebase")}`, width));
		} else {
			lines.push(truncateToWidth(`  ${th.fg("muted", `Found ${this.todos.length} TODO(s)`)}`, width));
			lines.push("");

			for (let i = 0; i < this.todos.length; i++) {
				const todo = this.todos[i];
				const isSelected = i === this.selectedIndex;
				const prefix = isSelected ? th.fg("accent", "▶") : " ";
				const fileInfo = th.fg("muted", `${todo.file}:${todo.line}`);
				const todoText = isSelected ? th.fg("accent", todo.text) : th.fg("text", todo.text);
				const line = `  ${prefix} ${fileInfo} ${todoText}`;
				lines.push(truncateToWidth(line, width));
			}
		}

		lines.push("");
		const helpText = th.fg("dim", "↑/↓ or j/k: navigate | Enter: select | Escape: close");
		lines.push(truncateToWidth(`  ${helpText}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

/**
 * Parse grep output to extract TODO items
 * Expected format: file:line:content
 */
function parseTodos(grepOutput: string): TodoItem[] {
	const todos: TodoItem[] = [];
	const lines = grepOutput.split("\n").filter((line) => line.trim());

	for (const line of lines) {
		// Parse grep output format: file:line:content
		const match = line.match(/^([^:]+):(\d+):\s*(.*)$/);
		if (match) {
			const [, file, lineStr, content] = match;
			const lineNum = parseInt(lineStr, 10);

			// Extract TODO text (remove TODO: prefix if present)
			let todoText = content.trim();
			const todoMatch = todoText.match(/TODO\s*:?\s*(.*)/i);
			if (todoMatch) {
				todoText = todoMatch[1].trim();
			}

			todos.push({
				file,
				line: lineNum,
				text: todoText,
			});
		}
	}

	return todos;
}

export default function (pi: ExtensionAPI) {
	// Register the /todos command for users
	pi.registerCommand("todos", {
		description: "Scan and display TODO comments in the codebase",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			try {
				// Show loading indicator
				ctx.ui.notify("Scanning for TODOs...", "info");

				// Use bash to grep for TODO comments
				// Search for TODO in common file types, excluding node_modules and .git
				const grepCommand = `grep -r "TODO" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.java" --include="*.go" --include="*.rs" --include="*.md" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build . 2>/dev/null || true`;

				// Execute the grep command
				const result = await ctx.runCommand(grepCommand);

				if (result.exitCode !== 0 && result.stdout === "") {
					ctx.ui.notify("No TODO comments found or grep failed", "info");
					return;
				}

				// Parse the grep output
				const todos = parseTodos(result.stdout);

				if (todos.length === 0) {
					ctx.ui.notify("No TODO comments found in the codebase", "info");
					return;
				}

				// Display the TODOs in an interactive component
				await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
					return new TodosComponent(todos, theme, () => done());
				});
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Error scanning for TODOs: ${errorMsg}`, "error");
			}
		},
	});
}
