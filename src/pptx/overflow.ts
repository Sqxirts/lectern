/**
 * The pptx renderer puts overflow:hidden on every text box, but lays those
 * boxes out a few pixels tighter than its own line boxes need, so descenders
 * get shaved and an extra wrapped line disappears entirely.
 *
 * It also uses overflow:hidden for something else entirely: a PowerPoint
 * picture crop (<a:srcRect>) becomes a box of the cropped size wrapping an
 * oversized <img> at a negative offset. Relaxing overflow on those uncrops
 * every image in the deck, which on CYBR 226 week 3 slide 11 spilled a stock
 * photo's watermark over the shape next to it and left the wall plate the
 * wrong shape.
 *
 * So drop the renderer's inline overflow only on elements that hold no image.
 * This used to be a `:not(:has(img)) { overflow: visible !important }` rule;
 * doing it once in code avoids both, and the default is already visible.
 */
export function relaxTextOverflow(root: HTMLElement): void {
	for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
		if (!el.querySelector("img")) clearOverflow(el);
	}
}

/**
 * After `el` lost its image (a metafile swapped for a placeholder), its
 * ancestors up to `stop` may hold no image any more either.
 */
export function relaxOverflowAbove(el: HTMLElement, stop: HTMLElement | null): void {
	for (let node = el.parentElement; node && node !== stop; node = node.parentElement) {
		if (!node.querySelector("img")) clearOverflow(node);
	}
}

function clearOverflow(el: HTMLElement): void {
	if (!el.style) return; // SVG children in some engines
	el.style.removeProperty("overflow");
	el.style.removeProperty("overflow-x");
	el.style.removeProperty("overflow-y");
}
