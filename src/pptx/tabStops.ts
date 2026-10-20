/**
 * Size every tab to reach its next tab stop, the way PowerPoint does.
 *
 * CSS knows one tab width for a whole block (`tab-size`) and measures it from
 * the block's content edge. PowerPoint has per-paragraph custom stops
 * (<a:tabLst>) measured from the text box's inner left edge, then default
 * stops every `defTabSz` after them. PDF-converted decks lean on this: CYBR
 * 310 week 2 places almost every word with its own stop ("The[TAB]asterisk
 * [TAB](*)" with stops at 30, 105, 234... px). At the default spacing those
 * lines ran long, wrapped a word early, and collided with the next box.
 *
 * Needs layout, so it runs after the slides are in the document, like
 * repairCollapsedShapes. Tabs are sized in order, since each one moves
 * everything after it. Measurements are divided by the current scale, so the
 * result is the same at any zoom.
 */

/** A tab, as a box this pass can widen. textApply.ts renders them. */
export const TAB_CLASS = "lectern-tab";

/** A stop counts as "reached" within half a pixel, so a tab exactly at a stop moves on. */
const EPSILON_PX = 0.5;

export function nextStop(x: number, custom: number[], hang: number | null, defaultPx: number): number {
	const stops = hang !== null ? [...custom, hang].sort((a, b) => a - b) : custom;
	for (const s of stops) if (s > x + EPSILON_PX) return s;
	// Past the last custom stop: default stops continue at every multiple.
	const step = defaultPx > 0 ? defaultPx : 96;
	return (Math.floor((x + EPSILON_PX) / step) + 1) * step;
}

/** Returns how many tabs were sized. */
export function applyTabStops(root: HTMLElement): number {
	let sized = 0;

	for (const p of Array.from(root.querySelectorAll<HTMLElement>(".lectern-p"))) {
		const tabs = Array.from(p.querySelectorAll<HTMLElement>(`.${TAB_CLASS}`));
		if (!tabs.length) continue;

		const custom = (p.dataset.tabStops ?? "")
			.split(",")
			.filter(Boolean)
			.map(Number)
			.filter(Number.isFinite);
		const hang = p.dataset.tabHang !== undefined ? Number(p.dataset.tabHang) : null;
		const defaultPx = Number(p.dataset.tabDefault) || 96;

		const box = p.getBoundingClientRect();
		// Zoom is a transform: rects are scaled, offsetWidth is not.
		const scale = p.offsetWidth > 0 ? box.width / p.offsetWidth : 1;
		if (!scale) continue;

		for (const tab of tabs) {
			// Collapse first, so the measurement is where the tab starts.
			Object.assign(tab.style, { display: "inline-block", width: "0px", height: "1px", overflow: "hidden" });
			tab.textContent = "";
			const at = tab.getBoundingClientRect();
			const x = (at.left - p.getBoundingClientRect().left) / scale;
			tab.style.width = `${Math.max(0, nextStop(x, custom, hang, defaultPx) - x)}px`;
			// A tab that no longer fits breaks the line and is used up there:
			// PowerPoint starts the next line flush, not indented by the tab.
			// Sized, it would have dropped to the new line with its width
			// intact (CYBR 310 week 1 slide 47, four indented lines).
			if (tab.getBoundingClientRect().top > at.top + 1) tab.style.width = "0px";
			sized++;
		}
	}

	return sized;
}
