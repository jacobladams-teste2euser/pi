import { readFileSync, writeFileSync } from "fs";

let content = readFileSync("packages/coding-agent/src/modes/interactive/interactive-mode.ts", "utf8");

// 1) Insert /todos command handler just before /quit handler
const todosHandler =
    '\t\t\tif (text === "/todos") {\n' +
    '\t\t\t\tthis.handleTodosCommand();\n' +
    '\t\t\t\tthis.editor.setText("");\n' +
    '\t\t\t\treturn;\n' +
    '\t\t\t}\n' +
    '\t\t\t';

const oldQuit = '\t\t\tif (text === "/quit") {';
const newQuit = todosHandler + '\t\t\tif (text === "/quit") {';

if (!content.includes(oldQuit)) { throw new Error("Could not find /quit handler"); }
content = content.replace(oldQuit, newQuit);

// 2) Insert handleTodosCommand() method right after handleChangelogCommand() method
const oldAfterChangelog =
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n' +
    '\t\tthis.ui.requestRender();\n' +
    '\t}\n' +
    '\n' +
    '\t/**\n' +
    '\t * Get capitalized display string for an app keybinding action.\n' +
    '\t */\n' +
    '\tprivate getAppKeyDisplay(action: AppKeybinding): string {';

const newHandleTodos =
    '\tprivate handleTodosCommand(): void {\n' +
    '\t\tconst cwd = this.sessionManager.getCwd();\n' +
    '\t\tconst todos = scanTodos(cwd);\n' +
    '\n' +
    '\t\tlet output: string;\n' +
    '\t\tif (todos.length === 0) {\n' +
    '\t\t\toutput = "_No TODO, FIXME, HACK, or XXX comments found._";\n' +
    '\t\t} else {\n' +
    '\t\t\t// Group by file for a clean, scannable layout\n' +
    '\t\t\tconst byFile = new Map();\n' +
    '\t\t\tfor (const item of todos) {\n' +
    '\t\t\t\tconst existing = byFile.get(item.file);\n' +
    '\t\t\t\tif (existing) {\n' +
    '\t\t\t\t\texisting.push({ line: item.line, tag: item.tag, text: item.text });\n' +
    '\t\t\t\t} else {\n' +
    '\t\t\t\t\tbyFile.set(item.file, [{ line: item.line, tag: item.tag, text: item.text }]);\n' +
    '\t\t\t\t}\n' +
    '\t\t\t}\n' +
    '\n' +
    '\t\t\tconst parts: string[] = [];\n' +
    '\t\t\tfor (const [file, items] of byFile) {\n' +
    '\t\t\t\tparts.push(`**${file}**`);\n' +
    '\t\t\t\tfor (const { line, tag, text } of items) {\n' +
    '\t\t\t\t\tconst label = tag.padEnd(5);\n' +
    '\t\t\t\t\tconst displayText = text.trim() ? ` ${text.trim()}` : "";\n' +
    '\t\t\t\t\tparts.push(`- \\`L${line}\\` **${label}**${displayText}`);\n' +
    '\t\t\t\t}\n' +
    '\t\t\t}\n' +
    '\n' +
    '\t\t\tconst total = todos.length;\n' +
    '\t\t\tconst fileCount = byFile.size;\n' +
    '\t\t\toutput = parts.join("\\n") + `\\n\\n_${total} item${total === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}_`;\n' +
    '\t\t}\n' +
    '\n' +
    '\t\tthis.chatContainer.addChild(new Spacer(1));\n' +
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n' +
    '\t\tthis.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "TODOs")), 1, 0));\n' +
    '\t\tthis.chatContainer.addChild(new Spacer(1));\n' +
    '\t\tthis.chatContainer.addChild(new Markdown(output, 1, 1, this.getMarkdownThemeWithSettings()));\n' +
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n' +
    '\t\tthis.ui.requestRender();\n' +
    '\t}\n' +
    '\n';

const newAfterChangelog =
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n' +
    '\t\tthis.ui.requestRender();\n' +
    '\t}\n' +
    '\n' +
    newHandleTodos +
    '\t/**\n' +
    '\t * Get capitalized display string for an app keybinding action.\n' +
    '\t */\n' +
    '\tprivate getAppKeyDisplay(action: AppKeybinding): string {';

if (!content.includes(oldAfterChangelog)) { throw new Error("Could not find end of handleChangelogCommand"); }
content = content.replace(oldAfterChangelog, newAfterChangelog);

writeFileSync("packages/coding-agent/src/modes/interactive/interactive-mode.ts", content);
console.log("Done");
