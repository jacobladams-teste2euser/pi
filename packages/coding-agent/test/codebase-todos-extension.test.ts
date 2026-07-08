/**
 * Tests for codebase-todos extension
 */

import { describe, expect, it } from "vitest";

// Simple test to verify the extension file exists and has valid TypeScript syntax
describe("codebase-todos extension", () => {
	it("should export a default function", async () => {
		// Dynamic import to test the extension loads correctly
		const extension = await import("../examples/extensions/codebase-todos.ts");
		expect(extension.default).toBeDefined();
		expect(typeof extension.default).toBe("function");
	});

	it("should have proper TypeScript types", async () => {
		// This test verifies the extension compiles without errors
		// The actual compilation is checked by npm run check
		const extension = await import("../examples/extensions/codebase-todos.ts");
		expect(extension).toBeDefined();
	});
});
