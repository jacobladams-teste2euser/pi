import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface TodoMatch {
	file: string;
	line: number;
	column: number;
	tag: string;
	text: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

const TEXT_EXTENSIONS = new Set([
	".ts",
	".js",
	".tsx",
	".jsx",
	".md",
	".json",
	".sh",
	".yaml",
	".yml",
]);

/**
 * Matches TODO, FIXME, HACK, or XXX tags in comments or plain text.
 *
 * Captures:
 *   group 1 – the tag (TODO, FIXME, HACK, XXX)
 *   group 2 – optional trailing text after the tag (may be empty)
 *
 * The pattern is intentionally broad so it works across comment styles
 * (// … , # … , <!-- … -->, etc.) and plain markdown text.
 */
const TODO_REGEX = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/g;

async function walkDir(dir: string, results: TodoMatch[]): Promise<void> {
	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		// Silently skip directories we cannot read (e.g. permission errors).
		return;
	}

	// Sort entries so the output order is deterministic within each directory.
	entries.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) {
				await walkDir(fullPath, results);
			}
			continue;
		}

		if (!entry.isFile()) {
			// Skip symlinks, block devices, etc.
			continue;
		}

		const dotIndex = entry.name.lastIndexOf(".");
		if (dotIndex === -1) continue;
		const ext = entry.name.slice(dotIndex).toLowerCase();
		if (!TEXT_EXTENSIONS.has(ext)) continue;

		let content: string;
		try {
			content = await readFile(fullPath, "utf8");
		} catch {
			// Skip files we cannot read.
			continue;
		}

		const lines = content.split("\n");
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const lineText = lines[lineIndex];
			TODO_REGEX.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = TODO_REGEX.exec(lineText)) !== null) {
				results.push({
					file: fullPath,
					line: lineIndex + 1,
					column: match.index + 1,
					tag: match[1],
					text: match[2].trim(),
				});
			}
		}
	}
}

/**
 * Recursively scans `rootDir` for TODO, FIXME, HACK, and XXX tags in text
 * files. Skips `node_modules`, `.git`, and `dist` directories.
 *
 * @param rootDir - Absolute or relative path to the directory to scan.
 * @returns A sorted array of matches, ordered by file path then line then
 *          column.
 */
export async function scanTodos(rootDir: string): Promise<TodoMatch[]> {
	// Verify rootDir exists and is a directory before walking.
	const rootStat = await stat(rootDir);
	if (!rootStat.isDirectory()) {
		throw new Error(`scanTodos: rootDir is not a directory: ${rootDir}`);
	}

	const results: TodoMatch[] = [];
	await walkDir(rootDir, results);

	// Sort: primary key = file path, secondary = line, tertiary = column.
	results.sort((a, b) => {
		const fileCmp = a.file.localeCompare(b.file);
		if (fileCmp !== 0) return fileCmp;
		if (a.line !== b.line) return a.line - b.line;
		return a.column - b.column;
	});

	return results;
}
