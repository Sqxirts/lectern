import { FileView, Menu, Notice, Scope, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_LECTERN, classify, type FileKind } from "../constants";
import type { LecternSettings } from "../settings";
import { Renderer, type RenderContext, type ToolbarItem } from "../renderers/Renderer";
import { CodeRenderer } from "../renderers/CodeRenderer";
import { DocxRenderer } from "../renderers/DocxRenderer";
import { XlsxRenderer } from "../renderers/XlsxRenderer";
import { PptxRenderer } from "../renderers/PptxRenderer";
import { Toolbar } from "./Toolbar";
import { ZoomController } from "./ZoomController";
import { FIND_SHORTCUT, FindController } from "../find/FindController";
import { saveExport } from "../export/exportNote";
import { CommentStore } from "../comments/CommentStore";
import { CommentRail } from "../comments/CommentRail";
import { CommentSession, type CommentHost } from "../comments/CommentSession";
import { buildAnchor, clearHighlights, resolveAnchor } from "../comments/anchoring";
import type { PlacedComment, ScopeComment } from "../comments/types";

export class LecternView extends FileView {
	private settings: LecternSettings;

	private toolbar!: Toolbar;
	private wrapper!: HTMLElement;
	private sizer!: HTMLElement;
	private content!: HTMLElement;
	private indicator!: HTMLElement;

	private renderer: Renderer | null = null;
	private zoom: ZoomController | null = null;
	private comments: CommentSession<TFile> | null = null;
	private find: FindController | null = null;

	private scrollHandler: (() => void) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	/**
	 * Bumped on every teardown. onLoadFile awaits the render and the sidecar;
	 * if the user switched files meanwhile, the rest of that load must not run,
	 * or it wires the old file's comments onto the new file's DOM and new
	 * comments save to the wrong sidecar.
	 */
	private loadGen = 0;

