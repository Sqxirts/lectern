import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Build straight into the live plugin folder so a build is instantly testable.
//
// The source sits outside the vault on purpose. LiveSync here runs with
// liveSync on, an empty syncIgnoreRegEx and useIgnoreFiles off, so a
// node_modules inside the vault would replicate ~20k files to every device.
// Point VAULT_SCOPE_OUT somewhere else if the vault moves.
const outDir =
	process.env.VAULT_SCOPE_OUT ??
	join("C:/", "Users", "clash", "Documents", "Vault", "Vault", ".obsidian", "plugins", "vault-scope");

const prod = process.argv[2] === "production";

mkdirSync(outDir, { recursive: true });

// manifest.json and styles.css aren't bundled, Obsidian reads them off disk.
function copyStaticFiles() {
	for (const name of ["manifest.json", "styles.css"]) {
		copyFileSync(join(here, name), join(outDir, name));
	}
}

const copyPlugin = {
	name: "copy-static",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length === 0) {
				copyStaticFiles();
				console.log(`[vault-scope] built -> ${outDir}`);
			}
		});
	},
};

const context = await esbuild.context({
	entryPoints: [join(here, "src", "main.ts")],
	bundle: true,
	// Everything Obsidian provides at runtime must stay external or the bundle
	// will ship a second copy of the editor and break.
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: join(outDir, "main.js"),
	plugins: [copyPlugin],
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
	console.log("[vault-scope] watching for changes...");
}
