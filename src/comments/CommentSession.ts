import type { RailDelegate } from "./CommentRail";
import { newCommentId, nowStamp, type Anchor, type CommentStatus, type PlacedComment, type ScopeComment } from "./types";

/**
 * The comment workflow for one open file: load the sidecar, place comments,
 * turn a selection into a draft, and save, edit, resolve or delete.
 *
 * Shared by every view that shows comments. LecternView is the first; the PDF
 * controller will be the second. What differs between them (how a selection
 * becomes an anchor, how an anchor is drawn) comes in through CommentHost.
 *
 * Deliberately free of Obsidian imports. The `obsidian` package ships types
 * only, so anything importing it at runtime cannot run under vitest. The store,
 * rail and notices are injected instead, which is also what lets the tests use
 * fakes.
 */

/** What the session needs from the view that hosts it. */
export interface CommentHost {
	/** The rendered document. A selection has to start and end inside it. */
	readonly root: HTMLElement;
	/** A reason commenting is off right now (e.g. a code file in edit mode), or null. */
	blockedReason(): string | null;
	/** Turn a live selection into a stored anchor, or null if it cannot be anchored. */
	buildAnchor(range: Range): Anchor | null;
	/** Clear old highlights, then find and highlight every comment. */
	place(comments: ScopeComment[]): PlacedComment[];
	/** Where a draft card for this selection should sit, in rail coordinates. */
	draftTop(range: Range): number;
	/** Comment counts changed; the toolbar shows them. */
	changed(): void;
}

/** The parts of CommentStore the session uses. */
export interface CommentStoreLike<F = unknown> {
	readonly comments: ScopeComment[];
	load(): Promise<ScopeComment[]>;
	add(comment: ScopeComment): Promise<void>;
	update(id: string, changes: Partial<Pick<ScopeComment, "body" | "status">>): Promise<void>;
	remove(id: string): Promise<void>;
	sidecarFile(): F | null;
}

/** The parts of CommentRail the session drives. */
export interface CommentRailLike {
	setComments(placed: PlacedComment[]): void;
	openDraft(topOffset: number): void;
	closeDraft(): void;
	layout(): void;
	onScroll(): void;
	focus(id: string): void;
	/** Show or hide resolved comments in this view only. */
	setShowResolved(value: boolean): void;
	readonly resolvedVisible: boolean;
	destroy(): void;
}

export interface SessionServices<F = unknown> {
	notify(message: string): void;
	/** Open the sidecar note, e.g. in a split. */
	openNote(file: F): Promise<void>;
	/** Injected so tests can hand in a selection without a real window. */
	getSelection(): Selection | null;
}

export class CommentSession<F = unknown> implements RailDelegate {
	private host: CommentHost;
	private store: CommentStoreLike<F>;
	private services: SessionServices<F>;
	private makeRail: (delegate: RailDelegate) => CommentRailLike;

	private rail: CommentRailLike | null = null;
	private draftAnchor: Anchor | null = null;
	private destroyed = false;

	constructor(
		host: CommentHost,
		store: CommentStoreLike<F>,
		makeRail: (delegate: RailDelegate) => CommentRailLike,
		services: SessionServices<F>,
	) {
		this.host = host;
		this.store = store;
		this.makeRail = makeRail;
		this.services = services;
	}

	/** Read the sidecar, build the rail, and place what was there. */
	async start(): Promise<void> {
		await this.store.load();
		// Torn down while the sidecar was loading (the user switched files):
		// building a rail now would attach it to whatever the view shows next.
		if (this.destroyed) return;
		this.rail = this.makeRail(this);
		this.place();
	}

	get openCount(): number {
		return this.store.comments.filter((c) => c.status === "open").length;
	}

	get total(): number {
		return this.store.comments.length;
	}

	get resolvedCount(): number {
		return this.store.comments.filter((c) => c.status === "resolved").length;
	}

	get resolvedVisible(): boolean {
		return this.rail?.resolvedVisible ?? false;
	}

	/**
	 * Show or hide resolved comments for this file. Without this, a resolved
	 * comment left the margin with no way back short of the settings tab and a
	 * reopen. Showing them is also how a resolved comment gets reopened.
	 */
	toggleResolved(): void {
		if (!this.rail) return;
		if (!this.rail.resolvedVisible && this.resolvedCount === 0) {
			this.services.notify("No resolved comments on this file.");
			return;
		}
		this.rail.setShowResolved(!this.rail.resolvedVisible);
		this.host.changed();
	}

