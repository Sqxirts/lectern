import type { PdfSpan } from "./pdfAnchoring";
import type { PdfPageView } from "./pdfInternals";
import { spanToRange } from "./pdfDom";

/**
 * Our highlight layer on a PDF.js page. It sits *under* the text layer, so text
 * stays selectable, and is never written into PDF.js's own text divs. Obsidian's
 * built-in `highlightText` rewrites those divs and can only show one highlight,
 * which is why we don't reuse it.
 *
 * Boxes are sized in percent of the layer. PDF.js zooms with a CSS transform
 * first and re-renders the text layer afterwards, and percent units keep the
 * boxes on the text in between (0.02 px drift in the spike).
 */

const LAYER_CLASS = "lectern-pdf-highlights";
export const PDF_BOX_CLASS = "lectern-pdf-box";
export const PDF_MARKER_CLASS = "lectern-pdf-marker";

/** The page's text divs once PDF.js has built its text layer, else null. */
export function renderedTextDivs(page: PdfPageView): Node[] | null {
	const divs = page.textLayer?.textLayer?.textDivs;
	return divs && divs.length > 0 && page.div.contains(page.textLayer!.div) ? divs : null;
}

/** Find or create the layer. PDF.js clears unknown page children on zoom, so this runs on every draw. */
function layerFor(page: PdfPageView): HTMLElement {
	let layer = page.div.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
	if (!layer) {
		layer = createDiv({ cls: LAYER_CLASS });
		const textLayer = page.textLayer?.div;
		if (textLayer && textLayer.parentElement === page.div) page.div.insertBefore(layer, textLayer);
		else page.div.appendChild(layer);
	}
	return layer;
}

/** Remove one comment's boxes and marker from a page, or everything if no id is given. */
export function clearPage(page: PdfPageView, commentId?: string): void {
	const layer = page.div.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
	if (!layer) return;
	const selector = commentId ? `[data-comment-id="${CSS.escape(commentId)}"]` : "*";
	layer.querySelectorAll(`:scope > ${selector}`).forEach((el) => el.remove());
}

/**
 * Merge client rects that sit on the same line and touch, so a highlight over
 * several text items reads as one box instead of overlapping stripes.
 */
function mergeLineRects(rects: DOMRect[]): { left: number; top: number; right: number; bottom: number }[] {
	const sorted = rects
		.filter((r) => r.width >= 1 && r.height >= 1)
		.map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))
		.sort((a, b) => a.top - b.top || a.left - b.left);

	const merged: typeof sorted = [];
	for (const r of sorted) {
		const last = merged[merged.length - 1];
		const sameLine = last && Math.abs(last.top - r.top) < (r.bottom - r.top) / 2;
		if (sameLine && r.left <= last.right + 2) {
			last.left = Math.min(last.left, r.left);
			last.right = Math.max(last.right, r.right);
			last.top = Math.min(last.top, r.top);
			last.bottom = Math.max(last.bottom, r.bottom);
		} else {
			merged.push(r);
		}
	}
	return merged;
}

/** Draw a comment's boxes on a rendered page. Returns them, first box first. */
export function drawBoxes(page: PdfPageView, commentId: string, span: PdfSpan, resolved: boolean): HTMLElement[] {
	const divs = renderedTextDivs(page);
	if (!divs) return [];
	const range = spanToRange(span, divs);
	if (!range) return [];

	clearPage(page, commentId);
	const layer = layerFor(page);
	const box = layer.getBoundingClientRect();
	if (box.width === 0 || box.height === 0) return [];

	const out: HTMLElement[] = [];
	for (const r of mergeLineRects([...range.getClientRects()])) {
		const el = createDiv({ cls: PDF_BOX_CLASS });
		if (resolved) el.classList.add("is-resolved");
		el.dataset.commentId = commentId;
		el.style.left = `${((r.left - box.left) / box.width) * 100}%`;
		el.style.top = `${((r.top - box.top) / box.height) * 100}%`;
		el.style.width = `${((r.right - r.left) / box.width) * 100}%`;
		el.style.height = `${((r.bottom - r.top) / box.height) * 100}%`;
		layer.appendChild(el);
		out.push(el);
	}
	return out;
}

/**
 * A zero-height stand-in for a comment on a page PDF.js has not rendered yet.
 * It spans the page width, so its right edge is where a connector starts, and
 * sits at the text's estimated height so the card is level with it.
 */
export function drawMarker(page: PdfPageView, commentId: string, topFraction: number): HTMLElement {
	clearPage(page, commentId);
	const el = createDiv({ cls: PDF_MARKER_CLASS });
	el.dataset.commentId = commentId;
	el.style.top = `${Math.min(Math.max(topFraction, 0), 1) * 100}%`;
	layerFor(page).appendChild(el);
	return el;
}
