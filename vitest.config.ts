import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// anchoring.ts works on real DOM nodes and extract.ts needs DOMParser,
		// so the tests run against jsdom rather than bare node.
		environment: "jsdom",
		include: ["tests/**/*.test.ts"],
	},
});
