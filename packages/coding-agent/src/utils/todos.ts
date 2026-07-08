/**
 * TODO finder utility for scanning the codebase for outstanding TODOs.
 * Supports various TODO formats: TODO, FIXME, XXX, HACK, BUG, NOTE
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TodoItem {
	file: string;
	line: number;
	type: string; // TODO, FIXME, XXX, HACK, BUG, NOTE
	text: string;
	fullLine: string;
}

/**
 * Find all TODOs in the codebase using ripgrep (rg).
 * Falls back to fs-based search if rg is not available.
 * @param cwd - Working directory to search in
 * @param rgPath - Optional path to rg binary
 * @returns Array of TODO items sorted by file and line number
 */
export async function findTodos(cwd: string, rgPath?: string): Promise<TodoItem[]> {
	try {
		// Try using ripgrep first (faster and more reliable)
		return await findTodosWithRipgrep(cwd, rgPath);
	} catch {
		// Fall back to fs-based search
		return findTodosWithFs(cwd);
	}
}

/**
 * Find TODOs using ripgrep (rg) command
 */
async function findTodosWithRipgrep(cwd: string, rgPath?: string): Promise<TodoItem[]> {
	const rg = rgPath || "rg";

	// Pattern to match TODO, FIXME, XXX, HACK, BUG, NOTE comments
	// Matches: // TODO: text, /* TODO: text */, # TODO: text, etc.
	const pattern = String.raw`(?:^|\s)(?:TODO|FIXME|XXX|HACK|BUG|NOTE)(?:\s*:|\s+)(.+?)(?:\s*\*\/)?$`;

	try {
		const output = execSync(`${rg} --line-number --no-heading "${pattern}" .`, {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		const todos: TodoItem[] = [];
		const lines = output.trim().split("\n").filter((line) => line.length > 0);

		for (const line of lines) {
			const match = line.match(/^([^:]+):(\d+):(.*)$/);
			if (match) {
				const [, file, lineNum, content] = match;
				const typeMatch = content.match(/(?:TODO|FIXME|XXX|HACK|BUG|NOTE)(?:\s*:|\s+)(.+)/i);
				if (typeMatch) {
					const type = content.match(/(?:TODO|FIXME|XXX|HACK|BUG|NOTE)/i)?.[0] || "TODO";
					todos.push({
						file,
						line: parseInt(lineNum, 10),
						type,
						text: typeMatch[1].trim(),
						fullLine: content.trim(),
					});
				}
			}
		}

		return todos.sort((a, b) => {
			const fileCompare = a.file.localeCompare(b.file);
			return fileCompare !== 0 ? fileCompare : a.line - b.line;
		});
	} catch {
		throw new Error("ripgrep not available");
	}
}

/**
 * Find TODOs using filesystem traversal (fallback)
 */
function findTodosWithFs(cwd: string): TodoItem[] {
	const todos: TodoItem[] = [];
	const todoPattern = /(?:TODO|FIXME|XXX|HACK|BUG|NOTE)(?:\s*:|\s+)(.+)/gi;

	// Common file extensions to search
	const extensions = [
		".ts",
		".tsx",
		".js",
		".jsx",
		".py",
		".java",
		".go",
		".rs",
		".c",
		".cpp",
		".h",
		".hpp",
		".cs",
		".rb",
		".php",
		".swift",
		".kt",
		".scala",
		".sh",
		".bash",
		".json",
		".yaml",
		".yml",
		".md",
		".txt",
	];

	// Directories to skip
	const skipDirs = new Set([
		"node_modules",
		".git",
		".next",
		"dist",
		"build",
		"coverage",
		".venv",
		"venv",
		"__pycache__",
		".pytest_cache",
		"target",
		"bin",
		"obj",
	]);

	function traverse(dir: string): void {
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });

			for (const entry of entries) {
				if (entry.isDirectory()) {
					if (!skipDirs.has(entry.name) && !entry.name.startsWith(".")) {
						traverse(path.join(dir, entry.name));
					}
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name);
					if (extensions.includes(ext)) {
						const filePath = path.join(dir, entry.name);
						try {
							const content = fs.readFileSync(filePath, "utf-8");
							const lines = content.split("\n");

							lines.forEach((line, index) => {
								let match;
								while ((match = todoPattern.exec(line)) !== null) {
									const type = line.substring(match.index, match.index + 4).toUpperCase();
									todos.push({
										file: path.relative(cwd, filePath),
										line: index + 1,
										type,
										text: match[1].trim(),
										fullLine: line.trim(),
									});
								}
							});
						} catch {
							// Skip files that can't be read
						}
					}
				}
			}
		} catch {
			// Skip directories that can't be read
		}
	}

	traverse(cwd);

	return todos.sort((a, b) => {
		const fileCompare = a.file.localeCompare(b.file);
		return fileCompare !== 0 ? fileCompare : a.line - b.line;
	});
}

/**
 * Format TODOs for display
 */
export function formatTodos(todos: TodoItem[], cwd: string): string {
	if (todos.length === 0) {
		return "No TODOs found in the codebase!";
	}

	const lines: string[] = [];
	lines.push(`Found ${todos.length} TODO${todos.length === 1 ? "" : "s"}:\n`);

	// Group by file
	const byFile = new Map<string, TodoItem[]>();
	for (const todo of todos) {
		if (!byFile.has(todo.file)) {
			byFile.set(todo.file, []);
		}
		byFile.get(todo.file)!.push(todo);
	}

	// Format each file's TODOs
	for (const [file, fileTodos] of byFile) {
		lines.push(`${file}`);
		for (const todo of fileTodos) {
			const typeColor = getTypeColor(todo.type);
			lines.push(`  ${todo.line}: [${todo.type}] ${todo.text}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Get a color indicator for the TODO type (for terminal output)
 */
function getTypeColor(type: string): string {
	switch (type.toUpperCase()) {
		case "FIXME":
		case "BUG":
			return "🔴"; // Red
		case "HACK":
		case "XXX":
			return "🟠"; // Orange
		case "TODO":
			return "🟡"; // Yellow
		case "NOTE":
			return "🔵"; // Blue
		default:
			return "⚪"; // White
	}
}
