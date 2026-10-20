import esbuild from "esbuild";
import process from "node:process";
import { builtinModules as builtins } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the built plugin lands. This is a local machine path, so it is never
 * committed: set it in .env.local (see .env.example) or as an environment
 * variable. Falling back to ./dist means a fresh clone still builds.
 */
function resolveOutDir() {
	if (process.env.LECTERN_OUT) return process.env.LECTERN_OUT;

	const envFile = join(here, ".env.local");
	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
			const match = /^\s*LECTERN_OUT\s*=\s*(.+?)\s*$/.exec(line);
			if (match) {
				const value = match[1].replace(/^["']|["']$/g, "");
				if (value) return isAbsolute(value) ? value : join(here, value);
			}
		}
	}

	console.warn(
		"[lectern] No LECTERN_OUT set, building to ./dist.\n" +
			"             Copy .env.example to .env.local and point it at\n" +
			"             <your vault>/.obsidian/plugins/lectern to install on build."
	);
	return join(here, "dist");
}

const outDir = resolveOutDir();

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
				console.log(`[lectern] built -> ${outDir}`);
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
	console.log("[lectern] watching for changes...");
}
