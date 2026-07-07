/**
 * Todos Extension
 *
 * Registers a /todos command that scans the codebase for TODO, FIXME,
 * HACK, and XXX comments using ripgrep and displays them in a scrollable
 * TUI overlay.
 *
 * Usage:
 *   /todos          — search from cwd
 *   /todos src/     — search within src/
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const TAG_PATTERN = "(TODO|FIXME|HACK|XXX)";
const TAG_COLORS: Record<string, string> = {
	TODO: "accent",
	FIXME: "error",
	HACK: "warning",
	XXX: "warning",
};

interface TodoEntry {
	tag: string;
	file: string;
	line: number;
	text: string;
}

function parseLine(raw: string): TodoEntry | undefined {
	// ripgrep output format: file:line:text
	const match = raw.match(/^([^:]+):(\d+):(.*)$/);
	if (!match) return undefined;
	const file = match[1];
	const line = Number(match[2]);
	const text = match[3].trim();
	const tagMatch = text.match(/\b(TODO|FIXME|HACK|XXX)\b[:\s]?(.*)/);
	if (!tagMatch) return undefined;
	return { tag: tagMatch[1], file, line, text: tagMatch[2].trim() || text };
}

class TodosOverlay {
	private entries: TodoEntry[];
	private scrollOffset: number;
	private onClose: () => void;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		entries: TodoEntry[],
		onClose: () => void,
	) {
		this.entries = entries;
		this.scrollOffset = 0;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) {
			this.onClose();
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.scrollOffset = Math.min(this.scrollOffset + 1, Math.max(0, this.entries.length - 1));
			this.invalidate();
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.invalidate();
		}
		if (matchesKey(data, "ctrl+d")) {
			this.scrollOffset = Math.min(this.scrollOffset + 10, Math.max(0, this.entries.length - 1));
			this.invalidate();
		}
		if (matchesKey(data, "ctrl+u")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 10);
			this.invalidate();
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number, theme: import("@earendil-works/pi-coding-agent").Theme): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const th = theme;
		const lines: string[] = [];
		const total = this.entries.length;

		lines.push("");

		const title = th.fg("accent", ` TODOs (${total}) `);
		const borderWidth = Math.max(0, width - 12);
		const header =
			th.fg("borderMuted", "─".repeat(3)) +
			title +
			th.fg("borderMuted", "─".repeat(borderWidth));
		lines.push(truncateToWidth(header, width));
		lines.push("");

		if (total === 0) {
			lines.push(truncateToWidth(`  ${th.fg("success", "No TODOs found. Clean codebase!")}`, width));
		} else {
			// Count by tag
			const counts: Record<string, number> = {};
			for (const e of this.entries) {
				counts[e.tag] = (counts[e.tag] ?? 0) + 1;
			}
			const summary = Object.entries(counts)
				.map(([tag, n]) => `${th.fg((TAG_COLORS[tag] ?? "muted") as Parameters<typeof th.fg>[0], tag)} ${th.fg("muted", String(n))}`)
				.join(th.fg("dim", "  "));
			lines.push(truncateToWidth(`  ${summary}`, width));
			lines.push("");

			const visibleRows = Math.max(1, 20);
			const start = this.scrollOffset;
			const end = Math.min(start + visibleRows, total);

			for (let i = start; i < end; i++) {
				const e = this.entries[i];
				const tagColor = (TAG_COLORS[e.tag] ?? "muted") as Parameters<typeof th.fg>[0];
				const tag = th.fg(tagColor, th.bold(e.tag.padEnd(5)));
				const loc = th.fg("dim", `${e.file}:${e.line}`);
				const text = th.fg("text", e.text);
				lines.push(truncateToWidth(`  ${tag} ${loc}  ${text}`, width));
			}

			if (total > visibleRows) {
				const remaining = total - end;
				if (remaining > 0) {
					lines.push("");
					lines.push(truncateToWidth(`  ${th.fg("dim", `${remaining} more — j/↓ to scroll`)}`, width));
				}
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("dim", "j/k scroll · q/Esc close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("todos", {
		description: "Scan codebase for TODO/FIXME/HACK/XXX comments",
		handler: async (args, ctx) => {
			const searchPath = args.trim() || ".";

			// Run ripgrep to find all TODO-style comments
			const result = await pi.exec("rg", [
				"--line-number",
				"--no-heading",
				"--color=never",
				"--hidden",
				"--glob=!.git",
				"-e",
				TAG_PATTERN,
				searchPath,
			]);

			const rawLines = (result.stdout ?? "").split("\n").filter((l) => l.trim().length > 0);
			const entries: TodoEntry[] = [];
			for (const raw of rawLines) {
				const entry = parseLine(raw);
				if (entry) entries.push(entry);
			}

			// Sort: FIXME first, then TODO, then HACK/XXX, then by file+line
			const tagOrder: Record<string, number> = { FIXME: 0, TODO: 1, HACK: 2, XXX: 3 };
			entries.sort((a, b) => {
				const tagDiff = (tagOrder[a.tag] ?? 9) - (tagOrder[b.tag] ?? 9);
				if (tagDiff !== 0) return tagDiff;
				if (a.file < b.file) return -1;
				if (a.file > b.file) return 1;
				return a.line - b.line;
			});

			if (ctx.mode !== "tui") {
				// Non-TUI fallback: notify with a count summary
				if (entries.length === 0) {
					ctx.ui.notify("No TODOs found", "info");
				} else {
					const counts: Record<string, number> = {};
					for (const e of entries) counts[e.tag] = (counts[e.tag] ?? 0) + 1;
					const summary = Object.entries(counts)
						.map(([tag, n]) => `${tag}: ${n}`)
						.join(", ");
					ctx.ui.notify(`Found ${entries.length} item(s) — ${summary}`, "info");
				}
				return;
			}

			await ctx.ui.custom<void>((tui, thm, _kb, done) => {
				const overlay = new TodosOverlay(entries, () => done(undefined));

				const component = {
					render(width: number): string[] {
						return overlay.render(width, thm);
					},
					handleInput(data: string): void {
						overlay.handleInput(data);
						tui.requestRender();
					},
				};

				return component;
			});
		},
	});
}
