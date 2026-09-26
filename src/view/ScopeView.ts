import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SCOPE, classify, type FileKind } from "../constants";
import type { ScopeSettings } from "../settings";
import { Renderer, type RenderContext, type ToolbarItem } from "../renderers/Renderer";
import { CodeRenderer } from "../renderers/CodeRenderer";
import { DocxRenderer } from "../renderers/DocxRenderer";
import { XlsxRenderer } from "../renderers/XlsxRenderer";
import { PptxRenderer } from "../renderers/PptxRenderer";
import { Toolbar } from "./Toolbar";
import { ZoomController } from "./ZoomController";
import { CommentStore } from "../comments/CommentStore";
import { CommentRail, type RailDelegate } from "../comments/CommentRail";
import { buildAnchor, clearHighlights, resolveAnchor } from "../comments/anchoring";
import { newCommentId, nowStamp, type Anchor, type PlacedComment } from "../comments/types";

export class ScopeView extends FileView implements RailDelegate {
	private settings: ScopeSettings;

	private toolbar!: Toolbar;
	private wrapper!: HTMLElement;
	private sizer!: HTMLElement;
	private content!: HTMLElement;
	private indicator!: HTMLElement;

	private renderer: Renderer | null = null;
	private zoom: ZoomController | null = null;
	private rail: CommentRail | null = null;
	private store: CommentStore | null = null;

