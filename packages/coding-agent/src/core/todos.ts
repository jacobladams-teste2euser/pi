import { createInterface } from "node:readline";
import { spawn } from "child_process";
import { ensureTool } from "../utils/tools-manager.ts";

export interface TodoEntry {
	file: string;
	line: number;
	text: string;
}

export interface TodosResult {
	entries: TodoEntry[];
	totalCount: number;
	truncated: boolean;
}

const TODO_PATTERN = "TODO|FIXME|HACK|XXX";
const MAX_TODOS = 200;

/**
 * Search the cwd for TODO/FIXME/HACK/XXX comments using ripgrep.
 */
export async function findTodos(cwd: string): Promise<TodosResult> {
	const rgPath = await ensureTool("rg", true);
	if (!rgPath) {
		throw new Error("ripgrep (rg) is not available");
	}

	return new Promise((resolve, reject) => {
		const args = [
			"--json",
			"--line-number",
			"--color=never",
			"--hidden",
			"--",
			TODO_PATTERN,
			cwd,
		];

		const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
		const rl = createInterface({ input: child.stdout });
		const entries: TodoEntry[] = [];
		let truncated = false;
		let killedDueToLimit = false;

		rl.on("line", (line) => {
			if (!line.trim()) return;
			if (entries.length >= MAX_TODOS) {
				truncated = true;
				if (!child.killed) {
					killedDueToLimit = true;
					child.kill();
				}
				return;
			}
			let event: { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type === "match") {
				const filePath = event.data?.path?.text;
				const lineNumber = event.data?.line_number;
				const lineText = event.data?.lines?.text;
				if (filePath && typeof lineNumber === "number" && typeof lineText === "string") {
					entries.push({
						file: filePath,
						line: lineNumber,
						text: lineText.replace(/\r?\n$/, "").trimEnd(),
					});
				}
			}
		});

		child.on("error", (err) => {
			rl.close();
			reject(new Error(`Failed to run ripgrep: ${err.message}`));
		});

		child.on("close", (code) => {
			rl.close();
			if (!killedDueToLimit && code !== 0 && code !== 1) {
				reject(new Error(`ripgrep exited with code ${code}`));
				return;
			}
			resolve({ entries, totalCount: entries.length, truncated });
		});
	});
}

/**
 * Format a TodosResult for display in the TUI.
 * Returns a plain string with one entry per line.
 */
export function formatTodos(result: TodosResult, cwd: string): string {
	if (result.entries.length === 0) {
		return "No TODOs found.";
	}

	const lines = result.entries.map((entry) => {
		// Make path relative to cwd for display
		let displayPath = entry.file;
		if (displayPath.startsWith(cwd)) {
			displayPath = displayPath.slice(cwd.length).replace(/^\//, "");
		}
		return `${displayPath}:${entry.line}: ${entry.text.trim()}`;
	});

	if (result.truncated) {
		lines.push(`... (truncated at ${MAX_TODOS} results)`);
	}

	return lines.join("\n");
}
