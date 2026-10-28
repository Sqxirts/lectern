import type { App, TFile } from "obsidian";

/**
 * Saving an export as a note next to its source file.
 *
 * Re-exporting overwrites the earlier export, so the note stays current, but
 * only a note this plugin wrote: a note you made by hand with the same name is
 * never touched, and the new export gets a number instead. The marker is the
 * `lectern-export` tag.
 */

export const EXPORT_TAG = "lectern-export";

export function exportNoteContent(sourcePath: string, title: string, markdown: string): string {
	return [
		"---",
		`source: ${JSON.stringify(sourcePath)}`,
		"tags:",
		`  - ${EXPORT_TAG}`,
		"---",
		"",
		`# ${title}`,
		"",
		markdown.trim(),
		"",
	].join("\n");
}

/** Whether this text is an export note written by Lectern, going by its frontmatter alone. */
export function isLecternExport(text: string): boolean {
	if (!text.startsWith("---")) return false;
	const end = text.indexOf("\n---", 3);
	return end > 0 && new RegExp(`^\\s*-\\s*${EXPORT_TAG}\\s*$`, "m").test(text.slice(0, end));
}

/** `Deck.pptx` in `Notes/` becomes `Notes/Deck (export).md`, then `... (export 2).md`. */
export function exportNotePath(source: TFile, attempt: number): string {
	const folder = source.parent && source.parent.path !== "/" ? `${source.parent.path}/` : "";
	const suffix = attempt <= 1 ? "(export)" : `(export ${attempt})`;
	return `${folder}${source.basename} ${suffix}.md`;
}

/** Create or refresh the export note and return it. */
export async function saveExport(app: App, source: TFile, markdown: string): Promise<TFile> {
	const content = exportNoteContent(source.path, source.basename, markdown);

	for (let attempt = 1; attempt < 100; attempt++) {
		const path = exportNotePath(source, attempt);
		const existing = app.vault.getFileByPath(path);
		if (!existing) return app.vault.create(path, content);
		if (isLecternExport(await app.vault.read(existing))) {
			await app.vault.modify(existing, content);
			return existing;
		}
	}
	throw new Error(`Too many notes named like "${source.basename} (export)" already exist.`);
}
