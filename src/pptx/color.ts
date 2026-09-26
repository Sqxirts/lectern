/**
 * DrawingML colour resolution.
 *
 * `@jvmr/pptx-to-html` reads a theme colour's base value and throws away its
 * modifiers, so "Accent 1, 25% darker" (`<a:schemeClr val="accent1"><a:lumMod
 * val="75000"/></a:schemeClr>`) renders as plain Accent 1. Decks built from a
 * theme use these everywhere: muted body text, tinted table bands, darker
 * headings. This resolves the whole element.
 */

/** Theme colour slots by name: dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink. */
export type ThemeColors = Record<string, string>;

/** Master <p:clrMap>: maps bg1/tx1/bg2/tx2 (and the rest) onto theme slots. */
export type ColorMap = Record<string, string>;

export const DEFAULT_CLR_MAP: ColorMap = {
	bg1: "lt1",
	tx1: "dk1",
	bg2: "lt2",
	tx2: "dk2",
	accent1: "accent1",
	accent2: "accent2",
	accent3: "accent3",
	accent4: "accent4",
	accent5: "accent5",
	accent6: "accent6",
	hlink: "hlink",
	folHlink: "folHlink",
};

/** The handful of preset names that turn up in real decks. */
const PRESET: Record<string, string> = {
	black: "000000",
	white: "FFFFFF",
	red: "FF0000",
	green: "008000",
	blue: "0000FF",
	yellow: "FFFF00",
	gray: "808080",
	grey: "808080",
	darkGray: "A9A9A9",
	lightGray: "D3D3D3",
	orange: "FFA500",
};

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB | null {
	const clean = hex.replace(/^#/, "");
	if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
	return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as RGB;
}

function rgbToHsl([r, g, b]: RGB): RGB {
	const [rn, gn, bn] = [r / 255, g / 255, b / 255];
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return [h / 6, s, l];
}

function hslToRgb([h, s, l]: RGB): RGB {
	if (s === 0) return [l * 255, l * 255, l * 255];
	const hue = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Apply the modifier children of a colour element, in document order.
 * Values are in thousandths of a percent: 75000 means 75%.
 */
function applyModifiers(base: RGB, colorEl: Element): { rgb: RGB; alpha: number } {
	let rgb = base;
	let alpha = 1;

	for (const mod of Array.from(colorEl.children)) {
		const v = Number(mod.getAttribute("val"));
		if (!Number.isFinite(v)) continue;
		const f = v / 100000;

		switch (mod.localName) {
			case "lumMod": {
				const [h, s, l] = rgbToHsl(rgb);
				rgb = hslToRgb([h, s, clamp01(l * f)]);
				break;
			}
			case "lumOff": {
				const [h, s, l] = rgbToHsl(rgb);
				rgb = hslToRgb([h, s, clamp01(l + f)]);
				break;
			}
			case "satMod": {
				const [h, s, l] = rgbToHsl(rgb);
				rgb = hslToRgb([h, clamp01(s * f), l]);
				break;
			}
			// tint moves toward white, shade toward black, by (1 - f).
			case "tint":
				rgb = rgb.map((c) => c + (255 - c) * (1 - f)) as RGB;
				break;
			case "shade":
				rgb = rgb.map((c) => c * f) as RGB;
				break;
			case "alpha":
				alpha = clamp01(f);
				break;
		}
	}

	return { rgb, alpha };
}

function toCss({ rgb, alpha }: { rgb: RGB; alpha: number }): string {
	const [r, g, b] = rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))));
	if (alpha < 1) return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export interface ColorContext {
	theme: ThemeColors;
	clrMap: ColorMap;
	/** What `phClr` means here: the colour a style reference passed down. */
	phClr?: string;
}

/**
 * Resolve one colour element (<a:srgbClr>, <a:schemeClr>, <a:sysClr>,
 * <a:prstClr>, <a:scrgbClr>, <a:hslClr>) to CSS. Undefined when it cannot be.
 */
export function resolveColorElement(el: Element, ctx: ColorContext): string | undefined {
	let base: RGB | null = null;

	switch (el.localName) {
		case "srgbClr":
			base = hexToRgb(el.getAttribute("val") ?? "");
			break;
		case "sysClr":
			base = hexToRgb(el.getAttribute("lastClr") ?? "") ?? (el.getAttribute("val") === "window" ? [255, 255, 255] : [0, 0, 0]);
			break;
		case "prstClr":
			base = hexToRgb(PRESET[el.getAttribute("val") ?? ""] ?? "");
			break;
		case "scrgbClr": {
			const pc = (n: string) => clamp01(Number(el.getAttribute(n)) / 100000) * 255;
			base = [pc("r"), pc("g"), pc("b")];
			break;
		}
		case "hslClr": {
			const h = Number(el.getAttribute("hue")) / 60000 / 360;
			const s = Number(el.getAttribute("sat")) / 100000;
			const l = Number(el.getAttribute("lum")) / 100000;
			base = hslToRgb([h, s, l]);
			break;
		}
		case "schemeClr": {
			const val = el.getAttribute("val") ?? "";
			if (val === "phClr") {
				base = ctx.phClr ? hexToRgb(ctx.phClr) : null;
				break;
			}
			const slot = ctx.clrMap[val] ?? DEFAULT_CLR_MAP[val] ?? val;
			const hex = ctx.theme[slot];
			base = hex ? hexToRgb(hex) : null;
			break;
		}
	}

	if (!base) return undefined;
	return toCss(applyModifiers(base, el));
}

const COLOR_TAGS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"]);

/** The colour inside a fill-like wrapper (<a:solidFill>, <a:buClr>, <a:highlight>...). */
export function resolveColorIn(wrapper: Element | null | undefined, ctx: ColorContext): string | undefined {
	if (!wrapper) return undefined;
	const colorEl = Array.from(wrapper.children).find((c) => COLOR_TAGS.has(c.localName));
	return colorEl ? resolveColorElement(colorEl, ctx) : undefined;
}

/** Theme colour slots from a theme part. */
export function readThemeColors(themeDoc: Document | null): ThemeColors {
	const colors: ThemeColors = {};
	if (!themeDoc) return colors;
	const scheme = Array.from(themeDoc.getElementsByTagName("*")).find((e) => e.localName === "clrScheme");
	if (!scheme) return colors;
	for (const slot of Array.from(scheme.children)) {
		const c = slot.children[0];
		if (!c) continue;
		const hex = c.localName === "sysClr" ? c.getAttribute("lastClr") : c.getAttribute("val");
		if (hex && /^[0-9A-Fa-f]{6}$/.test(hex)) colors[slot.localName] = `#${hex.toUpperCase()}`;
	}
	return colors;
}

/** A master's <p:clrMap>, or a slide's <p:clrMapOvr><a:overrideClrMapping>. */
export function readColorMap(el: Element | null | undefined): ColorMap | null {
	if (!el) return null;
	const map: ColorMap = {};
	for (const attr of Array.from(el.attributes)) map[attr.localName] = attr.value;
	return Object.keys(map).length ? map : null;
}
