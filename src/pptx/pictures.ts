import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";
import { NS_P, child, loadSlideParts } from "./parts";
import { absoluteBox } from "./shapes";

/**
 * Picture effects the renderer drops.
 *
 * A <a:blip> can carry its own transparency (<a:alphaModFix amt="19000"/> is
 * 19% opaque), greyscale, and brightness/contrast. `@jvmr/pptx-to-html` embeds
 * the image bytes and ignores all of them. The CYBR 310 week 1 master has a
 * wave graphic at 19% that it painted at full strength behind every slide,
 * which was most of that deck's 20% difference from PowerPoint.
 */

const EMU_PER_PX = 9525;

export interface PictureEffect {
	rectPx: { x: number; y: number; w: number; h: number };
	opacity: number;
	/** CSS filter value, or empty. */
	filter: string;
}

function effectOf(blip: Element): Omit<PictureEffect, "rectPx"> | null {
	let opacity = 1;
	const filters: string[] = [];

	const alpha = child(blip, "alphaModFix");
	if (alpha) opacity = Math.min(1, Math.max(0, Number(alpha.getAttribute("amt") ?? 100000) / 100000));

	if (child(blip, "grayscl")) filters.push("grayscale(1)");

	const lum = child(blip, "lum");
	if (lum) {
		// Both in thousandths of a percent, -100000..100000.
		const bright = Number(lum.getAttribute("bright") ?? 0) / 100000;
		const contrast = Number(lum.getAttribute("contrast") ?? 0) / 100000;
		if (bright) filters.push(`brightness(${+(1 + bright).toFixed(3)})`);
		if (contrast) filters.push(`contrast(${+(1 + contrast).toFixed(3)})`);
	}

	if (opacity === 1 && !filters.length) return null;
	return { opacity, filter: filters.join(" ") };
}

function readTree(doc: Document | null, skipPlaceholders: boolean): PictureEffect[] {
	const tree = doc?.getElementsByTagNameNS(NS_P, "spTree")[0];
	if (!tree) return [];
	const out: PictureEffect[] = [];

	for (const pic of Array.from(tree.getElementsByTagNameNS(NS_P, "pic"))) {
		if (skipPlaceholders && pic.getElementsByTagNameNS(NS_P, "ph")[0]) continue;
		const blip = child(child(pic, "blipFill"), "blip");
		const effect = blip ? effectOf(blip) : null;
		if (!effect) continue;
		const box = absoluteBox(pic, tree);
		out.push({
			rectPx: { x: box.x / EMU_PER_PX, y: box.y / EMU_PER_PX, w: box.cx / EMU_PER_PX, h: box.cy / EMU_PER_PX },
			...effect,
		});
	}
	return out;
}

export async function readPictureEffects(buffer: ArrayBuffer): Promise<PictureEffect[][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const out: PictureEffect[][] = [];
		for (const path of await slidePathsInOrder(zip)) {
			const { slide, layout, master } = await loadSlideParts(zip, path);
			out.push([...readTree(slide, false), ...readTree(layout, true), ...readTree(master, true)]);
		}
		return out;
	} catch {
		return [];
	}
}

const TOLERANCE_PX = 0.6;

/**
 * The element that carries a picture's box: the <img> itself, or the
 * overflow wrapper the renderer uses for a cropped picture.
 */
function pictureBoxes(slide: HTMLElement): HTMLElement[] {
	return Array.from(slide.querySelectorAll("img")).map((img) => {
		const parent = img.parentElement;
		const wrapped = parent && parent.style.overflow === "hidden" && parent.children.length === 1;
		return wrapped ? parent : img;
	});
}

export function applyPictureEffects(slide: HTMLElement, effects: PictureEffect[] | undefined): number {
	if (!effects?.length) return 0;
	const pool = pictureBoxes(slide);
	const used = new Set<HTMLElement>();
	let applied = 0;

	for (const e of effects) {
		const match = pool.find((el) => {
			if (used.has(el)) return false;
			const s = el.style;
			return (
				Math.abs(parseFloat(s.left) - e.rectPx.x) < TOLERANCE_PX &&
				Math.abs(parseFloat(s.top) - e.rectPx.y) < TOLERANCE_PX &&
				Math.abs(parseFloat(s.width) - e.rectPx.w) < TOLERANCE_PX &&
				Math.abs(parseFloat(s.height) - e.rectPx.h) < TOLERANCE_PX
			);
		});
		if (!match) continue;
		used.add(match);
		if (e.opacity < 1) match.style.opacity = String(e.opacity);
		if (e.filter) match.style.filter = e.filter;
		applied++;
	}

	return applied;
}
