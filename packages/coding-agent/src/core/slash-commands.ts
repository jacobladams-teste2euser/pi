import type { ToolCallResult } from "@earendil-works/pi-ai";
import type { AgentSession } from "./agent-session.js";
import { renderSessionsList } from "../cli/session-picker.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { getAvailableSkills } from "./skills.js";
import { dirname, join, resolve, relative } from "node:path";
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

// Supported models list for validation
const SUPPORTED_MODELS = [
	"gpt-4",
	"gpt-4-turbo",
	"gpt-3.5-turbo",
	"claude-3-opus",
	"claude-3-sonnet",
	"claude-3-haiku",
];

// Sanitize user input to prevent XSS and log injection
function sanitizeInput(input: string): string {
	return input
		.replace(/[<>]/g, "") // Remove HTML tags
		.replace(/[\r\n]+/g, " ") // Replace newlines with spaces
		.trim();
}

// Validate and sanitize file path to prevent path traversal
function validateOutputPath(outputPath: string, basePath: string): string {
	// Reject absolute paths
	if (outputPath.startsWith("/") || /^[a-zA-Z]:/.test(outputPath)) {
		throw new Error("Absolute paths are not allowed");
	}

	// Reject paths containing '..'
	if (outputPath.includes("..")) {
		throw new Error("Path traversal is not allowed");
	}

	// Resolve the full path and ensure it's within basePath
	const fullPath = resolve(basePath, outputPath);
	const relativePath = relative(basePath, fullPath);

	// If relative path starts with '..' or is absolute, it's outside basePath
	if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
		throw new Error("Output path must be within the session directory");
	}

	return fullPath;
}

// Event emitter for graceful shutdown
let shutdownHandler: (() => Promise<void>) | null = null;

export function setShutdownHandler(handler: () => Promise<void>): void {
	shutdownHandler = handler;
}

export function registerSlashCommands(
	session: AgentSession,
	sessionManager: SessionManager,
	settingsManager: SettingsManager,
): SlashCommand[] {
	// Define all handlers first, then create commands array
	const helpHandler = async (args: string[], session: AgentSession) => {
		const commandsList = commands
			.map((cmd) => {
				const aliases = cmd.aliases ? ` (${cmd.aliases.join(", ")})` : "";
				return `  /${cmd.name}${aliases} - ${cmd.description}`;
			})
			.join("\n");
		session.addUserMessage(`Available commands:\n${commandsList}`);
	};

	const exitHandler = async (args: string[], session: AgentSession) => {
		session.addUserMessage("Exiting session...");
		if (shutdownHandler) {
			await shutdownHandler();
		}
		process.exit(0);
	};

	const clearHandler = async (args: string[], session: AgentSession) => {
		session.clearHistory();
		session.addUserMessage("Conversation history cleared.");
	};

	const saveHandler = async (args: string[], session: AgentSession) => {
		try {
			await sessionManager.saveSession(session);
			session.addUserMessage(`Session saved: ${session.sessionId}`);
		} catch (error) {
			session.addUserMessage(
				`Failed to save session: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const exportHandler = async (args: string[], session: AgentSession) => {
		try {
			const outputPath = args[0] || `session-${session.sessionId}.html`;
			const fullPath = validateOutputPath(outputPath, session.cwd);
			const html = await exportSessionToHtml(session);
			await writeFile(fullPath, html, "utf-8");
			session.addUserMessage(`Session exported to: ${fullPath}`);
		} catch (error) {
			session.addUserMessage(
				`Failed to export session: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const modelHandler = async (args: string[], session: AgentSession) => {
		if (args.length === 0) {
			session.addUserMessage(
				`Current model: ${session.options.model || "default"}`,
			);
			return;
		}
		const newModel = sanitizeInput(args[0]);
		
		// Validate model name
		if (!SUPPORTED_MODELS.includes(newModel)) {
			session.addUserMessage(
				`Warning: '${newModel}' is not in the list of supported models. Supported models: ${SUPPORTED_MODELS.join(", ")}`,
			);
		}
		
		session.options.model = newModel;
		session.addUserMessage(`Model changed to: ${newModel}`);
	};

	const skillsHandler = async (args: string[], session: AgentSession) => {
		const skills = await getAvailableSkills(session.cwd);
		if (skills.length === 0) {
			session.addUserMessage("No skills available.");
			return;
		}
		const skillsList = skills
			.map((skill) => `  - ${skill.name}: ${skill.description}`)
			.join("\n");
		session.addUserMessage(`Available skills:\n${skillsList}`);
	};

	const sessionsHandler = async (args: string[], session: AgentSession) => {
		const sessions = await sessionManager.listSessions();
		const formatted = await renderSessionsList(sessions);
		session.addUserMessage(`Sessions:\n${formatted}`);
	};

	const todosHandler = async (args: string[], session: AgentSession) => {
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
	};

	const commands: SlashCommand[] = [
		{
			name: "help",
			description: "Show available slash commands",
			handler: helpHandler,
		},
		{
			name: "exit",
			description: "Exit the session",
			aliases: ["quit", "q"],
			handler: exitHandler,
		},
		{
			name: "clear",
			description: "Clear conversation history",
			handler: clearHandler,
		},
		{
			name: "save",
			description: "Save the current session",
			handler: saveHandler,
		},
		{
			name: "export",
			description: "Export session to HTML",
			handler: exportHandler,
		},
		{
			name: "model",
			description: "Change the current model",
			handler: modelHandler,
		},
		{
			name: "skills",
			description: "List available skills",
			handler: skillsHandler,
		},
		{
			name: "sessions",
			description: "List all sessions",
			aliases: ["ls"],
			handler: sessionsHandler,
		},
		{
			name: "todos",
			description: "Show all TODO comments in the codebase",
			aliases: ["todo"],
			handler: todosHandler,
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