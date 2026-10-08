import { looseIndexOf, looseIndexWithin } from "../comments/anchoring";
import { CONTEXT_CHARS, type PdfAnchor } from "../comments/types";

/**
 * Anchoring for PDFs, done on PDF.js text items instead of the DOM.
 *
 * PDF.js only builds the text layer for pages near the viewport, so a comment
 * on page 40 has no DOM to search when the file opens. `page.getTextContent()`
 * works for any page, and the spike (docs/pdf-highlights-scope.md) showed its
 * items line up 1:1 with the text layer's divs, empty end-of-line items
 * included. So everything here works on item indices, and the highlight layer
 * maps indices to DOM only once a page actually renders.
 *
 * Pure: no Obsidian, no PDF.js, no DOM. Tests feed it plain objects.
 */

/** The two fields we need from a PDF.js TextItem. */
export interface PdfTextItem {
	str: string;
	hasEOL?: boolean;
}

/** A run of text on one page, by item index and character offset. End offset is exclusive. */
export interface PdfSpan {
	page: number;
	startItem: number;
	startOffset: number;
	endItem: number;
	endOffset: number;
}

/** How the anchor was found. Kept for tests and for debugging drift on real PDFs. */
export type PdfMatchStep = "selection" | "context" | "quote" | "other-page" | "orphaned";

export interface PdfPlacement {
	span: PdfSpan | null;
	step: PdfMatchStep;
}

/**
 * One page's text as a single string, plus where each item starts in it.
 *
 * A newline goes after every `hasEOL` item. It belongs to no item, so it never
 * shifts an item's own offsets, but it stops the last word of one line gluing
 * onto the first word of the next ("endof" + "line" -> "endofline").
 */
export class PdfPageText {
	readonly page: number;
	readonly text: string;
	private starts: number[];
	private lengths: number[];

	constructor(page: number, items: PdfTextItem[]) {
		this.page = page;
		this.starts = [];
		this.lengths = [];
		let text = "";
		for (const item of items) {
			this.starts.push(text.length);
			this.lengths.push(item.str.length);
			text += item.str;
			if (item.hasEOL) text += "\n";
		}
		this.text = text;
	}

	get itemCount(): number {
		return this.starts.length;
	}

	/** Absolute [start, end) in `text` for a span, or null if the span no longer fits this page. */
	toOffsets(span: Pick<PdfSpan, "startItem" | "startOffset" | "endItem" | "endOffset">): { start: number; end: number } | null {
		const { startItem, startOffset, endItem, endOffset } = span;
		if (!this.validPosition(startItem, startOffset) || !this.validPosition(endItem, endOffset)) return null;
		const start = this.starts[startItem] + startOffset;
		const end = this.starts[endItem] + endOffset;
		return end > start ? { start, end } : null;
	}

	/**
	 * Map absolute [start, end) back to items. A boundary that falls on an
	 * inserted newline is pulled onto real text: a start moves forward to the
	 * next item, an end moves back to the end of the previous one.
	 */
	toSpan(start: number, end: number): PdfSpan | null {
		if (end <= start) return null;

		let startItem = -1;
		for (let i = 0; i < this.itemCount; i++) {
			// Skip empty items: a span should never start on an end-of-line marker.
			if (this.lengths[i] > 0 && start < this.starts[i] + this.lengths[i]) {
				startItem = i;
				break;
			}
		}

		let endItem = -1;
		for (let i = this.itemCount - 1; i >= 0; i--) {
			if (this.lengths[i] > 0 && this.starts[i] < end) {
				endItem = i;
				break;
			}
		}

		if (startItem < 0 || endItem < 0 || endItem < startItem) return null;

		return {
			page: this.page,
			startItem,
			startOffset: Math.max(0, start - this.starts[startItem]),
			endItem,
			endOffset: Math.min(this.lengths[endItem], end - this.starts[endItem]),
		};
	}

	private validPosition(item: number, offset: number): boolean {
		return Number.isInteger(item) && item >= 0 && item < this.itemCount && offset >= 0 && offset <= this.lengths[item];
	}
}

/**
 * Build the stored anchor for a selection. Leading and trailing whitespace is
 * trimmed off the span itself, not just the quote, so the stored indices and
 * the stored quote always describe the same characters.
 */
