import { defineConfig } from "vitest/config";

export default defineConfig({
	// "obsidian" is types-only; tests that touch its runtime names get a stub.
	resolve: {
		alias: { obsidian: new URL("./tests/helpers/obsidian.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") },
	},
	test: {
		// anchoring.ts works on real DOM nodes and extract.ts needs DOMParser,
		// so the tests run against jsdom rather than bare node.
		environment: "jsdom",
		include: ["tests/**/*.test.ts"],
		// Obsidian's global DOM helpers (createDiv, setCssStyles, ...) for jsdom.
		setupFiles: ["tests/helpers/domShim.ts"],
	},
});
