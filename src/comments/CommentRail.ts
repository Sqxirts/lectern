import { HIGHLIGHT_CLASS } from "./anchoring";
import type { PlacedComment, ScopeComment } from "./types";

const CARD_GAP = 8;
const MIN_CARD_HEIGHT = 64;
/** Kept in step with --lectern-rail-width in styles.css. */
const RAIL_WIDTH = 260;
const RAIL_MARGIN = 12;
/** .lectern-wrapper padding, and the padding-right `.has-rail` swaps in for it. */
const WRAPPER_PADDING = 16;
const STRIP_WIDTH = RAIL_WIDTH + 32;
/** Wrapper classes whose content is centred by auto margins in styles.css. */
const CENTRED_CLASSES = ["lectern-pptx-active", "lectern-docx-active"];

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
			this.railEl = beside.strip.createDiv({ cls: "lectern-rail is-beside" });
			// createSvg adds `cls` as one classList token, so a space-separated string throws; pass an array.
			this.connectorEl = beside.overlay.createSvg("svg", { cls: ["lectern-connectors", "is-beside"] });
		} else {
			this.railEl = wrapper.createDiv({ cls: "lectern-rail" });
			this.connectorEl = wrapper.createSvg("svg", { cls: "lectern-connectors" });
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

		const card = this.railEl.createDiv({ cls: "lectern-card is-draft" });
		card.createDiv({ cls: "lectern-card-meta", text: "New comment" });

		const input = card.createEl("textarea", { cls: "lectern-card-input" });
		input.placeholder = "Write your comment";

		const actions = card.createDiv({ cls: "lectern-card-actions" });
		const save = actions.createEl("button", { text: "Save", cls: "mod-cta" });
		const cancel = actions.createEl("button", { text: "Cancel" });

		const onSave = async (): Promise<void> => {
			const body = input.value.trim();
			if (!body) {
				input.focus();
				return;
			}
			// Disabled until the write lands; Ctrl+Enter goes through save.click(),
			// which a disabled button ignores, so it is covered too.
			save.disabled = true;
			try {
				await this.delegate.commitDraft(body);
			} finally {
				save.disabled = false;
			}
		};
		save.addEventListener("click", () => void onSave());

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
			this.wrapper.toggleClass("has-rail", wanted && this.needsStrip());
			return;
		}
		if (wanted !== this.reserved) {
			this.reserved = wanted;
			this.beside.onReserve(wanted);
		}
	}

	/**
	 * Whether centred slides or pages must shift left to keep the cards off them.
	 *
	 * Reserving the strip always pushed the slides left of centre even when the
	 * margins around a centred slide already had room for the cards. Now:
	 * - the right margin of a centred slide fits the rail: no strip, stay centred;
	 * - it doesn't, but slide + strip fit side by side: reserve, the slide centres
	 *   in what is left;
	 * - not even that: no strip, stay centred, and the cards sit over the slide's
	 *   right edge, which a strip could not have avoided anyway.
	 * Content that is not centred (code) keeps the strip whenever there are cards.
	 * Every input here ignores `has-rail` itself (clientWidth includes padding),
	 * so toggling the class cannot feed back into the decision.
	 */
	private needsStrip(): boolean {
		const sizer = this.content.parentElement;
		const centred = CENTRED_CLASSES.some((c) => this.wrapper.hasClass(c));
		if (!sizer || !centred) return true;

		const pane = this.wrapper.clientWidth - 2 * WRAPPER_PADDING;
		const page = sizer.offsetWidth;
		const sideMargin = (pane - page) / 2;
		if (sideMargin >= RAIL_WIDTH + RAIL_MARGIN * 2 - WRAPPER_PADDING) return false;
		return pane - page >= STRIP_WIDTH - WRAPPER_PADDING;
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
		const card = this.railEl.createDiv({ cls: "lectern-card" });
		card.dataset.commentId = comment.id;
		card.toggleClass("is-resolved", comment.status === "resolved");
		card.toggleClass("is-orphaned", placed.orphaned);

		// No body means a highlight with no note; Edit turns it into a comment.
		const highlightOnly = comment.body.trim() === "";
		card.toggleClass("is-highlight", highlightOnly);

		const meta = card.createDiv({ cls: "lectern-card-meta" });
		meta.createSpan({ text: highlightOnly ? `Highlight ${comment.created}`.trim() : comment.created || "" });
		if (placed.orphaned) {
			meta.createSpan({
				cls: "lectern-badge",
				text: "orphaned",
				attr: { title: "The text this comment pointed at is no longer in the file. The comment is kept, but it has nowhere to attach." },
			});
		}
		if (comment.status === "resolved") {
			meta.createSpan({ cls: "lectern-badge is-resolved", text: "resolved" });
		}

		const body = card.createDiv({ cls: "lectern-card-body", text: comment.body });

		const actions = card.createDiv({ cls: "lectern-card-actions" });

		const edit = actions.createEl("button", { text: highlightOnly ? "Add note" : "Edit" });
		edit.addEventListener("click", () => this.startEdit(card, body, comment));

		const resolve = actions.createEl("button", {
			text: comment.status === "resolved" ? "Reopen" : "Resolve",
		});
		resolve.addEventListener("click", () => {
			void this.delegate.setStatus(comment.id, comment.status === "resolved" ? "open" : "resolved");
		});

		const remove = actions.createEl("button", { cls: "mod-warning", text: "Delete" });
		remove.addEventListener("click", () => {
			void this.delegate.deleteComment(comment.id);
		});

		card.addEventListener("click", (event) => {
			if ((event.target as HTMLElement).tagName === "BUTTON") return;
			this.focus(comment.id, true);
		});

		return card;
	}

	private startEdit(card: HTMLElement, bodyEl: HTMLElement, comment: ScopeComment): void {
		bodyEl.empty();
		const input = bodyEl.createEl("textarea", { cls: "lectern-card-input" });
		input.value = comment.body;

		const commit = async () => {
			await this.delegate.saveBody(comment.id, input.value.trim());
		};

		input.addEventListener("blur", () => void commit());
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
		// Pane width and zoom both change whether the strip is needed.
		if (!this.beside) this.reserveSpace();
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
		// Both ends in the wrapper's scroll coordinates, which is where the SVG sits.
		// The card end used to be card.offsetLeft/offsetTop, but a card's offset
		// parent is the rail, so x came out near 0 and every line ran to the
		// left edge of the pane instead of to its card.
		const wrapperBox = this.wrapper.getBoundingClientRect();
		const toLocal = (x: number, y: number) => ({
			x: x - wrapperBox.left + this.wrapper.scrollLeft,
			y: y - wrapperBox.top + this.wrapper.scrollTop,
		});

		this.connectorEl.empty();
		this.connectorEl.setAttribute("width", String(this.wrapper.scrollWidth));
		this.connectorEl.setAttribute("height", String(this.wrapper.scrollHeight));

		for (const placed of this.visible()) {
			const card = this.cards.get(placed.comment.id);
			const target = placed.elements[0];
			if (!card || !target) continue;

			const t = target.getBoundingClientRect();
			const midY = t.top + t.height / 2;
			// Where the card is going, not where it is: `top` animates (0.15s), so
			// its live box during a relayout is the old spot, and nothing redraws
			// when the transition ends.
			const cardLeft = this.railEl.offsetLeft + card.offsetLeft;
			const cardTop = this.railEl.offsetTop + parseFloat(card.style.top || "0") + 14;
			const hl = { left: toLocal(t.left, midY), right: toLocal(t.right, midY) };
			let from, to;
			if (cardLeft >= hl.right.x) {
				from = hl.right;
				to = { x: cardLeft, y: cardTop };
			} else if (cardLeft + card.offsetWidth <= hl.left.x) {
				// Card left of the highlight: join the near edges, still pointing at the card.
				from = hl.left;
				to = { x: cardLeft + card.offsetWidth, y: cardTop };
			} else {
				// The card sits over the highlight (narrow pane); a line would only
				// cross the card. Clicking either one still flashes the other.
				continue;
			}

			const line = this.connectorEl.createSvg("path");
			line.classList.add("lectern-connector");
			// A shallow S-curve reads as a link without drawing attention to itself.
			const midX = from.x + (to.x - from.x) / 2;
			line.setAttribute("d", `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`);
			if (placed.comment.id === this.focusedId) line.classList.add("is-focused");
		}
	}

	/** Connectors in overlay coordinates, from each highlight's right edge to its card. */
	private drawConnectorsBeside(): void {
		const overlay = this.beside!.overlay.getBoundingClientRect();
		const scroller = this.wrapper.getBoundingClientRect();
		// The rail's own box already includes the scroll transform from pin().
		const rail = this.railEl.getBoundingClientRect();

		this.connectorEl.empty();
		this.connectorEl.setAttribute("width", String(overlay.width));
		this.connectorEl.setAttribute("height", String(overlay.height));

		for (const placed of this.visible()) {
			const card = this.cards.get(placed.comment.id);
			const target = placed.elements[0];
			if (!card || !target?.isConnected) continue;

			const t = target.getBoundingClientRect();
			// Skip lines whose highlight has scrolled out of the scroller.
			if (t.bottom < scroller.top || t.top > scroller.bottom) continue;

			const fromX = Math.min(t.right, scroller.right) - overlay.left;
			const fromY = t.top - overlay.top + t.height / 2;
			// Where the card is going, not where it is. `top` animates for 0.15s,
			// so after a zoom the live box is still the old spot, and nothing
			// redraws when the transition ends: every line pointed at empty space.
			const toX = rail.left + card.offsetLeft - overlay.left;
			const toY = rail.top + parseFloat(card.style.top || "0") - overlay.top + 14;

			const line = this.connectorEl.createSvg("path");
			line.classList.add("lectern-connector");
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