	private draftAnchor: Anchor | null = null;
	private scrollHandler: (() => void) | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf, settings: ScopeSettings) {
		super(leaf);
		this.settings = settings;
	}

	getViewType(): string {
		return VIEW_TYPE_SCOPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Vault Scope";
	}

	getIcon(): string {
		return "scan-eye";
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.buildChrome();

		const kind = classify(file.extension);
		if (kind === "unsupported") {
			this.content.createDiv({
				cls: "vault-scope-error",
				text: `Vault Scope does not handle .${file.extension} files.`,
			});
			return;
		}

		const ctx: RenderContext = {
			app: this.app,
			file,
			container: this.content,
			settings: this.settings,
			refreshToolbar: () => this.refreshToolbar(),
		};

		this.renderer = createRenderer(kind, ctx);

		try {
			await this.renderer.render();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.content.empty();
			this.content.createDiv({ cls: "vault-scope-error", text: `Could not open this file: ${message}` });
			console.error("[vault-scope] render failed", error);
			return;
		}

		const extra = this.renderer.wrapperClass();
		if (extra) this.wrapper.addClass(extra);

		this.zoom?.set(this.settings.defaultZoomPercent / 100);
		// Let the browser finish laying the content out before measuring it.
		window.setTimeout(() => {
			this.zoom?.measure();
			// A slide is as wide as the deck says it is, which is routinely
			// wider than the pane once the comment rail has taken its share.
			// Shrink to fit rather than opening on a cropped slide, but never
			// enlarge: the default zoom still wins when it already fits.
			if (this.zoom?.overflowsWidth) {
				this.zoom.fitToWidth();
				this.refreshToolbar();
			}
		}, 0);

		this.store = new CommentStore(this.app, file, this.settings.sidecarFolder);
		await this.store.load();

		this.rail = new CommentRail(this.wrapper, this.content, this, this.settings.showResolvedByDefault);
		this.placeComments();
		this.refreshToolbar();

		this.watchLayout();
	}

	async onUnloadFile(): Promise<void> {
		this.teardown();
	}

	onunload(): void {
		this.teardown();
	}

	private teardown(): void {
		this.renderer?.destroy();
		this.renderer = null;
		this.zoom?.destroy();
		this.zoom = null;
		this.rail?.destroy();
		this.rail = null;
		this.store = null;
		this.draftAnchor = null;

		if (this.scrollHandler) {
			this.wrapper?.removeEventListener("scroll", this.scrollHandler);
			this.scrollHandler = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private buildChrome(): void {
		this.teardown();
		this.contentEl.empty();
		this.contentEl.addClass("vault-scope-container");

		this.toolbar = new Toolbar(this.contentEl);

		this.wrapper = this.contentEl.createDiv({ cls: "vault-scope-wrapper" });
		this.sizer = this.wrapper.createDiv({ cls: "vault-scope-sizer" });
		this.content = this.sizer.createDiv({ cls: "vault-scope-content" });

		this.indicator = this.contentEl.createDiv({ cls: "vault-scope-zoom-indicator", text: "100%" });

		this.zoom = new ZoomController(this.wrapper, this.sizer, this.content, this.indicator, () => {
			this.rail?.layout();
			// The toolbar shows the zoom percentage too; it stayed on its first
			// value because nothing refreshed it.
			this.refreshToolbar();
		});
	}

	private watchLayout(): void {
		this.scrollHandler = () => this.rail?.onScroll();
		this.wrapper.addEventListener("scroll", this.scrollHandler, { passive: true });

		// Images inside a docx or slide finish loading after render and change
		// the height, so relayout when the content box actually changes.
		this.resizeObserver = new ResizeObserver(() => {
			this.zoom?.measure();
			this.rail?.layout();
		});
		this.resizeObserver.observe(this.content);
	}

	// ----- comments -------------------------------------------------------

	private placeComments(): void {
		if (!this.store || !this.rail) return;

		clearHighlights(this.content);

		const placed: PlacedComment[] = this.store.comments.map((comment) => {
			const result = resolveAnchor(this.content, comment.anchor, comment.id);
			return { comment, elements: result.elements, orphaned: result.orphaned };
		});

		this.rail.setComments(placed);
	}

	/** Start a comment from whatever is selected right now. */
	startComment(): void {
		if (!this.rail || !this.store) return;

		const blocked = this.renderer?.commentingBlocked();
		if (blocked) {
			new Notice(blocked);
			return;
		}

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
			new Notice("Select some text first, then add a comment.");
			return;
		}

		const range = selection.getRangeAt(0);
		if (!this.content.contains(range.commonAncestorContainer)) {
			new Notice("Select text inside the document.");
			return;
		}

		const anchor = buildAnchor(this.content, range);
		if (!anchor) {
			new Notice("That selection cannot be anchored. Try selecting inside a single slide, page, or line.");
			return;
		}

		this.draftAnchor = anchor;

		const box = range.getBoundingClientRect();
		const top = box.top - this.wrapper.getBoundingClientRect().top + this.wrapper.scrollTop;
		this.rail.openDraft(top);
	}

	async commitDraft(body: string): Promise<void> {
		if (!this.store || !this.draftAnchor) return;

		await this.store.add({
			id: newCommentId(),
			anchor: this.draftAnchor,
			status: "open",
			created: nowStamp(),
			body,
		});

		this.draftAnchor = null;
		this.rail?.closeDraft();
		window.getSelection()?.removeAllRanges();
		this.placeComments();
		this.refreshToolbar();
	}

	cancelDraft(): void {
		this.draftAnchor = null;
		this.rail?.closeDraft();
		this.rail?.layout();
	}

	async saveBody(id: string, body: string): Promise<void> {
		await this.store?.update(id, { body });
		this.placeComments();
	}

	async setStatus(id: string, status: "open" | "resolved"): Promise<void> {
		await this.store?.update(id, { status });
		this.placeComments();
		this.refreshToolbar();
	}

	async deleteComment(id: string): Promise<void> {
		await this.store?.remove(id);
		this.placeComments();
		this.refreshToolbar();
	}

	/** Open the markdown sidecar in a split beside the preview. */
	async openSidecar(): Promise<void> {
		if (!this.store) return;

		const file = this.store.sidecarFile();
		if (!file) {
			new Notice("No comments on this file yet.");
			return;
		}

		const leaf = this.app.workspace.getLeaf("split");
		await leaf.openFile(file);
	}

	/** Reload comments from disk, for when the sidecar was edited by hand. */
	async reloadComments(): Promise<void> {
		await this.store?.load();
		this.placeComments();
		new Notice("Comments reloaded.");
	}

	// ----- toolbar --------------------------------------------------------

	private refreshToolbar(): void {
		const zoomGroup: ToolbarItem[] = [
			{ id: "zoom-out", label: "Zoom out", text: "–", onClick: () => this.zoom?.out() },
			Toolbar.label(`${Math.round((this.zoom?.value ?? 1) * 100)}%`),
			{ id: "zoom-in", label: "Zoom in", text: "+", onClick: () => this.zoom?.in() },
			{ id: "zoom-reset", label: "Reset zoom to 100%", text: "Reset", onClick: () => this.zoom?.reset() },
			{
				id: "zoom-fit",
				label: "Fit the page width to the pane",
				text: "Fit",
				onClick: () => this.zoom?.fitToWidth(),
			},
		];

		const openCount = this.store?.comments.filter((c) => c.status === "open").length ?? 0;

		const commentGroup: ToolbarItem[] = [
			{
				id: "comment",
				label: "Comment on the selected text (Ctrl+Alt+M)",
				text: "Comment",
				onClick: () => this.startComment(),
			},
			{
				id: "open-sidecar",
				label: "Open the markdown note holding these comments",
				text: openCount > 0 ? `Notes (${openCount})` : "Notes",
				disabled: (this.store?.comments.length ?? 0) === 0,
				onClick: () => this.openSidecar(),
			},
		];

		this.toolbar.render([zoomGroup, this.renderer?.toolbarItems() ?? [], commentGroup]);
	}
}

function createRenderer(kind: Exclude<FileKind, "unsupported">, ctx: RenderContext): Renderer {
	switch (kind) {
		case "code": return new CodeRenderer(ctx);
		case "docx": return new DocxRenderer(ctx);
		case "xlsx": return new XlsxRenderer(ctx);
		case "pptx": return new PptxRenderer(ctx);
	}
}
