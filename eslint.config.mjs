// Same rule set the Obsidian community directory runs on every release.
// npm run lint before tagging, so the review comes back Passed, not Satisfactory.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		// build output, deps, and dev-only code the plugin never ships
		ignores: ["main.js", "node_modules/**", "tests/**", "tools/**", "shims/**", "fixtures/**", "docs/**"],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
	},
]);
