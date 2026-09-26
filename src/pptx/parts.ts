import JSZip from "jszip";
import { DEFAULT_CLR_MAP, readColorMap, readThemeColors, resolveColorIn, type ColorContext } from "./color";

/** Shared plumbing for the passes that read slide, layout, master and theme parts. */

export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

export function parseXml(xml: string): Document {
	return new DOMParser().parseFromString(xml, "application/xml");
}

/** First direct child with this local name, ignoring namespace prefixes. */
export function child(el: Element | null | undefined, name: string): Element | null {
	if (!el) return null;
	for (const c of Array.from(el.children)) if (c.localName === name) return c;
	return null;
}

function resolveTarget(baseDir: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const stack: string[] = [];
	for (const part of `${baseDir}/${target}`.split("/")) {
		if (part === "." || part === "") continue;
		if (part === "..") stack.pop();
		else stack.push(part);
	}
	return stack.join("/");
}

/** The target of a part's first relationship whose type ends with this name. */
export async function relTarget(zip: JSZip, partPath: string, typeSuffix: string): Promise<string | undefined> {
	const slash = partPath.lastIndexOf("/");
	const dir = partPath.slice(0, slash);
	const file = zip.file(`${dir}/_rels/${partPath.slice(slash + 1)}.rels`);
	if (!file) return undefined;
	const doc = parseXml(await file.async("text"));
	const rel = Array.from(doc.getElementsByTagName("*")).find(
		(e) => e.localName === "Relationship" && (e.getAttribute("Type") ?? "").endsWith(`/${typeSuffix}`)
	);
	return rel ? resolveTarget(dir, rel.getAttribute("Target") ?? "") : undefined;
}

export async function loadXml(zip: JSZip, path: string | undefined): Promise<Document | null> {
	const f = path ? zip.file(path) : null;
	return f ? parseXml(await f.async("text")) : null;
}

export interface SlideParts {
	slide: Document | null;
	layout: Document | null;
	master: Document | null;
	theme: Document | null;
	colors: ColorContext;
}

/** A slide with its layout, master, and the colour context they resolve to. */
export async function loadSlideParts(zip: JSZip, slidePath: string): Promise<SlideParts> {
	const slide = await loadXml(zip, slidePath);
	const layoutPath = await relTarget(zip, slidePath, "slideLayout");
	const masterPath = layoutPath ? await relTarget(zip, layoutPath, "slideMaster") : undefined;
	const themePath = masterPath ? await relTarget(zip, masterPath, "theme") : undefined;
	const [layout, master, theme] = await Promise.all([
		loadXml(zip, layoutPath),
		loadXml(zip, masterPath),
		loadXml(zip, themePath),
	]);

	const clrMap =
		readColorMap(slide?.getElementsByTagNameNS(NS_A, "overrideClrMapping")[0]) ??
		readColorMap(master?.getElementsByTagNameNS(NS_P, "clrMap")[0]) ??
		DEFAULT_CLR_MAP;

	return { slide, layout, master, theme, colors: { theme: readThemeColors(theme), clrMap } };
}

// ---------------------------------------------------------------------------
// Theme style matrix: <a:fillRef idx="2">, <a:lnRef idx="1">
// ---------------------------------------------------------------------------

/** A fill as CSS: a colour, or a CSS linear-gradient() value. */
export type CssFill = string;

export interface ThemeStyles {
	fills: Element[];
	bgFills: Element[];
	lines: Element[];
}

export function readThemeStyles(theme: Document | null): ThemeStyles {
	const list = (name: string) => {
		const el = theme ? Array.from(theme.getElementsByTagName("*")).find((e) => e.localName === name) : undefined;
		return el ? Array.from(el.children) : [];
	};
	return { fills: list("fillStyleLst"), bgFills: list("bgFillStyleLst"), lines: list("lnStyleLst") };
}

/** A solid or gradient fill element as CSS. */
export function fillToCss(fill: Element | null | undefined, colors: ColorContext): CssFill | undefined {
	if (!fill) return undefined;
	if (fill.localName === "noFill") return "transparent";
	if (fill.localName === "solidFill") return resolveColorIn(fill, colors);
	if (fill.localName === "gradFill") {
		const stops = Array.from(child(fill, "gsLst")?.children ?? [])
			.map((gs) => ({ pos: Number(gs.getAttribute("pos") ?? 0) / 1000, color: resolveColorIn(gs, colors) }))
			.filter((s) => s.color);
		if (!stops.length) return undefined;
		if (stops.length === 1) return stops[0].color;
		// DrawingML measures clockwise from "to the right"; CSS from "to the top".
		const ang = Number(child(fill, "lin")?.getAttribute("ang") ?? 5400000) / 60000 + 90;
		return `linear-gradient(${ang}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(", ")})`;
	}
	return undefined;
}

/** The colour a style reference passes down as phClr, as #RRGGBB. */
function refColor(ref: Element, colors: ColorContext): string | undefined {
	const c = resolveColorIn(ref, colors);
	return c && c.startsWith("#") ? c : undefined;
}

/** <a:fillRef idx="n">: 1-999 index fillStyleLst, 1001+ bgFillStyleLst, 0 is no fill. */
export function resolveFillRef(ref: Element | null, styles: ThemeStyles, colors: ColorContext): CssFill | undefined {
	if (!ref) return undefined;
	const idx = Number(ref.getAttribute("idx") ?? 0);
	if (!idx) return "transparent";
	const entry = idx >= 1001 ? styles.bgFills[idx - 1001] : styles.fills[idx - 1];
	const phClr = refColor(ref, colors);
	// Without a theme entry, the reference's own colour is the best we have.
	return fillToCss(entry, { ...colors, phClr }) ?? phClr;
}

/** <a:lnRef idx="n">: an outline from lnStyleLst in the reference's colour. */
export function resolveLnRef(
	ref: Element | null,
	styles: ThemeStyles,
	colors: ColorContext
): { color: string; widthPx: number } | undefined {
	if (!ref) return undefined;
	const idx = Number(ref.getAttribute("idx") ?? 0);
	if (!idx) return undefined;
	const phClr = refColor(ref, colors);
	const entry = styles.lines[idx - 1];
	const color = (entry && resolveColorIn(child(entry, "solidFill"), { ...colors, phClr })) ?? phClr;
	if (!color) return undefined;
	const w = Number(entry?.getAttribute("w") ?? 9525);
	return { color, widthPx: Math.max(0.75, +(w / 9525).toFixed(2)) };
}
