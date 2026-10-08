import type { PdfSpan } from "./pdfAnchoring";

/**
 * Mapping between a DOM selection in PDF.js's text layer and item positions.
 *
 * PDF.js gives one span per text item (`textDivs[i]` is item i), nested inside
 * `markedContent` wrappers, with empty spans for end-of-line items. A selection
 * boundary can land inside an item's text, or between items on a wrapper or a
 * <br>; both cases are handled here.
 */

function textLength(node: Node): number {
	return node.textContent?.length ?? 0;
}

/** Where character `offset` of a text div sits as a DOM (node, offset) pair. */
export function locateInDiv(div: Node, offset: number): { node: Node; offset: number } {
	if (div.nodeType === Node.TEXT_NODE) {
		return { node: div, offset: Math.min(offset, textLength(div)) };
	}

	const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
	let remaining = offset;
	let last: Text | null = null;
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		if (remaining <= node.length) return { node, offset: remaining };
		remaining -= node.length;
		last = node;
	}
	return last ? { node: last, offset: last.length } : { node: div, offset: 0 };
}

/**
 * Which item, and which character in it, a selection boundary points at.
 * A boundary between items snaps forward for a start and backward for an end,
 * so the span covers exactly the selected text and nothing either side.
 */
export function pointToItem(
	textDivs: Node[],
	container: Node,
	offset: number,
	edge: "start" | "end",
): { item: number; offset: number } | null {
	for (let i = 0; i < textDivs.length; i++) {
		const div = textDivs[i];
		if (div === container || div.contains(container)) {
			const r = document.createRange();
			r.setStart(div, 0);
			r.setEnd(container, offset);
			return { item: i, offset: r.toString().length };
		}
	}

	const point = document.createRange();
	point.setStart(container, offset);

	if (edge === "start") {
		for (let i = 0; i < textDivs.length; i++) {
			if (textLength(textDivs[i]) > 0 && point.comparePoint(textDivs[i], 0) >= 0) return { item: i, offset: 0 };
		}
	} else {
		for (let i = textDivs.length - 1; i >= 0; i--) {
			const div = textDivs[i];
			if (textLength(div) > 0 && point.comparePoint(div, div.childNodes.length) <= 0) {
				return { item: i, offset: textLength(div) };
			}
		}
	}
	return null;
}

/** The page element (`.page[data-page-number]`) holding a node. */
export function pageElementOf(node: Node): HTMLElement | null {
	const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	return (el?.closest(".page[data-page-number]") as HTMLElement | null) ?? null;
}

/** A selection on one page as an item span, or null if it crosses pages or covers no text. */
export function rangeToSpan(range: Range, page: number, textDivs: Node[]): PdfSpan | null {
	const start = pointToItem(textDivs, range.startContainer, range.startOffset, "start");
	const end = pointToItem(textDivs, range.endContainer, range.endOffset, "end");
	if (!start || !end) return null;
	if (end.item < start.item || (end.item === start.item && end.offset <= start.offset)) return null;
	return { page, startItem: start.item, startOffset: start.offset, endItem: end.item, endOffset: end.offset };
}

/** A DOM Range over an item span, for measuring where to draw. */
export function spanToRange(span: PdfSpan, textDivs: Node[]): Range | null {
	const startDiv = textDivs[span.startItem];
	const endDiv = textDivs[span.endItem];
	if (!startDiv || !endDiv) return null;
	const start = locateInDiv(startDiv, span.startOffset);
	const end = locateInDiv(endDiv, span.endOffset);
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	return range;
}