	/** Re-resolve every anchor against the current DOM and redraw the rail. */
	place(): void {
		if (!this.rail) return;
		this.rail.setComments(this.host.place(this.store.comments));
	}

	layout(): void {
		this.rail?.layout();
	}

	onScroll(): void {
		this.rail?.onScroll();
	}

	/** Bring a comment's card forward, e.g. when its highlight is clicked. */
	focus(id: string): void {
		this.rail?.focus(id);
	}

	/**
	 * Turn the live selection into an anchor, or tell the user why it can't be.
	 * Shared by comments and highlights, which differ only in what happens next.
	 */
	private anchorFromSelection(action: string): { anchor: Anchor; range: Range } | null {
		const blocked = this.host.blockedReason();
		if (blocked) {
			this.services.notify(blocked);
			return null;
		}

		const selection = this.services.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
			this.services.notify(`Select some text first, then ${action}.`);
			return null;
		}

		const range = selection.getRangeAt(0);
		if (!this.host.root.contains(range.commonAncestorContainer)) {
			this.services.notify("Select text inside the document.");
			return null;
		}

		const anchor = this.host.buildAnchor(range);
		if (!anchor) {
			this.services.notify("That selection cannot be anchored. Try selecting inside a single slide, page, or line.");
			return null;
		}
		return { anchor, range };
	}

	/** Start a comment from whatever is selected right now. */
	startComment(): void {
		if (!this.rail) return;
		const found = this.anchorFromSelection("add a comment");
		if (!found) return;

		this.draftAnchor = found.anchor;
		this.rail.openDraft(this.host.draftTop(found.range));
	}

	/**
	 * Highlight the selection with no note. It is stored as a comment with an
	 * empty body, so the sidecar format is unchanged and a note can be added to
	 * it later with Edit.
	 */
	async highlightSelection(): Promise<void> {
		if (!this.rail) return;
		const found = this.anchorFromSelection("highlight it");
		if (!found) return;

		try {
			await this.store.add({
				id: newCommentId(),
				anchor: found.anchor,
				status: "open",
				created: nowStamp(),
				body: "",
			});
		} catch (error) {
			this.services.notify("Could not save the highlight. Try again.");
			console.error("[lectern] highlight save failed", error);
			return;
		}

		this.services.getSelection()?.removeAllRanges();
		this.place();
		this.host.changed();
	}

	async commitDraft(body: string): Promise<void> {
		// Take the anchor before the write, not after: a second Save or
		// Ctrl+Enter during a slow write found it still set and added the
		// comment twice.
		const anchor = this.draftAnchor;
		if (!anchor) return;
		this.draftAnchor = null;

		try {
			await this.store.add({
				id: newCommentId(),
				anchor,
				status: "open",
				created: nowStamp(),
				body,
			});
		} catch (error) {
			// Leave the draft open so the text isn't lost, and let Save retry.
			if (!this.destroyed) this.draftAnchor = anchor;
			this.services.notify("Could not save the comment. Try again.");
			console.error("[lectern] comment save failed", error);
			return;
		}

		this.rail?.closeDraft();
		this.services.getSelection()?.removeAllRanges();
		this.place();
		this.host.changed();
	}

	cancelDraft(): void {
		this.draftAnchor = null;
		this.rail?.closeDraft();
		this.rail?.layout();
	}

	async saveBody(id: string, body: string): Promise<void> {
		await this.store.update(id, { body });
		this.place();
	}

	async setStatus(id: string, status: CommentStatus): Promise<void> {
		await this.store.update(id, { status });
		this.place();
		this.host.changed();
	}

	async deleteComment(id: string): Promise<void> {
		await this.store.remove(id);
		this.place();
		this.host.changed();
	}

	/** Open the markdown sidecar holding these comments. */
	async openSidecar(): Promise<void> {
		const file = this.store.sidecarFile();
		if (!file) {
			this.services.notify("No comments on this file yet.");
			return;
		}
		await this.services.openNote(file);
	}

	/** Reload comments from disk, for when the sidecar was edited by hand. */
	async reload(): Promise<void> {
		await this.store.load();
		this.place();
		this.services.notify("Comments reloaded.");
	}

	destroy(): void {
		this.destroyed = true;
		this.rail?.destroy();
		this.rail = null;
		this.draftAnchor = null;
	}
}