export function buildPdfAnchor(pageText: PdfPageText, span: PdfSpan): PdfAnchor | null {
	const offsets = pageText.toOffsets(span);
	if (!offsets) return null;

	let { start, end } = offsets;
	const raw = pageText.text;
	while (start < end && /\s/.test(raw[start])) start++;
	while (end > start && /\s/.test(raw[end - 1])) end--;
	if (end <= start) return null;

	const trimmed = pageText.toSpan(start, end);
	if (!trimmed) return null;

	return {
		kind: "pdf",
		page: pageText.page,
		selection: [trimmed.startItem, trimmed.startOffset, trimmed.endItem, trimmed.endOffset],
		quote: raw.slice(start, end),
		prefix: raw.slice(Math.max(0, start - CONTEXT_CHARS), start),
		suffix: raw.slice(end, end + CONTEXT_CHARS),
	};
}

/** Compare two strings the way the matcher does: whitespace runs count as one space. */
function sameText(a: string, b: string): boolean {
	const squash = (s: string) => s.replace(/\s+/g, " ").trim();
	return squash(a) === squash(b);
}

/** prefix + quote + suffix, then the quote inside that match. */
function findWithContext(pageText: PdfPageText, anchor: PdfAnchor): PdfSpan | null {
	const context = looseIndexOf(pageText.text, `${anchor.prefix}${anchor.quote}${anchor.suffix}`);
	if (!context) return null;
	const quote = looseIndexWithin(pageText.text, anchor.quote, context.start, context.end);
	return quote ? pageText.toSpan(quote.start, quote.end) : null;
}

function findQuote(pageText: PdfPageText, anchor: PdfAnchor): PdfSpan | null {
	const quote = looseIndexOf(pageText.text, anchor.quote);
	return quote ? pageText.toSpan(quote.start, quote.end) : null;
}

/** Other pages, nearest first: a page inserted or removed moves text by a page or two, not twenty. */
function pagesByDistance(from: number, pageCount: number): number[] {
	const order: number[] = [];
	for (let d = 1; d < pageCount; d++) {
		if (from - d >= 1) order.push(from - d);
		if (from + d <= pageCount) order.push(from + d);
	}
	return order;
}

/**
 * Find a stored anchor in the current PDF. The ladder, strictest first:
 *
 * 1. the stored item indices, but only if they still cover the stored quote
 * 2. prefix + quote + suffix on the stored page
 * 3. the quote alone on the stored page
 * 4. the same two checks on other pages, nearest page first
 * 5. orphaned, so the comment is badged instead of dropped
 *
 * `loadPage` is async because PDF.js extracts text on demand. Step 4 is the
 * only one that reads more than one page, so a normal open costs one extraction.
 */
export async function resolvePdfAnchor(
	anchor: PdfAnchor,
	pageCount: number,
	loadPage: (page: number) => Promise<PdfPageText | null>,
): Promise<PdfPlacement> {
	const home = anchor.page >= 1 && anchor.page <= pageCount ? await loadPage(anchor.page) : null;

	if (home) {
		if (anchor.selection) {
			const [startItem, startOffset, endItem, endOffset] = anchor.selection;
			const offsets = home.toOffsets({ startItem, startOffset, endItem, endOffset });
			if (offsets && sameText(home.text.slice(offsets.start, offsets.end), anchor.quote)) {
				return { span: { page: home.page, startItem, startOffset, endItem, endOffset }, step: "selection" };
			}
		}

		const inContext = findWithContext(home, anchor);
		if (inContext) return { span: inContext, step: "context" };

		const quoteOnly = findQuote(home, anchor);
		if (quoteOnly) return { span: quoteOnly, step: "quote" };
	}

	const start = Math.min(Math.max(anchor.page, 1), pageCount);
	const others = home ? pagesByDistance(start, pageCount) : [start, ...pagesByDistance(start, pageCount)];
	for (const page of others) {
		const text = await loadPage(page);
		if (!text) continue;
		const found = findWithContext(text, anchor) ?? findQuote(text, anchor);
		if (found) return { span: found, step: "other-page" };
	}

	return { span: null, step: "orphaned" };
}
