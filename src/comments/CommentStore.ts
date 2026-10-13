import { App, TFile, normalizePath } from "obsidian";
import type { ScopeComment } from "./types";
import { parseSidecar, serialiseSidecar, type ParsedSidecar } from "./sidecarFormat";

/**
 * Comments live in a markdown sidecar rather than inside the .docx/.pptx, so
 * the original file is never rewritten and Obsidian's own search can see every
 * comment. This class is only the vault I/O; the file format lives in
 * sidecarFormat.ts.
 */

/** Maps a source file's top-level folder onto the vault's area vocabulary. */
const AREA_BY_FOLDER: Record<string, string> = {
	Degree: "degree",
	Homelab: "homelab",
	Gaming: "gaming",
	Projects: "projects",
	"CPP-Reviews": "degree",
};

/** Pending writes per sidecar path, shared by every store in the plugin. */
const writeQueue = new Map<string, Promise<void>>();

export class CommentStore {
	private app: App;
	private folder: string;
	private source: TFile;
	private parsed: ParsedSidecar = { preamble: "", comments: [], foreign: [] };

	constructor(app: App, source: TFile, folder: string) {
		this.app = app;
		this.source = source;
		this.folder = folder;
	}

	/** Vault-relative path of this file's sidecar. */
	get path(): string {
		return normalizePath(`${this.folder}/${this.source.name}.comments.md`);
	}

	get comments(): ScopeComment[] {
		return this.parsed.comments;
	}

	sidecarFile(): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(this.path);
		return file instanceof TFile ? file : null;
	}

	async load(): Promise<ScopeComment[]> {
		const file = this.sidecarFile();
		if (!file) {
			this.parsed = { preamble: "", comments: [], foreign: [] };
			return [];
		}
		this.parsed = parseSidecar(await this.app.vault.read(file));
		return this.parsed.comments;
	}

	async add(comment: ScopeComment): Promise<void> {
		await this.mutate((parsed) => {
			parsed.comments.push(comment);
		});
	}

	async update(id: string, changes: Partial<Pick<ScopeComment, "body" | "status">>): Promise<void> {
		await this.mutate((parsed) => {
			const comment = parsed.comments.find((c) => c.id === id);
			if (!comment) return false;
			Object.assign(comment, changes);
		});
	}

	async remove(id: string): Promise<void> {
		await this.mutate((parsed) => {
			const before = parsed.comments.length;
			parsed.comments = parsed.comments.filter((c) => c.id !== id);
			if (parsed.comments.length === before) return false;
		});
	}

	/**
	 * Apply one change on top of what is on disk right now, one write at a time
	 * per sidecar.
	 *
	 * Each store used to change its own in-memory copy and write the whole file
	 * back. With the same file open in two panes, each pane's copy went stale the
	 * moment the other one saved, so the last pane to save silently erased the
	 * other's new comment. Both could also try vault.create on a brand-new
	 * sidecar at once, and the second threw. Re-reading inside a per-path queue
	 * makes every change land on the latest file instead.
	 *
	 * `change` returns false when it found nothing to do, which skips the write.
	 */
	private mutate(change: (parsed: ParsedSidecar) => void | false): Promise<void> {
		const path = this.path;
		const previous = writeQueue.get(path) ?? Promise.resolve();
		const next = previous.then(async () => {
			await this.load();
			if (change(this.parsed) === false) return;
			await this.flush();
		});
		// A failed write must not wedge the queue for every later change.
		const settled = next.catch(() => undefined);
		writeQueue.set(path, settled);
		void settled.then(() => {
			if (writeQueue.get(path) === settled) writeQueue.delete(path);
		});
		return next;
	}

	private async flush(): Promise<void> {
		const markdown = serialiseSidecar(this.parsed, {
			title: `Comments on ${this.source.name}`,
			area: this.area(),
			source: this.source.path,
		});

		const existing = this.sidecarFile();
		if (existing) {
			await this.app.vault.modify(existing, markdown);
			return;
		}

		await this.ensureFolder();
		await this.app.vault.create(this.path, markdown);
	}

	private async ensureFolder(): Promise<void> {
		const parts = this.folder.split("/").filter(Boolean);
		let built = "";
		for (const part of parts) {
			built = built ? `${built}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(normalizePath(built))) {
				await this.app.vault.createFolder(normalizePath(built));
			}
		}
	}

	private area(): string {
		const top = this.source.path.split("/")[0];
		return AREA_BY_FOLDER[top] ?? "meta";
	}
}