	constructor(leaf: WorkspaceLeaf, settings: LecternSettings) {
		super(leaf);
		this.settings = settings;

		// Bound on the view's own scope, not as a plugin hotkey: Mod+F is the
		// editor's search everywhere else, and this only applies while a
		// Lectern tab has focus. Returning false stops Obsidian handling it too.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "f", () => {
			this.openFind();
			return false;
		});
	}

	getViewType(): string {
		return VIEW_TYPE_LECTERN;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Lectern";
	}

	getIcon(): string {
		return "scan-eye";
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.buildChrome();
		const gen = this.loadGen;
		const stale = () => gen !== this.loadGen;

		const kind = classify(file.extension);
		if (kind === "unsupported") {
			this.content.createDiv({
				cls: "lectern-error",
				text: `Lectern does not handle .${file.extension} files.`,
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
			// A torn-down renderer may reject; that error belongs to the old file.
			if (stale()) return;
			const message = error instanceof Error ? error.message : String(error);
			this.content.empty();
			this.content.createDiv({ cls: "lectern-error", text: `Could not open this file: ${message}` });
			console.error("[lectern] render failed", error);
			return;
		}
		if (stale() || !this.renderer) return;

		const extra = this.renderer.wrapperClass();
		if (extra) this.wrapper.addClass(extra);

		this.zoom?.set(this.settings.defaultZoomPercent / 100);
		// Let the browser finish laying the content out before measuring it.
		window.setTimeout(() => {
			if (stale()) return;
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

		const session = new CommentSession<TFile>(
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
		this.comments = session;
		await session.start();
		// teardown() destroyed this session if another file opened meanwhile.
		if (stale()) return;
		// The rail only takes its strip once it has comments to show, which is
		// after the first fit check ran. Shrink again if it now covers the page.
		window.setTimeout(() => {
			if (stale()) return;
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
		this.loadGen++;
		this.renderer?.destroy();
		this.renderer = null;
		this.zoom?.destroy();
		this.zoom = null;
		this.comments?.destroy();
		this.comments = null;
		this.find?.destroy();
		this.find = null;

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
		this.contentEl.addClass("lectern-container");

		this.toolbar = new Toolbar(this.contentEl);
		const findHost = this.contentEl.createDiv({ cls: "lectern-find-host" });

		this.wrapper = this.contentEl.createDiv({ cls: "lectern-wrapper" });
		this.sizer = this.wrapper.createDiv({ cls: "lectern-sizer" });
		this.content = this.sizer.createDiv({ cls: "lectern-content" });

		this.indicator = this.contentEl.createDiv({ cls: "lectern-zoom-indicator", text: "100%" });

		this.zoom = new ZoomController(this.wrapper, this.sizer, this.content, this.indicator, () => {
			this.comments?.layout();
			// The toolbar shows the zoom percentage too; it stayed on its first
			// value because nothing refreshed it.
			this.refreshToolbar();
		});

		this.find = new FindController(findHost, this.content, this.wrapper, {
			reveal: (node) => this.renderer?.reveal(node),
			blockedReason: () => this.renderer?.findBlocked() ?? null,
			changed: () => this.refreshToolbar(),
		});
	}

	/** Open the find bar, or refocus it if it's already open. */
	openFind(): void {
		this.find?.open();
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
		// Dragging the pane narrower leaves the content's size alone, so watch
		// the pane too, or cards and connectors stay where the old width put them.
		this.resizeObserver.observe(this.wrapper);
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

	/** Highlight the selection with no note. */
	highlightSelection(): void {
		void this.comments?.highlightSelection();
	}

	// ----- export ---------------------------------------------------------

	/** Copy the whole file to the clipboard as markdown. */
	async copyAsMarkdown(): Promise<void> {
		const markdown = await this.exportText();
		if (markdown === null) return;
		await navigator.clipboard.writeText(markdown);
		new Notice("Copied as Markdown.");
	}

	/** Write the file's markdown to a note next to it and open that note. */
	async saveAsNote(): Promise<void> {
		const file = this.file;
		const markdown = await this.exportText();
		if (!file || markdown === null) return;
		try {
			const note = await saveExport(this.app, file, markdown);
			new Notice(`Saved ${note.path}`);
			await this.app.workspace.getLeaf("split").openFile(note);
		} catch (error) {
			new Notice("Could not save the note. See the console for details.");
			console.error("[lectern] export failed", error);
		}
	}

	/** True when the export commands apply to the open file. */
	get canExport(): boolean {
		return this.renderer?.canExport() ?? false;
	}

	/** The markdown for the open file, or null (with a notice saying why). */
	private async exportText(): Promise<string | null> {
		if (!this.renderer?.canExport()) {
			new Notice("Only decks, documents and workbooks can be exported.");
			return null;
		}
		try {
			const markdown = await this.renderer.exportMarkdown();
			if (markdown?.trim()) return markdown;
			new Notice("No text found to export.");
		} catch (error) {
			new Notice("Could not export this file. See the console for details.");
			console.error("[lectern] export failed", error);
		}
		return null;
	}

	private showExportMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Copy as Markdown").setIcon("copy").onClick(() => void this.copyAsMarkdown()));
		menu.addItem((item) => item.setTitle("Save as Markdown note").setIcon("file-text").onClick(() => void this.saveAsNote()));
		menu.showAtMouseEvent(event);
	}

	toggleResolved(): void {
		this.comments?.toggleResolved();
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
		const resolvedCount = this.comments?.resolvedCount ?? 0;
		const showingResolved = this.comments?.resolvedVisible ?? false;

		const commentGroup: ToolbarItem[] = [
			{
				id: "comment",
				label: "Comment on the selected text",
				text: "Comment",
				onClick: () => this.startComment(),
			},
			{
				id: "highlight",
				label: "Highlight the selected text without a note",
				text: "Highlight",
				onClick: () => this.highlightSelection(),
			},
			{
				id: "open-sidecar",
				label: "Open the markdown note holding these comments",
				text: openCount > 0 ? `Notes (${openCount})` : "Notes",
				disabled: (this.comments?.total ?? 0) === 0,
				onClick: () => this.openSidecar(),
			},
			{
				id: "toggle-resolved",
				label: showingResolved ? "Hide resolved comments" : "Show resolved comments, to read or reopen them",
				text: showingResolved ? "Hide resolved" : resolvedCount > 0 ? `Show resolved (${resolvedCount})` : "Show resolved",
				disabled: !showingResolved && resolvedCount === 0,
				onClick: () => this.toggleResolved(),
			},
		];

		const findGroup: ToolbarItem[] = [
			{
				id: "find",
				label: `Find in this file (${FIND_SHORTCUT})`,
				text: "Find",
				active: this.find?.isOpen ?? false,
				onClick: () => this.find?.toggle(),
			},
		];

		const exportGroup: ToolbarItem[] = this.canExport
			? [
					{
						id: "export",
						label: "Copy this file as markdown, or save it as a note",
						text: "Export",
						onClick: (event) => this.showExportMenu(event),
					},
				]
			: [];

		this.toolbar.render([zoomGroup, this.renderer?.toolbarItems() ?? [], findGroup, exportGroup, commentGroup]);
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
