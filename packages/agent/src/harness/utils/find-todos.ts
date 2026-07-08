/**
 * TODO scanner utility.
 *
 * Recursively walks a directory tree, reads each text file, and collects
 * lines that contain the pattern /TODO[:\s]/i.  Binary files and the
 * directories node_modules, .git, dist, and build are skipped.
 *
 * Uses only Node.js built-ins (fs/promises, path) — no external dependencies.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";

export interface TodoEntry {
	/** File path relative to rootDir */
	file: string;
	/** 1-based line number */
	line: number;
	/** Trimmed line text */
	text: string;
}

/** Directories that are always skipped during the recursive walk. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

/** Pattern that identifies a TODO comment line (case-insensitive). */
const TODO_PATTERN = /TODO[:\s]/i;

/**
 * Returns true when the buffer looks like a binary file.
 *
 * The heuristic mirrors what tools like `git diff` use: if any of the first
 * 8 000 bytes is a NUL byte the file is treated as binary.
 */
function isBinary(buffer: Buffer): boolean {
	const sampleLength = Math.min(buffer.length, 8_000);
	for (let i = 0; i < sampleLength; i++) {
		if (buffer[i] === 0) return true;
	}
	return false;
}

/**
 * Recursively walk `dir`, yielding the absolute path of every regular file
 * that is not inside a skipped directory.
 */
async function* walkFiles(dir: string): AsyncGenerator<string> {
	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		// Unreadable directory — skip silently.
		return;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			yield* walkFiles(fullPath);
		} else if (entry.isFile()) {
			yield fullPath;
		} else if (entry.isSymbolicLink()) {
			// Resolve symlinks but guard against loops by checking the target type.
			let targetStat: Awaited<ReturnType<typeof stat>>;
			try {
				targetStat = await stat(fullPath);
			} catch {
				continue;
			}
			if (targetStat.isFile()) yield fullPath;
		}
	}
}

/**
 * Scan `rootDir` recursively and return every TODO occurrence found in text files.
 *
 * @param rootDir - Absolute (or relative) path to the directory to scan.
 * @returns Array of `{ file, line, text }` objects sorted by file path then
 *          line number.  `file` is always relative to `rootDir`.
 */
export async function findTodos(rootDir: string): Promise<TodoEntry[]> {
	const results: TodoEntry[] = [];

	for await (const absolutePath of walkFiles(rootDir)) {
		let buffer: Buffer;
		try {
			buffer = await readFile(absolutePath);
		} catch {
			// Unreadable file — skip.
			continue;
		}

		if (isBinary(buffer)) continue;

		const content = buffer.toString("utf8");
		const lines = content.split("\n");
		const relPath = relative(rootDir, absolutePath);

		for (let i = 0; i < lines.length; i++) {
			if (TODO_PATTERN.test(lines[i])) {
				results.push({
					file: relPath,
					line: i + 1, // 1-based
					text: lines[i].trim(),
				});
			}
		}
	}

	return results;
}
