import { HIGHLIGHT_CLASS } from "./anchoring";
import type { PlacedComment, ScopeComment } from "./types";

const CARD_GAP = 8;
const MIN_CARD_HEIGHT = 64;
/** Kept in step with --vault-scope-rail-width in styles.css. */
const RAIL_WIDTH = 260;
const RAIL_MARGIN = 12;

export interface RailDelegate {
	saveBody(id: string, body: string): Promise<void>;
	setStatus(id: string, status: "open" | "resolved"): Promise<void>;
	deleteComment(id: string): Promise<void>;
	/** Called when the user commits the draft card. */
	commitDraft(body: string): Promise<void>;
	cancelDraft(): void;
}

/**
 * Where the rail goes when it cannot live inside the scroller.
 *
 * Obsidian's PDF viewer fits pages to its scroller's width and ignores padding,
 * so the rail cannot reserve a strip inside it the way `.has-rail` does. The
 * PDF controller narrows the scroller instead and hands the rail a strip beside
 * it. The rail follows the scroller by translating, and connectors are drawn on
 * an overlay spanning both, in viewport terms, redrawn on every scroll.
 */
export interface RailBeside {
	/** Fixed strip to the right of the scroller, top-aligned with it. */
	strip: HTMLElement;
	/** Positioned element covering scroller and strip, for connector lines. */
	overlay: HTMLElement;
	/** The rail wants (true) or no longer wants (false) its strip. */
	onReserve(reserved: boolean): void;
}

/**
 * The right-hand margin, the way Word does it: one card per comment, sitting
 * level with the text it points at, joined by a thin connector.
 *
 * Cards are absolutely positioned inside the scrolling wrapper, so they scroll
 * with the document instead of floating over it.
 */
export class CommentRail {
	private wrapper: HTMLElement;
	private content: HTMLElement;
	private delegate: RailDelegate;

	private railEl: HTMLElement;
	private connectorEl: SVGSVGElement;

	private placed: PlacedComment[] = [];
	private cards = new Map<string, HTMLElement>();
	private draftEl: HTMLElement | null = null;
	private draftTop = 0;
	private showResolved: boolean;
	private focusedId: string | null = null;
	private beside: RailBeside | null;
	private reserved = false;

