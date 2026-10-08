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
import { CommentRail } from "../comments/CommentRail";
import { CommentSession, type CommentHost } from "../comments/CommentSession";
import { buildAnchor, clearHighlights, resolveAnchor } from "../comments/anchoring";
import type { PlacedComment, ScopeComment } from "../comments/types";

export class ScopeView extends FileView {
	private settings: ScopeSettings;

	private toolbar!: Toolbar;
	private wrapper!: HTMLElement;
	private sizer!: HTMLElement;
	private content!: HTMLElement;
	private indicator!: HTMLElement;

	private renderer: Renderer | null = null;
	private zoom: ZoomController | null = null;
	private comments: CommentSession<TFile> | null = null;

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

		this.comments = new CommentSession<TFile>(
			this.commentHost(),
			new CommentStore(this.app, file, this.settings.sidecarFolder),
			(delegate) => new CommentRail(this.wrapper, this.content, delegate, this.settings.showResolvedByDefault),
			{
				notify: (message) => new Notice(message),
				openNote: async (note) => {
					await this.app.workspace.getLeaf("split").openFile(note);
				},
				getSelection: () => window.getSelection(),
			},
		);
		await this.comments.start();
		// The rail only takes its strip once it has comments to show, which is
		// after the first fit check ran. Shrink again if it now covers the page.
		window.setTimeout(() => {
			if (this.zoom?.overflowsWidth) this.zoom.fitToWidth();
		}, 0);
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
		this.comments?.destroy();
		this.comments = null;

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
			this.comments?.layout();
			// The toolbar shows the zoom percentage too; it stayed on its first
			// value because nothing refreshed it.
			this.refreshToolbar();
		});
	}

	private watchLayout(): void {
		this.scrollHandler = () => this.comments?.onScroll();
		this.wrapper.addEventListener("scroll", this.scrollHandler, { passive: true });

		// Images inside a docx or slide finish loading after render and change
		// the height, so relayout when the content box actually changes.
		this.resizeObserver = new ResizeObserver(() => {
			this.zoom?.measure();
			this.comments?.layout();
		});
		this.resizeObserver.observe(this.content);
	}

	// ----- comments -------------------------------------------------------

	/** How this view's rendered DOM plugs into the shared comment workflow. */
	private commentHost(): CommentHost {
		return {
			root: this.content,
			blockedReason: () => this.renderer?.commentingBlocked() ?? null,
			buildAnchor: (range) => buildAnchor(this.content, range),
			place: (comments: ScopeComment[]): PlacedComment[] => {
				clearHighlights(this.content);
				return comments.map((comment) => {
					const result = resolveAnchor(this.content, comment.anchor, comment.id);
					return { comment, elements: result.elements, orphaned: result.orphaned };
				});
			},
			draftTop: (range) => {
				const box = range.getBoundingClientRect();
				return box.top - this.wrapper.getBoundingClientRect().top + this.wrapper.scrollTop;
			},
			changed: () => this.refreshToolbar(),
		};
	}

	/** Start a comment from whatever is selected right now. */
	startComment(): void {
		this.comments?.startComment();
	}

	/** Open the markdown sidecar in a split beside the preview. */
	async openSidecar(): Promise<void> {
		await this.comments?.openSidecar();
	}

	/** Reload comments from disk, for when the sidecar was edited by hand. */
	async reloadComments(): Promise<void> {
		await this.comments?.reload();
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

		const openCount = this.comments?.openCount ?? 0;

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
				disabled: (this.comments?.total ?? 0) === 0,
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
