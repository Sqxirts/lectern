import { App, Notice, TFile, normalizePath } from "obsidian";
import { INDEX_FILE_NAME, commentIndexBase } from "./commentIndex";
import { countComments, parseSidecar } from "./sidecarFormat";

const SIDECAR_SUFFIX = ".comments.md";

/**
 * Open the comment index Base, creating it on first use.
 *
 * Sidecars written before the counts existed have no `open_comments` in their
 * frontmatter, so the Base would show them blank. Fill those in here, touching
 * only the two count properties and only where they are wrong.
 */
export async function openCommentIndex(app: App, folder: string): Promise<void> {
	const updated = await syncCounts(app, folder);

	const path = normalizePath(`${folder}/${INDEX_FILE_NAME}`);
	let file = app.vault.getAbstractFileByPath(path);
	if (!file) {
		await ensureFolder(app, folder);
		file = await app.vault.create(path, commentIndexBase());
	}
	if (!(file instanceof TFile)) {
		new Notice(`${path} is a folder, so Lectern cannot create the comment index there.`);
		return;
	}

	if (updated > 0) new Notice(`Updated comment counts on ${updated} note${updated === 1 ? "" : "s"}.`);
	await app.workspace.getLeaf(false).openFile(file);
}

/** Returns how many sidecars were changed. */
async function syncCounts(app: App, folder: string): Promise<number> {
	const prefix = `${folder}/`;
	let changed = 0;

	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix) || !file.name.endsWith(SIDECAR_SUFFIX)) continue;

		const counts = countComments(parseSidecar(await app.vault.cachedRead(file)).comments);
		let touched = false;
		await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			if (frontmatter.open_comments === counts.open_comments && frontmatter.resolved_comments === counts.resolved_comments) return;
			frontmatter.open_comments = counts.open_comments;
			frontmatter.resolved_comments = counts.resolved_comments;
			touched = true;
		});
		if (touched) changed++;
	}
	return changed;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	let built = "";
	for (const part of folder.split("/").filter(Boolean)) {
		built = built ? `${built}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(normalizePath(built))) {
			await app.vault.createFolder(normalizePath(built));
		}
	}
}
