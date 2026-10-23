import { Platform, setIcon, setTooltip } from "obsidian";
import { collectText, findMatches, rangeFor } from "./findText";

/** Names used by the ::highlight() rules in styles.css. */
const HIGHLIGHT_ALL = "lectern-find";
const HIGHLIGHT_CURRENT = "lectern-find-current";

/** Chrome inside the content that isn't part of the document. */
const SKIP = ".lectern-code-ln, .lectern-xlsx-tabs, .lectern-binary-warning, .lectern-editor-gutter";

const MAX_MATCHES = 5000;
const DEBOUNCE_MS = 120;

export interface FindHooks {
	/** Make the node visible before scrolling to it, e.g. switch to the sheet that holds it. */
	reveal(node: Node): void;
	/** Why searching is unavailable right now, or null. */
	blockedReason(): string | null;
	/** The bar opened or closed, so the toolbar's Find button can follow. */
	changed(): void;
}

/**
 * The find bar for one Lectern view: input, match count, previous/next,
 * match case, close.
 *
 * Matches paint through CSS.highlights, which is shared by every tab in a
 * window. Each controller adds and removes only its own ranges from the
 * shared Highlight objects, so two Lectern tabs searching at once don't
 * wipe each other.
 */
export class FindController {
	private bar: HTMLElement;
	private input: HTMLInputElement;
	private countEl: HTMLElement;
	private caseButton: HTMLButtonElement;

	private matches: Range[] = [];
	private current = -1;
	private matchCase = false;
	private truncated = false;

	private painted: Range[] = [];
	private paintedCurrent: Range | null = null;

	private observer: MutationObserver;
	private timer: number | null = null;

	constructor(
		host: HTMLElement,
		private root: HTMLElement,
		private scroller: HTMLElement,
		private hooks: FindHooks,
	) {
		this.bar = host.createDiv({ cls: "lectern-find" });

		this.input = this.bar.createEl("input", {
			cls: "lectern-find-input",
			type: "text",
			attr: { placeholder: "Find in file", spellcheck: "false" },
		});
		this.input.addEventListener("input", () => this.schedule(false));
		this.input.addEventListener("keydown", this.onKeyDown);

		this.countEl = this.bar.createDiv({ cls: "lectern-find-count" });

		this.caseButton = this.button("Match case", () => {
			this.matchCase = !this.matchCase;
			this.caseButton.toggleClass("is-active", this.matchCase);
			this.search(false);
		});
		this.caseButton.setText("Aa");

		setIcon(this.button("Previous match (Shift+Enter)", () => this.step(-1)), "arrow-up");
		setIcon(this.button("Next match (Enter)", () => this.step(1)), "arrow-down");
		setIcon(this.button("Close (Esc)", () => this.close()), "x");

		// Comments wrap and unwrap spans whenever they re-place, and the code
		// view redraws on edit and save. Either one detaches the text nodes our
		// ranges point into, so search again, keeping the user's place.
		this.observer = new MutationObserver(() => this.schedule(true));
	}

	get isOpen(): boolean {
		return this.bar.hasClass("is-open");
	}

	/** Open the bar, or refocus it, seeded with a short selection if there is one. */
	open(): void {
		const seed = this.selectedText();
		if (seed) this.input.value = seed;

		if (!this.isOpen) {
			this.bar.addClass("is-open");
			this.observer.observe(this.root, { childList: true, subtree: true, characterData: true });
			this.hooks.changed();
		}
		this.input.focus();
		this.input.select();
		this.search(false);
	}

	close(): void {
		if (!this.isOpen) return;
		this.bar.removeClass("is-open");
		this.observer.disconnect();
		this.cancelTimer();
		this.matches = [];
		this.current = -1;
		this.paint();
		this.hooks.changed();
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else this.open();
	}

	destroy(): void {
		this.close();
		this.observer.disconnect();
		this.cancelTimer();
	}

	// ----- searching ------------------------------------------------------

