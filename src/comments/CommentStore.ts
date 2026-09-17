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
		this.parsed.comments.push(comment);
		await this.flush();
	}

	async update(id: string, changes: Partial<Pick<ScopeComment, "body" | "status">>): Promise<void> {
		const comment = this.parsed.comments.find((c) => c.id === id);
		if (!comment) return;
		Object.assign(comment, changes);
		await this.flush();
	}

	async remove(id: string): Promise<void> {
		this.parsed.comments = this.parsed.comments.filter((c) => c.id !== id);
		await this.flush();
	}

	private async flush(): Promise<void> {
		const markdown = serialiseSidecar(this.parsed, {
			title: `${this.source.name} — comments`,
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
