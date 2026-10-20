import { App, Notice, WorkspaceLeaf } from "obsidian";
import type { LecternSettings } from "../settings";
import { PdfCommentController } from "./PdfCommentController";
import { isPdfViewStillLoading, probePdfInternals } from "./pdfInternals";

/**
 * Keeps exactly one PdfCommentController per open PDF tab. `sync()` is called
 * on workspace events; it attaches to new PDF tabs, re-attaches when a tab
 * switches to another PDF, and tears down controllers whose tab closed.
 */
export class PdfCommentManager {
	private app: App;
	private settings: LecternSettings;
	private controllers = new Map<WorkspaceLeaf, PdfCommentController>();
	private attaching = new Set<WorkspaceLeaf>();
	private warnedUnsupported = false;
	private warnedPdfPlus = false;

	constructor(app: App, settings: LecternSettings) {
		this.app = app;
		this.settings = settings;
	}

	sync(): void {
		if (!this.settings.pdfComments || this.pdfPlusEnabled()) {
			this.destroyAll();
			return;
		}

		const leaves = new Set(this.app.workspace.getLeavesOfType("pdf"));

		for (const [leaf, controller] of this.controllers) {
			if (!leaves.has(leaf) || !controller.isCurrent()) {
				controller.destroy();
				this.controllers.delete(leaf);
			}
		}

		for (const leaf of leaves) {
			if (this.controllers.has(leaf) || this.attaching.has(leaf)) continue;
			void this.attach(leaf);
		}
	}

	private async attach(leaf: WorkspaceLeaf): Promise<void> {
		this.attaching.add(leaf);
		try {
			const controller = await PdfCommentController.attach(this.app, leaf, this.settings);
			if (!controller) {
				// Loaded, but the internals we read are missing: Obsidian changed.
				if (!isPdfViewStillLoading(leaf.view) && !probePdfInternals(leaf.view) && leaf.view.getViewType() === "pdf") {
					this.warnUnsupported();
				}
				return;
			}
			// The tab may have closed or switched files while we waited.
			if (!controller.isCurrent() || !this.app.workspace.getLeavesOfType("pdf").includes(leaf)) {
				controller.destroy();
				this.sync();
				return;
			}
			this.controllers.set(leaf, controller);
		} catch (error) {
			console.error("[lectern] could not attach PDF comments", error);
		} finally {
			this.attaching.delete(leaf);
		}
	}

	forLeaf(leaf: WorkspaceLeaf | null | undefined): PdfCommentController | null {
		return (leaf && this.controllers.get(leaf)) ?? null;
	}

	destroyAll(): void {
		for (const controller of this.controllers.values()) controller.destroy();
		this.controllers.clear();
	}

	/** PDF++ draws over the same pages; running both would fight. */
	private pdfPlusEnabled(): boolean {
		const enabled = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins?.enabledPlugins;
		const on = enabled?.has("pdf-plus") ?? false;
		if (on && !this.warnedPdfPlus) {
			this.warnedPdfPlus = true;
			new Notice("Lectern: PDF comments are off because PDF++ is enabled. Disable one of them.");
		}
		return on;
	}

	private warnUnsupported(): void {
		if (this.warnedUnsupported) return;
		this.warnedUnsupported = true;
		new Notice("Lectern: PDF comments are off. This Obsidian version changed its PDF viewer.");
	}
}
