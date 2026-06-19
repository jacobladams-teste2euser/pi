with open("packages/coding-agent/src/modes/interactive/interactive-mode.ts", "r") as f:
    content = f.read()

# 1) Insert /todos command handler just before /quit handler
todos_handler = (
    '\t\t\tif (text === "/todos") {\n'
    '\t\t\t\tthis.handleTodosCommand();\n'
    '\t\t\t\tthis.editor.setText("");\n'
    '\t\t\t\treturn;\n'
    '\t\t\t}\n'
    '\t\t\t'
)

old_quit = '\t\t\tif (text === "/quit") {'
new_quit = todos_handler + '\t\t\tif (text === "/quit") {'

assert old_quit in content, "Could not find /quit handler"
content = content.replace(old_quit, new_quit, 1)

# 2) Insert handleTodosCommand() method right after handleChangelogCommand() method
old_after_changelog = (
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n'
    '\t\tthis.ui.requestRender();\n'
    '\t}\n'
    '\n'
    '\t/**\n'
    '\t * Get capitalized display string for an app keybinding action.\n'
    '\t */\n'
    '\tprivate getAppKeyDisplay(action: AppKeybinding): string {'
)

new_handle_todos = (
    '\tprivate handleTodosCommand(): void {\n'
    '\t\tconst cwd = this.sessionManager.getCwd();\n'
    '\t\tconst todos = scanTodos(cwd);\n'
    '\n'
    '\t\tlet output: string;\n'
    '\t\tif (todos.length === 0) {\n'
    '\t\t\toutput = "_No TODO, FIXME, HACK, or XXX comments found._";\n'
    '\t\t} else {\n'
    '\t\t\t// Group by file for a clean, scannable layout\n'
    '\t\t\tconst byFile = new Map<string, Array<{ line: number; tag: string; text: string }>>();\n'
    '\t\t\tfor (const item of todos) {\n'
    '\t\t\t\tconst existing = byFile.get(item.file);\n'
    '\t\t\t\tif (existing) {\n'
    '\t\t\t\t\texisting.push({ line: item.line, tag: item.tag, text: item.text });\n'
    '\t\t\t\t} else {\n'
    '\t\t\t\t\tbyFile.set(item.file, [{ line: item.line, tag: item.tag, text: item.text }]);\n'
    '\t\t\t\t}\n'
    '\t\t\t}\n'
    '\n'
    '\t\t\tconst parts: string[] = [];\n'
    '\t\t\tfor (const [file, items] of byFile) {\n'
    '\t\t\t\tparts.push(`**${file}**`);\n'
    '\t\t\t\tfor (const { line, tag, text } of items) {\n'
    '\t\t\t\t\tconst label = tag.padEnd(5);\n'
    '\t\t\t\t\tconst displayText = text.trim() ? ` ${text.trim()}` : "";\n'
    '\t\t\t\t\tparts.push(`- \\`L${line}\\` **${label}**${displayText}`);\n'
    '\t\t\t\t}\n'
    '\t\t\t}\n'
    '\n'
    '\t\t\tconst total = todos.length;\n'
    '\t\t\tconst fileCount = byFile.size;\n'
    '\t\t\toutput = parts.join("\\n") + `\\n\\n_${total} item${total === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}_`;\n'
    '\t\t}\n'
    '\n'
    '\t\tthis.chatContainer.addChild(new Spacer(1));\n'
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n'
    '\t\tthis.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "TODOs")), 1, 0));\n'
    '\t\tthis.chatContainer.addChild(new Spacer(1));\n'
    '\t\tthis.chatContainer.addChild(new Markdown(output, 1, 1, this.getMarkdownThemeWithSettings()));\n'
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n'
    '\t\tthis.ui.requestRender();\n'
    '\t}\n'
    '\n'
)

new_after_changelog = (
    '\t\tthis.chatContainer.addChild(new DynamicBorder());\n'
    '\t\tthis.ui.requestRender();\n'
    '\t}\n'
    '\n'
    + new_handle_todos +
    '\t/**\n'
    '\t * Get capitalized display string for an app keybinding action.\n'
    '\t */\n'
    '\tprivate getAppKeyDisplay(action: AppKeybinding): string {'
)

assert old_after_changelog in content, "Could not find end of handleChangelogCommand"
content = content.replace(old_after_changelog, new_after_changelog, 1)

with open("packages/coding-agent/src/modes/interactive/interactive-mode.ts", "w") as f:
    f.write(content)

print("Done")
