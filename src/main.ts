import { Notice, Plugin, TFile } from "obsidian";
import { ALL_EXTENSIONS, NEVER_REGISTER, PLUGIN_NAME, VIEW_TYPE_SCOPE, classify, migrateExtensions } from "./constants";
import { DEFAULT_SETTINGS, ScopeSettingTab, type ScopeSettings } from "./settings";
import { ScopeView } from "./view/ScopeView";
import { PdfCommentManager } from "./pdf/PdfCommentManager";
import type { PdfCommentController } from "./pdf/PdfCommentController";
import { patchPdfContextMenu } from "./pdf/pdfContextMenu";

/** What the comment commands need, from either a Vault Scope view or a PDF tab. */
interface CommentTarget {
	startComment(): void;
	openSidecar(): Promise<void>;
	reloadComments(): Promise<void>;
}

export default class VaultScopePlugin extends Plugin {
	settings: ScopeSettings = DEFAULT_SETTINGS;
	pdfComments!: PdfCommentManager;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.pdfComments = new PdfCommentManager(this.app, this.settings);
		const syncPdf = () => this.pdfComments.sync();
		this.app.workspace.onLayoutReady(syncPdf);
		this.registerEvent(this.app.workspace.on("layout-change", syncPdf));
		this.registerEvent(this.app.workspace.on("file-open", syncPdf));
		this.register(() => this.pdfComments.destroyAll());
		this.register(patchPdfContextMenu((target) => this.pdfControllerFor(target)));

		this.registerView(VIEW_TYPE_SCOPE, (leaf) => new ScopeView(leaf, this.settings));
		this.registerFileExtensions();

		this.addRibbonIcon("scan-eye", `Open in ${PLUGIN_NAME}`, () => void this.openActiveFile());

		this.addCommand({
			id: "open-current-file",
			name: "Open current file in Vault Scope",
			callback: () => void this.openActiveFile(),
		});

		this.addCommand({
			id: "comment-on-selection",
			name: "Comment on selection",
			hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "m" }],
			checkCallback: (checking) => {
				const view = this.activeCommentTarget();
				if (!view) return false;
				if (!checking) view.startComment();
				return true;
			},
		});

		this.addCommand({
			id: "open-comment-note",
			name: "Open the comment note for this file",
			checkCallback: (checking) => {
				const view = this.activeCommentTarget();
				if (!view) return false;
				if (!checking) void view.openSidecar();
				return true;
			},
		});

		this.addCommand({
			id: "reload-comments",
			name: "Reload comments from disk",
			checkCallback: (checking) => {
				const view = this.activeCommentTarget();
				if (!view) return false;
				if (!checking) void view.reloadComments();
				return true;
			},
		});

		this.addSettingTab(new ScopeSettingTab(this.app, this));
	}

	/**
	 * Register one extension at a time. If another plugin already owns one,
	 * Obsidian throws, and a single throw inside a bulk call would cost us
	 * every remaining extension.
	 */
	private registerFileExtensions(): void {
		const wanted = new Set(this.settings.registeredExtensions);
		const skipped: string[] = [];

		for (const ext of ALL_EXTENSIONS) {
			if (!wanted.has(ext) || NEVER_REGISTER.has(ext)) continue;
			try {
				this.registerExtensions([ext], VIEW_TYPE_SCOPE);
			} catch {
				skipped.push(ext);
			}
		}

		if (skipped.length > 0) {
			console.info(`[vault-scope] another plugin already handles: ${skipped.join(", ")}`);
		}
	}

	private activeCommentTarget(): CommentTarget | null {
		const view = this.app.workspace.getActiveViewOfType(ScopeView);
		if (view) return view;
		return this.pdfComments.forLeaf(this.app.workspace.getMostRecentLeaf());
	}

	/** The PDF tab a right-clicked element sits in, if we are commenting on it. */
	private pdfControllerFor(target: Element): PdfCommentController | null {
		for (const leaf of this.app.workspace.getLeavesOfType("pdf")) {
			if (leaf.view.containerEl.contains(target)) return this.pdfComments.forLeaf(leaf);
		}
		return null;
	}

	private async openActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No file is open.");
			return;
		}
		await this.openInScope(file);
	}

	async openInScope(file: TFile): Promise<void> {
		if (classify(file.extension) === "unsupported") {
			new Notice(`${PLUGIN_NAME} does not handle .${file.extension} files.`);
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({ type: VIEW_TYPE_SCOPE, state: { file: file.path } });
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

		const { changed } = migrateExtensions(this.settings, saved != null);
		if (changed) await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
