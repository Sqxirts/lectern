/**
 * Make zero-height and zero-width shapes visible again.
 *
 * A PowerPoint connector drawn perfectly horizontally has a bounding box of
 * zero height, and `@jvmr/pptx-to-html` copies that straight onto the <svg>
 * as `height: 0px`. Two further details turn that into nothing at all:
 *
 *   - the shape is emitted as a closed <polygon> filling a `0 0 100 100`
 *     viewBox, not as a <line>, so there is no stroke to straddle the axis;
 *   - the default preserveAspectRatio scales that viewBox uniformly, so even
 *     once the box has height the polygon shrinks to a square dot.
 *
 * Giving the box the stroke's own thickness, pulling it back by half that to
 * keep it centred on the original axis, and letting the viewBox stretch draws
 * the line where PowerPoint draws it. On CYBR 226 week 3 slide 11 this is the
 * difference between three numbered steps and three numbered steps joined up.
 */

/** Below this a box is effectively collapsed, allowing for subpixel layout. */
const COLLAPSED_PX = 1;

function strokeWidth(svg: SVGElement): number {
	const stroked = svg.querySelector("[stroke-width]");
	const raw = stroked?.getAttribute("stroke-width");
	const width = raw ? Number.parseFloat(raw) : Number.NaN;
	return Number.isFinite(width) && width > 0 ? width : 1;
}

function offset(value: string, by: number): string {
	const current = Number.parseFloat(value);
	return `${(Number.isFinite(current) ? current : 0) - by}px`;
}

/**
 * Expand every collapsed shape under `root`. Returns how many were changed,
 * which the tests assert on.
 */
export function repairCollapsedShapes(root: HTMLElement): number {
	let repaired = 0;

	for (const svg of Array.from(root.querySelectorAll("svg"))) {
		const box = svg.getBoundingClientRect();
		const thickness = strokeWidth(svg);

		const flatHorizontally = box.height < COLLAPSED_PX && box.width >= COLLAPSED_PX;
		const flatVertically = box.width < COLLAPSED_PX && box.height >= COLLAPSED_PX;
		if (!flatHorizontally && !flatVertically) continue;

		// Without this the polygon scales uniformly and collapses to a dot.
		svg.setAttribute("preserveAspectRatio", "none");

		if (flatHorizontally) {
			svg.style.height = `${thickness}px`;
			svg.style.top = offset(svg.style.top, thickness / 2);
		} else {
			svg.style.width = `${thickness}px`;
			svg.style.left = offset(svg.style.left, thickness / 2);
		}

		repaired++;
	}

	return repaired;
}