	private schedule(keepPlace: boolean): void {
		if (!this.isOpen) return;
		this.cancelTimer();
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.search(keepPlace);
		}, DEBOUNCE_MS);
	}

	private cancelTimer(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}

	private search(keepPlace: boolean): void {
		const previous = this.current;
		this.matches = [];
		this.current = -1;
		this.truncated = false;

		const blocked = this.hooks.blockedReason();
		const query = this.input.value;
		if (blocked || !query.trim()) {
			this.paint();
			this.countEl.setText(blocked ?? "");
			return;
		}

		const map = collectText(this.root, SKIP);
		const found = findMatches(map.text, query, { matchCase: this.matchCase, limit: MAX_MATCHES });
		this.truncated = found.length >= MAX_MATCHES;
		for (const match of found) {
			const range = rangeFor(map, match);
			if (range) this.matches.push(range);
		}

		if (this.matches.length === 0) {
			this.paint();
			this.countEl.setText("No results");
			return;
		}

		// A re-search after the DOM changed keeps the same match number, so
		// the view doesn't jump. A new query starts at the first match on
		// screen, not the top of the file.
		this.current = keepPlace && previous >= 0 ? Math.min(previous, this.matches.length - 1) : this.firstOnScreen();
		this.paint();
		if (!keepPlace) this.scrollToCurrent();
	}

	private step(direction: 1 | -1): void {
		if (this.matches.length === 0) {
			this.search(false);
			return;
		}
		this.current = (this.current + direction + this.matches.length) % this.matches.length;
		this.paint();
		this.scrollToCurrent();
	}

	/** The first match at or below the top of the visible area, else the first match. */
	private firstOnScreen(): number {
		const top = this.scroller.getBoundingClientRect().top;
		const index = this.matches.findIndex((range) => {
			const box = range.getBoundingClientRect();
			// Matches on a hidden sheet measure as an empty box at 0,0.
			return (box.width > 0 || box.height > 0) && box.top >= top;
		});
		return index >= 0 ? index : 0;
	}

	private scrollToCurrent(): void {
		const range = this.matches[this.current];
		if (!range) return;
		this.hooks.reveal(range.startContainer);

		// The content is scaled with a transform, and client rects already
		// include it, so these numbers are in screen pixels at any zoom.
		const box = range.getBoundingClientRect();
		const view = this.scroller.getBoundingClientRect();
		const margin = 40;
		if (box.top < view.top + margin || box.bottom > view.bottom - margin) {
			this.scroller.scrollTop += box.top - view.top - this.scroller.clientHeight / 3;
		}
		if (box.left < view.left || box.right > view.right) {
			this.scroller.scrollLeft += box.left - view.left - this.scroller.clientWidth / 3;
		}
	}

	// ----- painting -------------------------------------------------------

	private paint(): void {
		const all = this.registry(HIGHLIGHT_ALL, 0);
		const current = this.registry(HIGHLIGHT_CURRENT, 1);

		if (all) {
			for (const range of this.painted) all.delete(range);
			for (const range of this.matches) all.add(range);
		}
		this.painted = this.matches.slice();

		if (current) {
			if (this.paintedCurrent) current.delete(this.paintedCurrent);
			this.paintedCurrent = this.matches[this.current] ?? null;
			if (this.paintedCurrent) current.add(this.paintedCurrent);
		}

		if (this.matches.length > 0) {
			const total = `${this.matches.length}${this.truncated ? "+" : ""}`;
			this.countEl.setText(`${this.current + 1} of ${total}`);
		}
	}

	/**
	 * The shared Highlight for `name` in this view's window. Popout windows
	 * have their own document and their own registry, so use the root's.
	 * Returns null where the API is missing; find still counts and scrolls.
	 */
	private registry(name: string, priority: number): Highlight | null {
		const win = this.root.ownerDocument.defaultView as (Window & typeof globalThis) | null;
		if (!win || typeof win.Highlight === "undefined" || !win.CSS?.highlights) return null;

		let highlight = win.CSS.highlights.get(name);
		if (!highlight) {
			highlight = new win.Highlight();
			highlight.priority = priority;
			win.CSS.highlights.set(name, highlight);
		}
		return highlight;
	}

	// ----- input ----------------------------------------------------------

	private onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Enter") {
			event.preventDefault();
			// Enter before the debounce fired should act on what was typed.
			if (this.timer !== null) {
				this.cancelTimer();
				this.search(false);
				return;
			}
			this.step(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			this.close();
			this.scroller.focus();
		}
	};

	/** A short single-line selection inside this view, to seed the query. */
	private selectedText(): string | null {
		const selection = this.root.ownerDocument.getSelection();
		if (!selection || selection.isCollapsed || !this.root.contains(selection.anchorNode)) return null;
		const text = selection.toString().trim();
		if (!text || text.length > 200 || text.includes("\n")) return null;
		return text;
	}

	private button(label: string, onClick: () => void): HTMLButtonElement {
		const button = this.bar.createEl("button", { cls: "lectern-toolbar-btn lectern-find-btn" });
		setTooltip(button, label, { placement: "bottom" });
		button.addEventListener("click", onClick);
		return button;
	}
}

/** How the shortcut reads on this platform, for tooltips. */
export const FIND_SHORTCUT = Platform.isMacOS ? "⌘F" : "Ctrl+F";
