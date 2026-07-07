/**
 * Codebase TODOs Extension
 *
 * Adds a /todos command that scans the current project for TODO/FIXME/HACK/XXX
 * comments using ripgrep and displays them in an interactive overlay.
 *
 * Usage:
 *   /todos           - Show all TODOs
 *   /todos fixme     - Show only FIXMEs
 *   /todos ts        - Show only TODOs in .ts files
 *
 * Requires ripgrep (rg) to be installed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { execSync } from "child_process";

interface TodoMatch {
	file: string;
	line: number;
	kind: string;
	text: string;
}

const MARKERS = ["TODO", "FIXME", "HACK", "XXX"];

/** Run ripgrep and return parsed TODO matches. */
function findTodos(cwd: string, glob?: string): TodoMatch[] {
	const pattern = MARKERS.join("|");
	const args = [
		"rg",
		"--line-number",
		"--color=never",
		"--no-heading",
		"--hidden",
		"--glob=!.git",
		"--glob=!node_modules",
		"--glob=!dist",
		"--glob=!.pi",
	];
	if (glob) args.push(`--glob=*.${glob.replace(/^\*?\.?/, "")}`);
	args.push(`(${pattern})[:\\s]`);

	let raw: string;
	try {
		raw = execSync(args.join(" "), {
			cwd,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		});
	} catch (err: any) {
		// rg exits 1 when no matches found, which is fine
		if (err.status === 1) return [];
		throw new Error(`ripgrep failed: ${err.message}`);
	}

	const results: TodoMatch[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// format: path/to/file.ts:42:  // TODO: fix this
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx < 0) continue;
		const file = trimmed.slice(0, colonIdx);
		const rest = trimmed.slice(colonIdx + 1);
		const lineColonIdx = rest.indexOf(":");
		if (lineColonIdx < 0) continue;
		const lineNum = parseInt(rest.slice(0, lineColonIdx), 10);
		if (Number.isNaN(lineNum)) continue;
		const content = rest.slice(lineColonIdx + 1).trim();

		// Identify which marker matched
		const upperContent = content.toUpperCase();
		let kind = "TODO";
		for (const marker of MARKERS) {
			if (upperContent.includes(marker)) {
				kind = marker;
				break;
			}
		}

		results.push({ file, line: lineNum, kind, text: content });
	}
	return results;
}

class TodosComponent {
	private matches: TodoMatch[];
	private onClose: () => void;
	private scrollOffset: number;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(matches: TodoMatch[], onClose: () => void) {
		this.matches = matches;
		this.onClose = onClose;
		this.scrollOffset = 0;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) {
			this.onClose();
			return;
		}
		const visibleRows = 20;
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			const maxOffset = Math.max(0, this.matches.length - visibleRows);
			this.scrollOffset = Math.min(this.scrollOffset + 1, maxOffset);
			this.invalidate();
		} else if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.invalidate();
		} else if (matchesKey(data, "pagedown")) {
			const maxOffset = Math.max(0, this.matches.length - visibleRows);
			this.scrollOffset = Math.min(this.scrollOffset + visibleRows, maxOffset);
			this.invalidate();
		} else if (matchesKey(data, "pageup")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - visibleRows);
			this.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const RESET = "\x1b[0m";
		const BOLD = "\x1b[1m";
		const DIM = "\x1b[2m";
		const CYAN = "\x1b[36m";
		const YELLOW = "\x1b[33m";
		const RED = "\x1b[31m";
		const MAGENTA = "\x1b[35m";
		const BLUE = "\x1b[34m";

		const kindColor = (kind: string): string => {
			switch (kind) {
				case "FIXME":
					return RED;
				case "HACK":
					return MAGENTA;
				case "XXX":
					return YELLOW;
				default:
					return CYAN;
			}
		};

		lines.push("");
		const title = `${BOLD}${CYAN} Codebase TODOs ${RESET}`;
		const divider = `${DIM}${"─".repeat(Math.max(0, width - 2))}${RESET}`;
		lines.push(truncateToWidth(divider, width));
		lines.push(truncateToWidth(`  ${title}`, width));
		lines.push(truncateToWidth(divider, width));
		lines.push("");

		if (this.matches.length === 0) {
			lines.push(truncateToWidth(`  ${DIM}No TODOs found. Clean codebase!${RESET}`, width));
		} else {
			const visibleRows = 20;
			const visible = this.matches.slice(this.scrollOffset, this.scrollOffset + visibleRows);
			const total = this.matches.length;

			const countLine = `  ${DIM}${total} item${total !== 1 ? "s" : ""}`;
			const scrollInfo =
				total > visibleRows
					? ` — showing ${this.scrollOffset + 1}–${Math.min(this.scrollOffset + visibleRows, total)}`
					: "";
			lines.push(truncateToWidth(`${countLine}${scrollInfo}${RESET}`, width));
			lines.push("");

			for (const match of visible) {
				const kind = `${kindColor(match.kind)}${BOLD}${match.kind}${RESET}`;
				const loc = `${BLUE}${match.file}${RESET}${DIM}:${match.line}${RESET}`;
				// Strip the marker from the display text to avoid duplication
				const body = match.text.replace(new RegExp(`(${MARKERS.join("|")})[:\\s]*`, "i"), "").trim();
				const row = `  ${kind}  ${loc}  ${DIM}${body}${RESET}`;
				lines.push(truncateToWidth(row, width));
			}

			if (total > visibleRows) {
				lines.push("");
				lines.push(truncateToWidth(`  ${DIM}↑/↓ or j/k to scroll, PgUp/PgDn to page${RESET}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${DIM}Press Escape or q to close${RESET}`, width));
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

export default function (pi: ExtensionAPI) {
	pi.registerCommand("todos", {
		description: "Show all TODO/FIXME/HACK/XXX comments in the codebase",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				// Non-interactive: print to notify
				let matches: TodoMatch[];
				try {
					matches = findTodos(ctx.cwd, args.trim() || undefined);
				} catch (err: any) {
					ctx.ui.notify(err.message, "error");
					return;
				}
				if (matches.length === 0) {
					ctx.ui.notify("No TODOs found", "info");
					return;
				}
				for (const m of matches) {
					ctx.ui.notify(`${m.kind}  ${m.file}:${m.line}  ${m.text}`, "info");
				}
				return;
			}

			// Parse optional glob/marker filter from args
			const filter = args.trim();
			let matches: TodoMatch[];
			try {
				matches = findTodos(ctx.cwd, filter || undefined);
			} catch (err: any) {
				ctx.ui.notify(err.message, "error");
				return;
			}

			// Further filter by marker keyword if the arg looks like one
			const upperFilter = filter.toUpperCase();
			const isMarkerFilter = MARKERS.includes(upperFilter);
			if (isMarkerFilter) {
				matches = matches.filter((m) => m.kind === upperFilter);
			}

			await ctx.ui.custom<void>((_tui, _theme, _kb, done) => {
				return new TodosComponent(matches, () => done());
			});
		},
	});
}
