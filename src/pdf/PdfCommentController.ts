import { App, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { LecternSettings } from "../settings";
import { CommentRail } from "../comments/CommentRail";
import { CommentSession, type CommentHost } from "../comments/CommentSession";
import { CommentStore } from "../comments/CommentStore";
import type { PdfAnchor, PlacedComment, ScopeComment } from "../comments/types";
import { PdfPageText, buildPdfAnchor, resolvePdfAnchor, type PdfPlacement, type PdfSpan } from "./pdfAnchoring";
import { pageElementOf, rangeToSpan } from "./pdfDom";
import { PDF_BOX_CLASS, clearPage, drawBoxes, drawMarker, renderedTextDivs } from "./pdfHighlights";
import { probePdfInternals, type PdfInternals, type PdfPageView } from "./pdfInternals";

/** Kept in step with --lectern-rail-width in styles.css, plus its 16px gutters. */
const STRIP_WIDTH = 260 + 32;

/** Re-resolve when the stored anchor changes, e.g. after a hand edit and reload. */
const keyOf = (anchor: PdfAnchor): string => JSON.stringify(anchor);

interface Resolved {
	key: string;
	placement: PdfPlacement;
}

/**
 * Comments on one open PDF, inside Obsidian's own PDF viewer.
 *
 * Lifecycle: `attach` waits for the viewer to finish loading, then builds a
 * CommentSession whose host methods are the PDF versions of what LecternView
 * does for DOM-rendered files. Anchors are resolved asynchronously on PDF.js
 * text (pdfAnchoring.ts), cached per comment, and drawn whenever PDF.js
 * renders a page's text layer, which it does again after every zoom.
 */
export class PdfCommentController {
	readonly leaf: WorkspaceLeaf;
	readonly file: TFile;

	private app: App;
	private settings: LecternSettings;
	private pdf: PdfInternals;
	private session: CommentSession<TFile> | null = null;

	private strip: HTMLElement;
	private overlay: HTMLElement;
	private savedRight: string;

	/** Page text from getTextContent(), one promise per page so concurrent asks share it. */
	private texts = new Map<number, Promise<PdfPageText | null>>();
	/** The same text once it has arrived, for the synchronous drawing path. */
	private loadedTexts = new Map<number, PdfPageText>();
	private pageBoxes = new Map<number, number[]>();
	private resolved = new Map<string, Resolved>();
	private placed: PlacedComment[] = [];
	private resolving: Promise<void> | null = null;
	private destroyed = false;

	private onTextLayer = (event: { source?: PdfPageView }) => this.redrawPage(event.source);
	private onScroll = () => {
		this.redrawDetached();
		this.session?.onScroll();
	};
	private onClick = (event: MouseEvent) => this.focusAt(event);
	private resizeObserver: ResizeObserver;

	/** Attach to a PDF leaf once its viewer has a document. Null if this isn't a usable PDF view. */
	static async attach(app: App, leaf: WorkspaceLeaf, settings: LecternSettings): Promise<PdfCommentController | null> {
		for (let i = 0; i < 100; i++) {
			const view = leaf.view;
			const file = (view as { file?: TFile | null }).file;
			const pdf = probePdfInternals(view);
			if (pdf && file && pdf.document() && pdf.viewer.pagesCount > 0) {
				const controller = new PdfCommentController(app, leaf, file, pdf, settings);
				try {
					await controller.start();
				} catch (error) {
					// The constructor already added the strip and overlay; take them back out.
					controller.destroy();
					throw error;
				}
				return controller;
			}
			if (view.getViewType() !== "pdf") return null;
			await sleep(100);
		}
		return null;
	}

	private constructor(app: App, leaf: WorkspaceLeaf, file: TFile, pdf: PdfInternals, settings: LecternSettings) {
		this.app = app;
		this.leaf = leaf;
		this.file = file;
		this.pdf = pdf;
		this.settings = settings;

		const container = pdf.viewer.container;
		const parent = container.parentElement!;
		this.savedRight = container.style.right;

		this.strip = parent.createDiv({ cls: "lectern-pdf-strip" });
		this.overlay = parent.createDiv({ cls: "lectern-pdf-overlay" });

		this.resizeObserver = new ResizeObserver(() => {
			this.redrawDetached();
			this.session?.layout();
		});
	}

	private async start(): Promise<void> {
		const container = this.pdf.viewer.container;

		this.session = new CommentSession<TFile>(
			this.host(),
			new CommentStore(this.app, this.file, this.settings.sidecarFolder),
			(delegate) =>
				new CommentRail(container, this.pdf.viewer.container, delegate, this.settings.showResolvedByDefault, {
					strip: this.strip,
					overlay: this.overlay,
					onReserve: (reserved) => this.reserveStrip(reserved),
				}),
			{
				notify: (message) => new Notice(message),
				openNote: async (note) => {
					await this.app.workspace.getLeaf("split").openFile(note);
				},
				getSelection: () => window.getSelection(),
			},
		);

		this.pdf.bus._on("textlayerrendered", this.onTextLayer);
		container.addEventListener("scroll", this.onScroll, { passive: true });
		container.addEventListener("click", this.onClick);
		this.resizeObserver.observe(container);

		await this.session.start();
	}

	/** Still the same file in the same viewer? Opening another PDF in this tab replaces the viewer. */
	isCurrent(): boolean {
		const view = this.leaf.view;
		return (view as { file?: TFile | null }).file?.path === this.file.path && probePdfInternals(view)?.child === this.pdf.child;
	}

	startComment(): void {
		this.session?.startComment();
	}

	highlightSelection(): void {
		void this.session?.highlightSelection();
	}

	async openSidecar(): Promise<void> {
		await this.session?.openSidecar();
	}

	toggleResolved(): void {
		this.session?.toggleResolved();
	}

	get resolvedCount(): number {
		return this.session?.resolvedCount ?? 0;
	}

	get resolvedVisible(): boolean {
		return this.session?.resolvedVisible ?? false;
	}

	async reloadComments(): Promise<void> {
		await this.session?.reload();
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		this.pdf.bus._off("textlayerrendered", this.onTextLayer);
		const container = this.pdf.viewer.container;
		container.removeEventListener("scroll", this.onScroll);
		container.removeEventListener("click", this.onClick);
		this.resizeObserver.disconnect();

		this.session?.destroy();
		this.session = null;

		for (let i = 0; i < this.pdf.viewer.pagesCount; i++) {
			const page = this.pdf.viewer.getPageView(i);
			if (page) clearPage(page);
		}
		this.strip.remove();
		this.overlay.remove();
	}

	// ----- host ---------------------------------------------------------------

	private host(): CommentHost {
		return {
			root: this.pdf.viewer.container,
			blockedReason: () => null,
			buildAnchor: (range) => this.anchorFromRange(range),
			place: (comments) => this.place(comments),
			draftTop: (range) => {
				const container = this.pdf.viewer.container;
				return range.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
			},
			changed: () => {
				/* no toolbar of our own inside the PDF view */
			},
		};
	}

	private anchorFromRange(range: Range): PdfAnchor | null {
		const startPage = pageElementOf(range.startContainer);
		const endPage = pageElementOf(range.endContainer);
		// One page per comment, like one slide per comment.
		if (!startPage || startPage !== endPage) return null;

		const pageNumber = Number(startPage.dataset.pageNumber);
		const page = this.pdf.viewer.getPageView(pageNumber - 1);
		const divs = page && renderedTextDivs(page);
		const items = page?.textLayer?.textLayer?.textContentItems;
		if (!page || !divs || !items) return null;

		const span = rangeToSpan(range, pageNumber, divs);
		if (!span) return null;

		const text = new PdfPageText(pageNumber, items);
		// Seed the cache so the new comment resolves without a second extraction.
		this.texts.set(pageNumber, Promise.resolve(text));
		this.loadedTexts.set(pageNumber, text);
		return buildPdfAnchor(text, span);
	}

	// ----- placing ------------------------------------------------------------

	private place(comments: ScopeComment[]): PlacedComment[] {
		for (let i = 0; i < this.pdf.viewer.pagesCount; i++) {
			const page = this.pdf.viewer.getPageView(i);
			if (page) clearPage(page);
		}

		let missing = false;
		this.placed = comments.map((comment) => {
			if (comment.anchor.kind !== "pdf") return { comment, elements: [], orphaned: true };

			const entry = this.resolved.get(comment.id);
			if (!entry || entry.key !== keyOf(comment.anchor)) {
				missing = true;
				return { comment, elements: [], orphaned: false };
			}
			if (!entry.placement.span) return { comment, elements: [], orphaned: true };
			return { comment, elements: this.draw(comment, entry.placement.span), orphaned: false };
		});

		if (missing) void this.resolveMissing(comments);
		return this.placed;
	}

	/** Resolve every comment without a current placement, then place again. */
	private async resolveMissing(comments: ScopeComment[]): Promise<void> {
		if (this.resolving) return this.resolving;

		this.resolving = (async () => {
			const doc = this.pdf.document();
			const pageCount = this.pdf.viewer.pagesCount;
			for (const comment of comments) {
				if (comment.anchor.kind !== "pdf") continue;
				const key = keyOf(comment.anchor);
				if (this.resolved.get(comment.id)?.key === key) continue;

				let placement: PdfPlacement = { span: null, step: "orphaned" };
				if (doc) {
					try {
						placement = await resolvePdfAnchor(comment.anchor, pageCount, (n) => this.pageText(n));
					} catch (error) {
						console.error("[lectern] could not resolve a PDF comment", error);
					}
				}
				this.resolved.set(comment.id, { key, placement });
			}
		})();

		await this.resolving;
		this.resolving = null;
		if (!this.destroyed) this.session?.place();
	}

	private pageText(n: number): Promise<PdfPageText | null> {
		let cached = this.texts.get(n);
		if (!cached) {
			cached = (async () => {
				const doc = this.pdf.document();
				if (!doc) return null;
				const page = await doc.getPage(n);
				this.pageBoxes.set(n, page.view);
				const content = await page.getTextContent();
				// getTextContent() without marked content gives the same items, in
				// the same order, as the text layer's textContentItems (spike).
				const text = new PdfPageText(
					n,
					content.items.map((item) => ({
						str: item.str ?? "",
						hasEOL: item.hasEOL,
						transform: item.transform,
						height: item.height,
					})),
				);
				this.loadedTexts.set(n, text);
				return text;
			})();
			this.texts.set(n, cached);
		}
		return cached;
	}

	/** Boxes if the page's text layer exists, else a marker at the text's estimated height. */
	private draw(comment: ScopeComment, span: PdfSpan): HTMLElement[] {
		const page = this.pdf.viewer.getPageView(span.page - 1);
		if (!page) return [];

		const boxes = drawBoxes(page, comment.id, span, comment.status === "resolved");
		if (boxes.length > 0) return boxes;

		return [drawMarker(page, comment.id, this.estimateTop(span) ?? 0)];
	}

	private estimateTop(span: PdfSpan): number | null {
		// Only text we already have: place() must stay synchronous. A page's text
		// is always loaded by the time its comment resolved, so this rarely misses.
		const view = this.pageBoxes.get(span.page);
		const text = this.loadedTexts.get(span.page);
		if (!view || !text) return null;
		return text.topFraction(span.startItem, view);
	}

	/** PDF.js just (re)built a page's text layer: swap markers for boxes on that page only. */
	private redrawPage(page: PdfPageView | undefined): void {
		if (!page || this.destroyed) return;

		let changed = false;
		for (const placed of this.placed) {
			const span = this.resolved.get(placed.comment.id)?.placement.span;
			if (!span || span.page !== page.id) continue;
			const fresh = this.draw(placed.comment, span);
			// Mutate in place: the rail holds these same objects, and rebuilding the
			// cards would throw away a comment someone is in the middle of editing.
			placed.elements.splice(0, placed.elements.length, ...fresh);
			changed = true;
		}
		if (changed) this.session?.layout();
	}

	/**
	 * PDF.js evicts pages far from the viewport by emptying their div, which
	 * takes our layer with it and fires no event we can hook. A highlight or
	 * marker that is no longer in the document reads as top 0 and drags its card
	 * to the top of the rail. So on every scroll and resize, redraw anything
	 * that got detached. It's one isConnected check per comment.
	 */
	private redrawDetached(): void {
		if (this.destroyed) return;
		let changed = false;
		for (const placed of this.placed) {
			if (placed.elements.length === 0 || placed.elements[0].isConnected) continue;
			const span = this.resolved.get(placed.comment.id)?.placement.span;
			if (!span) continue;
			placed.elements.splice(0, placed.elements.length, ...this.draw(placed.comment, span));
			changed = true;
		}
		if (changed) this.session?.layout();
	}

	/** Boxes sit under the text layer, so find a click's comment by position. */
	private focusAt(event: MouseEvent): void {
		if (window.getSelection()?.isCollapsed === false) return;
		const boxes = this.pdf.viewer.container.querySelectorAll<HTMLElement>(`.${PDF_BOX_CLASS}`);
		for (const box of Array.from(boxes)) {
			const r = box.getBoundingClientRect();
			if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) {
				if (box.dataset.commentId) this.session?.focus(box.dataset.commentId);
				return;
			}
		}
	}

	/** Narrow the scroller to make room for the rail, then have PDF.js refit to the new width. */
	private reserveStrip(reserved: boolean): void {
		const container = this.pdf.viewer.container;
		container.style.right = reserved ? `${STRIP_WIDTH}px` : this.savedRight;
		this.strip.toggleClass("is-active", reserved);
		this.pdf.child.onResize();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
