import JSZip from "jszip";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

/**
 * EMU, English Metric Units, are OOXML's internal length unit. There are
 * 914400 to the inch, and CSS treats 96 of its pixels as an inch, so a pixel
 * is 914400 / 96 = 9525 EMU.
 */
const EMU_PER_PX = 9525;

/** A 16:9 deck at 96 DPI, the modern PowerPoint default. */
export const DEFAULT_SLIDE_SIZE: SlideSize = { width: 1280, height: 720 };

export interface SlideSize {
	width: number;
	height: number;
}

export function emuToPx(emu: number): number {
	return emu / EMU_PER_PX;
}

/**
 * The deck's real slide size, from `<p:sldSz>` in ppt/presentation.xml.
 *
 * Decks are not all 16:9. 4:3 is 9144000 x 6858000 EMU, which is 960 x 720,
 * and a custom page size can be anything. Reading the value instead of
 * assuming one is the difference between a slide that fits its frame and one
 * that is cropped or letterboxed.
 *
 * Falls back to the 16:9 default if the part is missing or unparseable, since
 * a wrong size is better than refusing to show the deck.
 */
export async function readSlideSize(buffer: ArrayBuffer): Promise<SlideSize> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const file = zip.file("ppt/presentation.xml");
		if (!file) return DEFAULT_SLIDE_SIZE;

		const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
		const node = doc.getElementsByTagNameNS(NS_P, "sldSz")[0];
		if (!node) return DEFAULT_SLIDE_SIZE;

		const cx = Number(node.getAttribute("cx"));
		const cy = Number(node.getAttribute("cy"));
		if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) {
			return DEFAULT_SLIDE_SIZE;
		}

		return { width: emuToPx(cx), height: emuToPx(cy) };
	} catch {
		return DEFAULT_SLIDE_SIZE;
	}
}