	constructor(
		wrapper: HTMLElement,
		content: HTMLElement,
		delegate: RailDelegate,
		showResolved: boolean,
		beside: RailBeside | null = null,
	) {
		this.wrapper = wrapper;
		this.content = content;
		this.delegate = delegate;
		this.showResolved = showResolved;
		this.beside = beside;

		if (beside) {
			this.railEl = beside.strip.createDiv({ cls: "vault-scope-rail is-beside" });
			// createSvg adds `cls` as one classList token, so a space-separated string throws; pass an array.
			this.connectorEl = beside.overlay.createSvg("svg", { cls: ["vault-scope-connectors", "is-beside"] }) as SVGSVGElement;
		} else {
			this.railEl = wrapper.createDiv({ cls: "vault-scope-rail" });
			this.connectorEl = wrapper.createSvg("svg", { cls: "vault-scope-connectors" }) as SVGSVGElement;
		}

		// Clicking a highlight brings its card forward.
		this.content.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			const highlight = target?.closest(`.${HIGHLIGHT_CLASS}`) as HTMLElement | null;
			if (highlight?.dataset.commentId) this.focus(highlight.dataset.commentId);
		});
	}

	setShowResolved(value: boolean): void {
		this.showResolved = value;
		this.render();
	}

	get resolvedVisible(): boolean {
		return this.showResolved;
	}

	setComments(placed: PlacedComment[]): void {
		this.placed = placed;
		this.render();
	}

	/** Open an empty card for a selection that has not been saved yet. */
	openDraft(topOffset: number): void {
		this.closeDraft();
		this.draftTop = topOffset;

		const card = this.railEl.createDiv({ cls: "vault-scope-card is-draft" });
		card.createDiv({ cls: "vault-scope-card-meta", text: "New comment" });

		const input = card.createEl("textarea", { cls: "vault-scope-card-input" });
		input.placeholder = "Write your comment";

		const actions = card.createDiv({ cls: "vault-scope-card-actions" });
		const save = actions.createEl("button", { text: "Save", cls: "mod-cta" });
		const cancel = actions.createEl("button", { text: "Cancel" });

		save.addEventListener("click", async () => {
			const body = input.value.trim();
			if (!body) {
				input.focus();
				return;
			}
			await this.delegate.commitDraft(body);
		});

		cancel.addEventListener("click", () => {
			this.delegate.cancelDraft();
		});

		input.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.delegate.cancelDraft();
			}
			// Ctrl/Cmd+Enter saves, plain Enter keeps making new lines.
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				save.click();
			}
		});

		this.draftEl = card;
		this.reserveSpace();
		this.layout();
		input.focus();
	}

	closeDraft(): void {
		this.draftEl?.remove();
		this.draftEl = null;
		this.reserveSpace();
	}

	/**
	 * Hold the right-hand strip for the rail only while it shows something.
	 * Reserving it always left every slide off to the left of an empty strip
	 * on files with no comments, which is most of them.
	 */
	private reserveSpace(): void {
		const wanted = this.visible().length > 0 || this.draftEl !== null;
		if (!this.beside) {
			this.wrapper.toggleClass("has-rail", wanted);
			return;
		}
		if (wanted !== this.reserved) {
			this.reserved = wanted;
			this.beside.onReserve(wanted);
		}
	}

	private visible(): PlacedComment[] {
		return this.placed.filter((p) => this.showResolved || p.comment.status === "open");
	}

	private render(): void {
		this.railEl.empty();
		this.cards.clear();

		for (const placed of this.visible()) {
			this.cards.set(placed.comment.id, this.buildCard(placed));
		}

		if (this.draftEl) this.railEl.appendChild(this.draftEl);
		this.reserveSpace();
		this.layout();
	}

	private buildCard(placed: PlacedComment): HTMLElement {
		const { comment } = placed;
		const card = this.railEl.createDiv({ cls: "vault-scope-card" });
		card.dataset.commentId = comment.id;
		card.toggleClass("is-resolved", comment.status === "resolved");
		card.toggleClass("is-orphaned", placed.orphaned);

		const meta = card.createDiv({ cls: "vault-scope-card-meta" });
		meta.createSpan({ text: comment.created || "" });
		if (placed.orphaned) {
			meta.createSpan({
				cls: "vault-scope-badge",
				text: "orphaned",
				attr: { title: "The text this comment pointed at is no longer in the file. The comment is kept, but it has nowhere to attach." },
			});
		}
		if (comment.status === "resolved") {
			meta.createSpan({ cls: "vault-scope-badge is-resolved", text: "resolved" });
		}

		const body = card.createDiv({ cls: "vault-scope-card-body", text: comment.body });

		const actions = card.createDiv({ cls: "vault-scope-card-actions" });

		const edit = actions.createEl("button", { text: "Edit" });
		edit.addEventListener("click", () => this.startEdit(card, body, comment));

		const resolve = actions.createEl("button", {
			text: comment.status === "resolved" ? "Reopen" : "Resolve",
		});
		resolve.addEventListener("click", async () => {
			await this.delegate.setStatus(comment.id, comment.status === "resolved" ? "open" : "resolved");
		});

		const remove = actions.createEl("button", { cls: "mod-warning", text: "Delete" });
		remove.addEventListener("click", async () => {
			await this.delegate.deleteComment(comment.id);
		});

		card.addEventListener("click", (event) => {
			if ((event.target as HTMLElement).tagName === "BUTTON") return;
			this.focus(comment.id, true);
		});

		return card;
	}

	private startEdit(card: HTMLElement, bodyEl: HTMLElement, comment: ScopeComment): void {
		bodyEl.empty();
		const input = bodyEl.createEl("textarea", { cls: "vault-scope-card-input" });
		input.value = comment.body;

		const commit = async () => {
			await this.delegate.saveBody(comment.id, input.value.trim());
		};

		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				void commit();
			}
		});
		input.focus();
		this.layout();
	}

	/** Scroll a comment's highlight into view and flash it. */
	focus(id: string, fromCard = false): void {
		this.focusedId = id;

		for (const [cardId, card] of this.cards) {
			card.toggleClass("is-focused", cardId === id);
		}

		const placed = this.placed.find((p) => p.comment.id === id);
		const first = placed?.elements[0];

		if (this.beside) {
			// The strip is overflow-hidden and positioned by transform, so
			// scrolling a card into view would knock it out of line. Scroll the
			// document to the highlight instead; the card follows it.
			first?.scrollIntoView({ block: "center", behavior: "smooth" });
		} else if (first && !fromCard) {
			this.cards.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		} else if (first) {
			first.scrollIntoView({ block: "center", behavior: "smooth" });
		}

		for (const el of placed?.elements ?? []) {
			el.addClass("is-flashing");
			window.setTimeout(() => el.removeClass("is-flashing"), 900);
		}

		this.drawConnectors();
	}

	/**
	 * Place every card level with its highlight, then push overlapping cards
	 * down so they stack instead of covering each other.
	 */
	/**
	 * The rail lives inside the scrolling wrapper so it shares a coordinate
	 * space with the highlights, which is what makes the connectors possible.
	 * The cost is that it would scroll off sideways on a wide document, so its
	 * left edge is re-pinned to the right of the viewport on every scroll.
	 */
	private pin(): void {
		if (this.beside) {
			this.railEl.style.transform = `translateY(${-this.wrapper.scrollTop}px)`;
			return;
		}
		const left = this.wrapper.scrollLeft + this.wrapper.clientWidth - RAIL_WIDTH - RAIL_MARGIN;
		this.railEl.style.left = `${Math.max(RAIL_MARGIN, left)}px`;
	}

	/** Cheap path for scroll events: re-pin only, skip the full relayout. */
	onScroll(): void {
		this.pin();
		// Beside the scroller the connectors live on a fixed overlay, so they move on scroll.
		if (this.beside) this.drawConnectors();
	}

	layout(): void {
		const wrapperBox = this.wrapper.getBoundingClientRect();
		const scrollTop = this.wrapper.scrollTop;

		this.pin();
		this.railEl.style.height = `${this.wrapper.scrollHeight}px`;

		const entries: { el: HTMLElement; desired: number }[] = [];

		for (const placed of this.visible()) {
			const card = this.cards.get(placed.comment.id);
			if (!card) continue;

			const target = placed.elements[0];
			const desired = target
				? target.getBoundingClientRect().top - wrapperBox.top + scrollTop
				: 0;
			entries.push({ el: card, desired });
		}

		if (this.draftEl) entries.push({ el: this.draftEl, desired: this.draftTop });

		entries.sort((a, b) => a.desired - b.desired);

		let cursor = 0;
		for (const entry of entries) {
			const top = Math.max(entry.desired, cursor);
			entry.el.style.top = `${top}px`;
			const height = Math.max(entry.el.offsetHeight, MIN_CARD_HEIGHT);
			cursor = top + height + CARD_GAP;
		}

		this.drawConnectors();
	}

	private drawConnectors(): void {
		if (this.beside) {
			this.drawConnectorsBeside();
			return;
		}
		const wrapperBox = this.wrapper.getBoundingClientRect();
		const scrollTop = this.wrapper.scrollTop;

		this.connectorEl.empty();
		this.connectorEl.setAttribute("width", String(this.wrapper.scrollWidth));
		this.connectorEl.setAttribute("height", String(this.wrapper.scrollHeight));

		for (const placed of this.visible()) {
			const card = this.cards.get(placed.comment.id);
			const target = placed.elements[0];
			if (!card || !target) continue;

			const targetBox = target.getBoundingClientRect();
			const fromX = targetBox.right - wrapperBox.left;
			const fromY = targetBox.top - wrapperBox.top + scrollTop + targetBox.height / 2;
			const toX = card.offsetLeft;
			const toY = card.offsetTop + 14;

			const line = this.connectorEl.createSvg("path");
			line.classList.add("vault-scope-connector");
			// A shallow S-curve reads as a link without drawing attention to itself.
			const midX = fromX + (toX - fromX) / 2;
			line.setAttribute("d", `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`);
			if (placed.comment.id === this.focusedId) line.classList.add("is-focused");
		}
	}

	/** Connectors in overlay coordinates, from each highlight's right edge to its card. */
	private drawConnectorsBeside(): void {
		const overlay = this.beside!.overlay.getBoundingClientRect();
		const scroller = this.wrapper.getBoundingClientRect();

		this.connectorEl.empty();
		this.connectorEl.setAttribute("width", String(overlay.width));
		this.connectorEl.setAttribute("height", String(overlay.height));

		for (const placed of this.visible()) {
			const card = this.cards.get(placed.comment.id);
			const target = placed.elements[0];
			if (!card || !target?.isConnected) continue;

			const t = target.getBoundingClientRect();
			const c = card.getBoundingClientRect();
			// Skip lines whose highlight has scrolled out of the scroller.
			if (t.bottom < scroller.top || t.top > scroller.bottom) continue;

			const fromX = Math.min(t.right, scroller.right) - overlay.left;
			const fromY = t.top - overlay.top + t.height / 2;
			const toX = c.left - overlay.left;
			const toY = c.top - overlay.top + 14;

			const line = this.connectorEl.createSvg("path");
			line.classList.add("vault-scope-connector");
			const midX = fromX + (toX - fromX) / 2;
			line.setAttribute("d", `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`);
			if (placed.comment.id === this.focusedId) line.classList.add("is-focused");
		}
	}

	destroy(): void {
		if (this.beside && this.reserved) this.beside.onReserve(false);
		this.reserved = false;
		this.wrapper.removeClass("has-rail");
		this.railEl.remove();
		this.connectorEl.remove();
	}
}
