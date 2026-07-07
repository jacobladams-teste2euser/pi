import type { ToolCallResult } from "@earendil-works/pi-ai";
import type { AgentSession } from "./agent-session.js";
import { renderSessionsList } from "../cli/session-picker.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { getAvailableSkills } from "./skills.js";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";
import { grepTool } from "./tools/grep.js";

export interface SlashCommand {
	name: string;
	description: string;
	aliases?: string[];
	handler: (args: string[], session: AgentSession) => Promise<void>;
}

export function registerSlashCommands(
	session: AgentSession,
	sessionManager: SessionManager,
	settingsManager: SettingsManager,
): SlashCommand[] {
	const commands: SlashCommand[] = [
		{
			name: "help",
			description: "Show available slash commands",
			handler: async () => {
				const commandsList = commands
					.map((cmd) => {
						const aliases = cmd.aliases ? ` (${cmd.aliases.join(", ")})` : "";
						return `  /${cmd.name}${aliases} - ${cmd.description}`;
					})
					.join("\n");
				session.addUserMessage(`Available commands:\n${commandsList}`);
			},
		},
		{
			name: "exit",
			description: "Exit the session",
			aliases: ["quit", "q"],
			handler: async () => {
				session.addUserMessage("Exiting session...");
				process.exit(0);
			},
		},
		{
			name: "clear",
			description: "Clear conversation history",
			handler: async () => {
				session.clearHistory();
				session.addUserMessage("Conversation history cleared.");
			},
		},
		{
			name: "save",
			description: "Save the current session",
			handler: async () => {
				await sessionManager.saveSession(session);
				session.addUserMessage(`Session saved: ${session.sessionId}`);
			},
		},
		{
			name: "export",
			description: "Export session to HTML",
			handler: async (args) => {
				const outputPath = args[0] || `session-${session.sessionId}.html`;
				const html = await exportSessionToHtml(session);
				const fullPath = join(session.cwd, outputPath);
				await writeFile(fullPath, html, "utf-8");
				session.addUserMessage(`Session exported to: ${fullPath}`);
			},
		},
		{
			name: "model",
			description: "Change the current model",
			handler: async (args) => {
				if (args.length === 0) {
					session.addUserMessage(
						`Current model: ${session.options.model || "default"}`,
					);
					return;
				}
				const newModel = args[0];
				session.options.model = newModel;
				session.addUserMessage(`Model changed to: ${newModel}`);
			},
		},
		{
			name: "skills",
			description: "List available skills",
			handler: async () => {
				const skills = await getAvailableSkills(session.cwd);
				if (skills.length === 0) {
					session.addUserMessage("No skills available.");
					return;
				}
				const skillsList = skills
					.map((skill) => `  - ${skill.name}: ${skill.description}`)
					.join("\n");
				session.addUserMessage(`Available skills:\n${skillsList}`);
			},
		},
		{
			name: "sessions",
			description: "List all sessions",
			aliases: ["ls"],
			handler: async () => {
				const sessions = await sessionManager.listSessions();
				const formatted = await renderSessionsList(sessions);
				session.addUserMessage(`Sessions:\n${formatted}`);
			},
		},
		{
			name: "todos",
			description: "Show all TODO comments in the codebase",
			aliases: ["todo"],
			handler: async () => {
				try {
					// Use grep tool to find TODO comments
					const result = await grepTool.execute(
						{
							pattern: "TODO|FIXME|XXX|HACK|NOTE",
							paths: ["."],
							includeLineNumbers: true,
							caseSensitive: false,
							excludePatterns: [
								"node_modules",
								".git",
								"dist",
								"build",
								"*.min.js",
								"package-lock.json",
								"npm-shrinkwrap.json",
							],
						},
						session.cwd,
					);

					if (result.type === "error") {
						session.addUserMessage(
							`Error searching for TODOs: ${result.error}`,
						);
						return;
					}

					const output = result.output.trim();
					if (!output) {
						session.addUserMessage("No TODOs found in the codebase.");
						return;
					}

					// Format the output nicely
					const lines = output.split("\n");
					const grouped = new Map<string, string[]>();

					for (const line of lines) {
						// Extract file path from grep output (format: path:line:content)
						const match = line.match(/^([^:]+):/);
						if (match) {
							const file = match[1];
							if (!grouped.has(file)) {
								grouped.set(file, []);
							}
							grouped.get(file)!.push(line);
						}
					}

					let formatted = `Found ${lines.length} TODO(s) in ${grouped.size} file(s):\n\n`;
					for (const [file, fileLines] of grouped) {
						formatted += `📁 ${file}\n`;
						for (const line of fileLines) {
							// Remove file path prefix for cleaner display
							const content = line.substring(file.length + 1);
							formatted += `   ${content}\n`;
						}
						formatted += "\n";
					}

					session.addUserMessage(formatted);
				} catch (error) {
					session.addUserMessage(
						`Error searching for TODOs: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
		},
	];

	return commands;
}

export async function handleSlashCommand(
	input: string,
	session: AgentSession,
	commands: SlashCommand[],
): Promise<boolean> {
	if (!input.startsWith("/")) {
		return false;
	}

	const parts = input.slice(1).split(/\s+/);
	const commandName = parts[0].toLowerCase();
	const args = parts.slice(1);

	const command = commands.find(
		(cmd) =>
			cmd.name === commandName ||
			(cmd.aliases && cmd.aliases.includes(commandName)),
	);

	if (!command) {
		session.addUserMessage(`Unknown command: /${commandName}`);
		return true;
	}

	await command.handler(args, session);
	return true;
}