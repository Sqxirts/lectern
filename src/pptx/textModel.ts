import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";
import {
	DEFAULT_CLR_MAP,
	readColorMap,
	readThemeColors,
	resolveColorIn,
	type ColorContext,
	type ColorMap,
	type ThemeColors,
} from "./color";
import { bulletGlyph, fontStack } from "./fonts";
import { absoluteBox } from "./shapes";

/**
 * Text as PowerPoint lays it out, read from the XML with the full
 * inheritance chain resolved.
 *
 * `@jvmr/pptx-to-html` gives each text box one font, size, weight and colour,
 * taken from whichever run it read *last*, and drops paragraph spacing, indents,
 * italics, underline, letter spacing, caps, real bullet glyphs, empty spacer
 * paragraphs, the default insets, autofit, and everything a placeholder
 * inherits from its layout and master. On a themed deck (CYBR 310) that is
 * most of the formatting on the slide.
 *
 * This module produces a plain data model. textApply.ts turns it into DOM,
 * inside the positioned boxes the renderer already drew. Keeping the two apart
 * keeps this side testable without a browser.
 *
 * Inheritance, most specific first, per paragraph level:
 *   run <a:rPr>
 *   paragraph <a:pPr> (and its <a:defRPr>)
 *   the shape's own <a:lstStyle>
 *   the matching layout placeholder's <a:lstStyle>
 *   the matching master placeholder's <a:lstStyle>
 *   the master's <p:txStyles>: titleStyle, bodyStyle or otherStyle
 *   presentation.xml <p:defaultTextStyle>
 * then the shape's <p:style><a:fontRef> and the theme fonts underneath.
 */

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

const EMU_PER_PX = 9525;
/** PowerPoint's single line spacing, as a multiple of font size, for typical faces. */
// Measured, not assumed: sizing lines from each font's CSS "normal" height
// instead scored worse against PowerPoint on 11 of 12 decks (2026-09-26).
const SINGLE_LINE = 1.2;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface RunStyle {
	fontFamily?: string;
	sizePt?: number;
	bold?: boolean;
	italic?: boolean;
	underline?: "single" | "double";
	strike?: boolean;
	color?: string;
	letterSpacingPt?: number;
	caps?: "all" | "small";
	/** Percent of line height to shift; positive is superscript. */
	baseline?: number;
	highlight?: string;
}

export interface RunModel {
	/** "\n" marks an <a:br>. */
	text: string;
	style: RunStyle;
}

export interface BulletModel {
	text: string;
	fontFamily?: string;
	color?: string;
	sizePt?: number;
}

export interface ParagraphModel {
	align: "left" | "center" | "right" | "justify";
	marginLeftPx: number;
	marginRightPx: number;
	tabSizePx: number;
	/**
	 * Custom tab stops from <a:tabLst>, in px from the text box's inner left
	 * edge, ascending. PDF-converted decks place every word with these.
	 */
	tabStopsPx: number[];
	indentPx: number;
	/** Unitless multiple of font size, or absolute points. */
	lineHeight: { multiple: number } | { pt: number };
	spaceBeforePt: number;
	spaceAfterPt: number;
	bullet?: BulletModel;
	runs: RunModel[];
	/** Size of the paragraph mark, which sets an empty paragraph's height. */
	endSizePt: number;
	/** Resolved style for the paragraph as a whole, for empty lines and bullets. */
	baseStyle: RunStyle;
}

export interface TextBodyModel {
	/** Every character of the body with all whitespace removed. Matches the rendered box. */
	key: string;
	insetsPx: { left: number; top: number; right: number; bottom: number };
	anchor: "top" | "middle" | "bottom";
	wrap: boolean;
	paragraphs: ParagraphModel[];
	/** Where the shape sits, own or inherited from its layout or master placeholder. */
	rectPx?: { x: number; y: number; w: number; h: number };
	/** 0 master, 1 layout, 2 slide: which band of the renderer's z-order. */
	layer: number;
	/**
	 * Holds a field (slide number, date). The renderer drops field text, and a
	 * box of nothing but fields entirely, so these may need drawing from scratch.
	 */
	hasField: boolean;
}

export interface SlideTextModel {
	/** Text boxes from the slide, then from its layout and master (non-placeholders). */
	boxes: TextBodyModel[];
	/** Per table in XML order, [row][cell], including merge continuations. */
	tables: (TextBodyModel | null)[][][];
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function parse(xml: string): Document {
	return new DOMParser().parseFromString(xml, "application/xml");
}

function child(el: Element | null | undefined, name: string): Element | null {
	if (!el) return null;
	for (const c of Array.from(el.children)) if (c.localName === name) return c;
	return null;
}

function num(el: Element | null | undefined, attr: string): number | undefined {
	const raw = el?.getAttribute(attr);
	if (raw === null || raw === undefined || raw === "") return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function descendants(root: Element | Document, ns: string, name: string): Element[] {
	return Array.from(root.getElementsByTagNameNS(ns, name));
}

interface Rel {
	type: string;
	target: string;
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

async function readRels(zip: JSZip, partPath: string): Promise<Rel[]> {
	const slash = partPath.lastIndexOf("/");
	const dir = partPath.slice(0, slash);
	const file = zip.file(`${dir}/_rels/${partPath.slice(slash + 1)}.rels`);
	if (!file) return [];
	const doc = parse(await file.async("text"));
	return Array.from(doc.getElementsByTagName("*"))
		.filter((e) => e.localName === "Relationship" && e.getAttribute("TargetMode") !== "External")
		.map((e) => ({ type: e.getAttribute("Type") ?? "", target: resolveTarget(dir, e.getAttribute("Target") ?? "") }));
}

const relOfType = (rels: Rel[], suffix: string) => rels.find((r) => r.type.endsWith(`/${suffix}`))?.target;

// ---------------------------------------------------------------------------
// Deck context: theme, masters, layouts
// ---------------------------------------------------------------------------

interface ThemeFonts {
	major: string;
	minor: string;
}

interface MasterInfo {
	doc: Document;
	theme: ThemeColors;
	fonts: ThemeFonts;
	clrMap: ColorMap;
	titleStyle: Element | null;
	bodyStyle: Element | null;
	otherStyle: Element | null;
}

interface LayoutInfo {
	doc: Document;
	master: MasterInfo;
}

class DeckContext {
	private masters = new Map<string, MasterInfo>();
	private layouts = new Map<string, LayoutInfo>();
	defaultTextStyle: Element | null = null;

	constructor(private zip: JSZip) {}

	async init(): Promise<void> {
		const pres = this.zip.file("ppt/presentation.xml");
		if (!pres) return;
		const doc = parse(await pres.async("text"));
		this.defaultTextStyle = descendants(doc, NS_P, "defaultTextStyle")[0] ?? null;
	}

	private async doc(path: string): Promise<Document | null> {
		const file = this.zip.file(path);
		return file ? parse(await file.async("text")) : null;
	}

	async master(path: string): Promise<MasterInfo | null> {
		const cached = this.masters.get(path);
		if (cached) return cached;
		const doc = await this.doc(path);
		if (!doc) return null;

		const themePath = relOfType(await readRels(this.zip, path), "theme");
		const themeDoc = themePath ? await this.doc(themePath) : null;
		const fontOf = (kind: string) => {
			const node = themeDoc ? Array.from(themeDoc.getElementsByTagName("*")).find((e) => e.localName === kind) : undefined;
			return child(node, "latin")?.getAttribute("typeface") ?? "";
		};
		const txStyles = descendants(doc, NS_P, "txStyles")[0] ?? null;

		const info: MasterInfo = {
			doc,
			theme: readThemeColors(themeDoc),
			fonts: { major: fontOf("majorFont") || "Calibri Light", minor: fontOf("minorFont") || "Calibri" },
			clrMap: readColorMap(descendants(doc, NS_P, "clrMap")[0]) ?? DEFAULT_CLR_MAP,
			titleStyle: child(txStyles, "titleStyle"),
			bodyStyle: child(txStyles, "bodyStyle"),
			otherStyle: child(txStyles, "otherStyle"),
		};
		this.masters.set(path, info);
		return info;
	}

	async layout(path: string): Promise<LayoutInfo | null> {
		const cached = this.layouts.get(path);
		if (cached) return cached;
		const doc = await this.doc(path);
		if (!doc) return null;
		const masterPath = relOfType(await readRels(this.zip, path), "slideMaster");
		const master = masterPath ? await this.master(masterPath) : null;
		if (!master) return null;
		const info = { doc, master };
		this.layouts.set(path, info);
		return info;
	}

	async slide(path: string): Promise<{ doc: Document; layout: LayoutInfo | null } | null> {
		const doc = await this.doc(path);
		if (!doc) return null;
		const layoutPath = relOfType(await readRels(this.zip, path), "slideLayout");
		return { doc, layout: layoutPath ? await this.layout(layoutPath) : null };
	}
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

interface PlaceholderRef {
	type: string;
	idx?: string;
}

function placeholderOf(shape: Element): PlaceholderRef | null {
	const nvPr = child(child(shape, "nvSpPr"), "nvPr");
	const ph = child(nvPr, "ph");
	if (!ph) return null;
	// ST_PlaceholderType defaults to "obj" when the attribute is absent.
	return { type: ph.getAttribute("type") ?? "obj", idx: ph.getAttribute("idx") ?? undefined };
}

/** Which master text style a placeholder type draws on. */
function styleFamily(ph: PlaceholderRef | null): "title" | "body" | "other" {
	if (!ph) return "other";
	if (ph.type === "title" || ph.type === "ctrTitle") return "title";
	if (["dt", "ftr", "sldNum", "hdr"].includes(ph.type)) return "other";
	return "body";
}

/** Types that stand in for each other when matching up the chain. */
function typeKey(type: string): string {
	if (type === "ctrTitle") return "title";
	if (type === "subTitle" || type === "obj") return "body";
	return type;
}

function findPlaceholder(doc: Document | null | undefined, ph: PlaceholderRef, byIdx: boolean): Element | null {
	if (!doc) return null;
	const shapes = descendants(doc, NS_P, "sp");
	if (byIdx && ph.idx !== undefined) {
		const hit = shapes.find((s) => placeholderOf(s)?.idx === ph.idx);
		if (hit) return hit;
	}
	const want = typeKey(ph.type);
	return shapes.find((s) => {
		const other = placeholderOf(s);
		return other !== null && typeKey(other.type) === want;
	}) ?? null;
}

// ---------------------------------------------------------------------------
// Property chains
// ---------------------------------------------------------------------------

/**
 * One level's worth of paragraph properties from each source, most specific
 * first. A lookup walks the list and takes the first source that says.
 */
type Chain = Element[];

function levelProps(lstStyle: Element | null | undefined, level: number): Element | null {
	return child(lstStyle, `lvl${level}pPr`) ?? (level === 1 ? child(lstStyle, "defPPr") : null);
}

function first<T>(chain: Chain, pick: (el: Element) => T | undefined): T | undefined {
	for (const el of chain) {
		const v = pick(el);
		if (v !== undefined) return v;
	}
	return undefined;
}

interface ShapeInheritance {
	/** lstStyle-like sources, most specific first: shape, layout ph, master ph, txStyle, default. */
	lists: (Element | null)[];
	bodyPrs: Element[];
	/** From <p:style><a:fontRef>: a font slot and a colour, the base under everything. */
	fontRef?: { font?: "major" | "minor"; color?: string };
	colors: ColorContext;
	fonts: ThemeFonts;
	hlink?: string;
	/**
	 * False for table cells: a colour from the inherited lists or the tx1
	 * floor would override the table style's own text colour, which the
	 * renderer already puts on the <td>. Only the cell's own XML counts.
	 */
	inheritColor: boolean;
	/** For <a:fld type="slidenum">. */
	slideNumber?: number;
}

function textStyleFor(family: "title" | "body" | "other", master: MasterInfo | undefined): Element | null {
	if (!master) return null;
	return family === "title" ? master.titleStyle : family === "body" ? master.bodyStyle : master.otherStyle;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function resolveTypeface(face: string | undefined, fonts: ThemeFonts): string | undefined {
	if (!face) return undefined;
	if (face.startsWith("+mj")) return fonts.major;
	if (face.startsWith("+mn")) return fonts.minor;
	return face;
}

/** Read what one rPr / defRPr says, without inheritance. */
function readRunProps(rPr: Element | null, inh: ShapeInheritance): RunStyle {
	if (!rPr) return {};
	const style: RunStyle = {};

	const sz = num(rPr, "sz");
	if (sz !== undefined) style.sizePt = sz / 100;
	const b = rPr.getAttribute("b");
	if (b !== null) style.bold = b === "1" || b === "true";
	const i = rPr.getAttribute("i");
	if (i !== null) style.italic = i === "1" || i === "true";

	const u = rPr.getAttribute("u");
	if (u !== null && u !== "none") style.underline = u.startsWith("dbl") ? "double" : "single";

	const strike = rPr.getAttribute("strike");
	if (strike !== null) style.strike = strike !== "noStrike";

	const spc = num(rPr, "spc");
	if (spc !== undefined) style.letterSpacingPt = spc / 100;

	const cap = rPr.getAttribute("cap");
	if (cap !== null) style.caps = cap === "all" ? "all" : cap === "small" ? "small" : undefined;

	const baseline = num(rPr, "baseline");
	if (baseline !== undefined) style.baseline = baseline / 1000;

	const latin = child(rPr, "latin")?.getAttribute("typeface");
	const face = resolveTypeface(latin ?? undefined, inh.fonts);
	if (face) style.fontFamily = face;

	const fill = child(rPr, "solidFill");
	if (fill) {
		const c = resolveColorIn(fill, inh.colors);
		if (c) style.color = c;
	} else if (child(rPr, "noFill")) {
		style.color = "transparent";
	} else {
		// A gradient text fill: its first stop is a fair single colour.
		const grad = child(rPr, "gradFill");
		const stop = grad ? descendants(grad, NS_A, "gs")[0] : null;
		const c = stop ? resolveColorIn(stop, inh.colors) : undefined;
		if (c) style.color = c;
	}

	const hl = child(rPr, "highlight");
	if (hl) {
		const c = resolveColorIn(hl, inh.colors);
		if (c) style.highlight = c;
	}

	return style;
}

/** Merge run styles: earlier wins, later fills gaps. */
function mergeStyles(...styles: RunStyle[]): RunStyle {
	const out: RunStyle = {};
	for (const s of styles) {
		for (const [k, v] of Object.entries(s) as [keyof RunStyle, never][]) {
			if (out[k] === undefined && v !== undefined) out[k] = v;
		}
	}
	return out;
}

function levelChain(inh: ShapeInheritance, pPr: Element | null, level: number): Chain {
	const chain: Chain = [];
	if (pPr) chain.push(pPr);
	for (const list of inh.lists) {
		const lvl = levelProps(list, level);
		if (lvl) chain.push(lvl);
	}
	return chain;
}

/** The paragraph-level default run style, fully inherited. */
function baseRunStyle(chain: Chain, pPr: Element | null, inh: ShapeInheritance): RunStyle {
	const fromChain = chain.map((el) => {
		const s = readRunProps(child(el, "defRPr"), inh);
		if (!inh.inheritColor && el !== pPr) delete s.color;
		return s;
	});
	const fromRef: RunStyle = {
		fontFamily: inh.fontRef?.font === "major" ? inh.fonts.major : inh.fontRef?.font === "minor" ? inh.fonts.minor : undefined,
		color: inh.fontRef?.color,
	};
	const floor: RunStyle = { fontFamily: inh.fonts.minor, sizePt: 18 };
	if (inh.inheritColor) {
		// Say "not bold" outright: the renderer's box is bold for any title
		// placeholder, and an unset span would inherit that. Facet titles are
		// regular weight. Cells leave this open for the table style's bold.
		floor.bold = false;
		floor.italic = false;
		// tx1 through the colour map: the default text colour.
		const tx1 = parse(`<a:solidFill xmlns:a="${NS_A}"><a:schemeClr val="tx1"/></a:solidFill>`).documentElement;
		floor.color = resolveColorIn(tx1, inh.colors) ?? "#000000";
	}
	return mergeStyles(...fromChain, fromRef, floor);
}

function spacingPt(el: Element | null, sizePt: number): number | undefined {
	if (!el) return undefined;
	const pts = num(child(el, "spcPts"), "val");
	if (pts !== undefined) return pts / 100;
	const pct = num(child(el, "spcPct"), "val");
	if (pct !== undefined) return (pct / 100000) * sizePt * SINGLE_LINE;
	return undefined;
}

function roman(n: number): string {
	const map: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
	let out = "";
	for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
	return out;
}
function alpha(n: number): string {
	let out = "";
	while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
	return out;
}
function formatAutoNum(type: string, n: number): string {
	const lower = type.toLowerCase();
	let core = String(n);
	if (lower.startsWith("alphalc")) core = alpha(n);
	else if (lower.startsWith("alphauc")) core = alpha(n).toUpperCase();
	else if (lower.startsWith("romanlc")) core = roman(n);
	else if (lower.startsWith("romanuc")) core = roman(n).toUpperCase();
	if (lower.endsWith("parenboth")) return `(${core})`;
	if (lower.endsWith("parenr")) return `${core})`;
	if (lower.endsWith("plain")) return core;
	if (lower.endsWith("minus")) return `- ${core} -`;
	return `${core}.`;
}

function mapAlign(algn: string | undefined): ParagraphModel["align"] {
	if (algn === "ctr") return "center";
	if (algn === "r") return "right";
	if (algn === "just" || algn === "dist" || algn === "justLow") return "justify";
	return "left";
}

/** Read a <p:txBody> or <a:txBody> into the model. */
function readBody(txBody: Element, inh: ShapeInheritance, autofit: { fontScale: number; lnSpcReduction: number }): ParagraphModel[] {
	const paragraphs: ParagraphModel[] = [];
	// Auto-numbering counters per level; reset by a shallower paragraph.
	const counters: number[] = [];

	for (const p of Array.from(txBody.children).filter((c) => c.localName === "p")) {
		const pPr = child(p, "pPr");
		const level = Math.min(9, (num(pPr, "lvl") ?? 0) + 1);
		const chain = levelChain(inh, pPr, level);

		const base = baseRunStyle(chain, pPr, inh);
		const scale = (s: RunStyle): RunStyle =>
			s.sizePt !== undefined ? { ...s, sizePt: +(s.sizePt * autofit.fontScale).toFixed(2) } : s;
		const baseScaled = scale(base);
		const size = baseScaled.sizePt ?? 18;

		const runs: RunModel[] = [];
		for (const node of Array.from(p.children)) {
			if (node.localName === "r" || node.localName === "fld") {
				let t = child(node, "t")?.textContent ?? "";
				// The stored text of a slide-number field is whatever it was at
				// save time, often a literal "‹#›". PowerPoint shows the real one.
				if (node.localName === "fld" && node.getAttribute("type") === "slidenum" && inh.slideNumber) {
					t = String(inh.slideNumber);
				}
				if (!t) continue;
				const own = readRunProps(child(node, "rPr"), inh);
				// A hyperlink takes the theme's hyperlink colour and an underline.
				const link = child(child(node, "rPr"), "hlinkClick");
				const linkStyle: RunStyle = link && inh.hlink ? { color: inh.hlink, underline: "single" } : {};
				runs.push({ text: t, style: scale(mergeStyles(own, linkStyle, base)) });
			} else if (node.localName === "br") {
				runs.push({ text: "\n", style: scale(mergeStyles(readRunProps(child(node, "rPr"), inh), base)) });
			}
		}

		const endProps = readRunProps(child(p, "endParaRPr"), inh);
		const endSizePt = (endProps.sizePt ?? base.sizePt ?? 18) * autofit.fontScale;

		// Line spacing, reduced by autofit.
		const lnSpc = first(chain, (el) => child(el, "lnSpc") ?? undefined);
		let lineHeight: ParagraphModel["lineHeight"] = { multiple: SINGLE_LINE };
		const lnPct = num(child(lnSpc, "spcPct"), "val");
		const lnPts = num(child(lnSpc, "spcPts"), "val");
		if (lnPct !== undefined) lineHeight = { multiple: (lnPct / 100000) * SINGLE_LINE };
		else if (lnPts !== undefined) lineHeight = { pt: lnPts / 100 };
		if (autofit.lnSpcReduction > 0 && "multiple" in lineHeight) {
			lineHeight = { multiple: lineHeight.multiple * (1 - autofit.lnSpcReduction) };
		}

		const spaceBeforePt = first(chain, (el) => spacingPt(child(el, "spcBef"), size)) ?? 0;
		const spaceAfterPt = first(chain, (el) => spacingPt(child(el, "spcAft"), size)) ?? 0;

		const marL = first(chain, (el) => num(el, "marL")) ?? 0;
		const marR = first(chain, (el) => num(el, "marR")) ?? 0;
		// Default tab spacing; decks set it, commonly half an inch, in the
		// style chain. The spec default is one inch.
		const defTab = first(chain, (el) => num(el, "defTabSz")) ?? 914400;
		// The nearest source with a tab list wins, as with every other property.
		const tabLst = first(chain, (el) => child(el, "tabLst") ?? undefined);
		const tabStops = Array.from(tabLst?.children ?? [])
			.filter((t) => t.localName === "tab")
			.map((t) => (num(t, "pos") ?? 0) / EMU_PER_PX)
			.sort((a, b) => a - b);
		const indent = first(chain, (el) => num(el, "indent")) ?? 0;
		const algn = first(chain, (el) => el.getAttribute("algn") ?? undefined);

		// Bullets: the nearest source that says anything about bullets decides.
		let bullet: BulletModel | undefined;
		const hasText = runs.some((r) => r.text.trim() !== "");
		const bulletSource = first(chain, (el) =>
			child(el, "buNone") ? "none" : child(el, "buChar") ?? child(el, "buAutoNum") ?? child(el, "buBlip") ?? undefined
		);

		counters.length = level; // deeper counters reset when we come back up
		if (bulletSource && bulletSource !== "none" && hasText) {
			const firstRun = runs.find((r) => r.text.trim())?.style ?? baseScaled;
			const buFontEl = first(chain, (el) => child(el, "buFont") ?? (child(el, "buFontTx") ? "tx" : undefined));
			const buFace = buFontEl && buFontEl !== "tx" ? resolveTypeface(buFontEl.getAttribute("typeface") ?? undefined, inh.fonts) : undefined;
			const buClr = first(chain, (el) => child(el, "buClr") ?? (child(el, "buClrTx") ? "tx" : undefined));
			const color = buClr && buClr !== "tx" ? resolveColorIn(buClr, inh.colors) : firstRun.color;
			const pct = first(chain, (el) => num(child(el, "buSzPct"), "val"));
			const pts = first(chain, (el) => num(child(el, "buSzPts"), "val"));
			const runSize = firstRun.sizePt ?? size;
			const sizePt = pts !== undefined ? pts / 100 : pct !== undefined ? (runSize * pct) / 100000 : runSize;

			let text = "•";
			let fontFamily = buFace ? fontStack(buFace) : firstRun.fontFamily ? fontStack(firstRun.fontFamily) : undefined;
			if (bulletSource.localName === "buChar") {
				const glyph = bulletGlyph(bulletSource.getAttribute("char") ?? "•", buFace);
				text = glyph.char;
				// A mapped symbol-font glyph needs a Unicode font, not Wingdings.
				if (glyph.mapped) fontFamily = firstRun.fontFamily ? fontStack(firstRun.fontFamily) : undefined;
			} else if (bulletSource.localName === "buAutoNum") {
				const start = num(bulletSource, "startAt") ?? 1;
				counters[level - 1] = (counters[level - 1] ?? start - 1) + 1;
				text = formatAutoNum(bulletSource.getAttribute("type") ?? "arabicPeriod", counters[level - 1]);
				fontFamily = firstRun.fontFamily ? fontStack(firstRun.fontFamily) : undefined;
			}
			bullet = { text, fontFamily, color, sizePt };
		}

		paragraphs.push({
			align: mapAlign(algn),
			marginLeftPx: marL / EMU_PER_PX,
			marginRightPx: marR / EMU_PER_PX,
			tabSizePx: defTab / EMU_PER_PX,
			tabStopsPx: tabStops,
			indentPx: indent / EMU_PER_PX,
			lineHeight,
			spaceBeforePt: spaceBeforePt * autofit.fontScale,
			spaceAfterPt: spaceAfterPt * autofit.fontScale,
			bullet,
			runs,
			endSizePt,
			baseStyle: baseScaled,
		});
	}

	return paragraphs;
}

const DEFAULT_INSETS = { l: 91440, t: 45720, r: 91440, b: 45720 };

function readBodyProps(bodyPrs: Element[]): Pick<TextBodyModel, "insetsPx" | "anchor" | "wrap"> & {
	autofit: { fontScale: number; lnSpcReduction: number };
} {
	const pick = (attr: string) => first(bodyPrs, (el) => num(el, attr));
	const anchor = first(bodyPrs, (el) => el.getAttribute("anchor") ?? undefined);
	const wrap = first(bodyPrs, (el) => el.getAttribute("wrap") ?? undefined);
	const norm = first(bodyPrs, (el) => child(el, "normAutofit") ?? (child(el, "noAutofit") || child(el, "spAutoFit") ? "off" : undefined));
	const autofit =
		norm && norm !== "off"
			? {
					fontScale: (num(norm, "fontScale") ?? 100000) / 100000,
					lnSpcReduction: (num(norm, "lnSpcReduction") ?? 0) / 100000,
				}
			: { fontScale: 1, lnSpcReduction: 0 };

	return {
		insetsPx: {
			left: (pick("lIns") ?? DEFAULT_INSETS.l) / EMU_PER_PX,
			top: (pick("tIns") ?? DEFAULT_INSETS.t) / EMU_PER_PX,
			right: (pick("rIns") ?? DEFAULT_INSETS.r) / EMU_PER_PX,
			bottom: (pick("bIns") ?? DEFAULT_INSETS.b) / EMU_PER_PX,
		},
		anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
		wrap: wrap !== "none",
		autofit,
	};
}

/**
 * Every character in a body, whitespace stripped, as the renderer's box holds
 * it. That excludes field text, which the renderer drops.
 */
export function bodyKey(txBody: Element): string {
	let out = "";
	for (const t of descendants(txBody, NS_A, "t")) {
		if (t.parentElement?.localName === "fld") continue;
		out += t.textContent ?? "";
	}
	return out.replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Shape walking
// ---------------------------------------------------------------------------

interface Scope {
	master?: MasterInfo;
	layoutDoc?: Document | null;
	colors: ColorContext;
	defaultTextStyle: Element | null;
	slideNumber: number;
}

const LAYER = { master: 0, layout: 1, slide: 2 } as const;

/** A shape's box in px: its own transform, else its layout's, else its master's placeholder. */
function shapeRect(shape: Element, scope: Scope, level: "slide" | "layout" | "master"): TextBodyModel["rectPx"] {
	const withXfrm = (s: Element | null) => (s && child(child(s, "spPr"), "xfrm") ? s : null);
	const ph = placeholderOf(shape);
	const source =
		withXfrm(shape) ??
		(ph && level === "slide" ? withXfrm(findPlaceholder(scope.layoutDoc, ph, true)) : null) ??
		(ph && level !== "master" ? withXfrm(findPlaceholder(scope.master?.doc, ph, false)) : null);
	if (!source) return undefined;
	const tree = source.ownerDocument.getElementsByTagNameNS(NS_P, "spTree")[0];
	if (!tree) return undefined;
	const b = absoluteBox(source, tree);
	return { x: b.x / EMU_PER_PX, y: b.y / EMU_PER_PX, w: b.cx / EMU_PER_PX, h: b.cy / EMU_PER_PX };
}

function shapeInheritance(shape: Element, scope: Scope, level: "slide" | "layout" | "master"): {
	inh: ShapeInheritance;
	bodyPrs: Element[];
} {
	const master = scope.master;
	const fonts = master?.fonts ?? { major: "Calibri Light", minor: "Calibri" };
	const ph = placeholderOf(shape);
	const txBody = child(shape, "txBody");

	const lists: (Element | null)[] = [child(txBody, "lstStyle")];
	const bodyPrs: Element[] = [];
	const own = child(txBody, "bodyPr");
	if (own) bodyPrs.push(own);

	if (ph) {
		const layoutPh = level === "slide" ? findPlaceholder(scope.layoutDoc, ph, true) : null;
		const masterPh = level !== "master" ? findPlaceholder(master?.doc, ph, false) : null;
		for (const other of [layoutPh, masterPh]) {
			const body = child(other, "txBody");
			lists.push(child(body, "lstStyle"));
			const bp = child(body, "bodyPr");
			if (bp) bodyPrs.push(bp);
		}
	}
	lists.push(textStyleFor(styleFamily(ph), master));
	lists.push(scope.defaultTextStyle);

	// <p:style><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
	const fontRefEl = child(child(shape, "style"), "fontRef");
	const fontRef = fontRefEl
		? {
				font: fontRefEl.getAttribute("idx") === "major" ? ("major" as const) : fontRefEl.getAttribute("idx") === "minor" ? ("minor" as const) : undefined,
				color: resolveColorIn(fontRefEl, scope.colors),
			}
		: undefined;

	const hlinkSlot = scope.colors.theme.hlink;
	return {
		inh: {
			lists,
			bodyPrs,
			fontRef,
			colors: scope.colors,
			fonts,
			hlink: hlinkSlot,
			inheritColor: true,
			slideNumber: scope.slideNumber,
		},
		bodyPrs,
	};
}

function readShape(shape: Element, scope: Scope, level: "slide" | "layout" | "master"): TextBodyModel | null {
	const txBody = child(shape, "txBody");
	if (!txBody) return null;
	const key = bodyKey(txBody);
	const hasField = descendants(txBody, NS_A, "fld").some((f) => (child(f, "t")?.textContent ?? "").trim() !== "");
	if (!key && !hasField) return null;

	const { inh, bodyPrs } = shapeInheritance(shape, scope, level);
	const props = readBodyProps(bodyPrs);
	return {
		key,
		insetsPx: props.insetsPx,
		anchor: props.anchor,
		wrap: props.wrap,
		paragraphs: readBody(txBody, inh, props.autofit),
		rectPx: shapeRect(shape, scope, level),
		layer: LAYER[level],
		hasField,
	};
}

function readTables(doc: Document, scope: Scope): (TextBodyModel | null)[][][] {
	const inh: ShapeInheritance = {
		// PowerPoint table text draws on the presentation defaults, then the
		// table style. The renderer handles the table style on the <td>.
		lists: [scope.defaultTextStyle],
		bodyPrs: [],
		inheritColor: false,
		colors: scope.colors,
		fonts: scope.master?.fonts ?? { major: "Calibri Light", minor: "Calibri" },
		hlink: scope.colors.theme.hlink,
	};

	return descendants(doc, NS_A, "tbl").map((tbl) =>
		descendants(tbl, NS_A, "tr").map((tr) =>
			descendants(tr, NS_A, "tc").map((tc) => {
				const txBody = child(tc, "txBody");
				if (!txBody) return null;
				const tcPr = child(tc, "tcPr");
				const m = (attr: string, fallback: number) => (num(tcPr, attr) ?? fallback) / EMU_PER_PX;
				const anchor = tcPr?.getAttribute("anchor");
				return {
					key: bodyKey(txBody),
					insetsPx: { left: m("marL", 91440), top: m("marT", 45720), right: m("marR", 91440), bottom: m("marB", 45720) },
					anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
					wrap: true,
					paragraphs: readBody(txBody, inh, { fontScale: 1, lnSpcReduction: 0 }),
					layer: LAYER.slide,
					hasField: false,
				};
			})
		)
	);
}

function textShapes(doc: Document | null | undefined, skipPlaceholders: boolean): Element[] {
	if (!doc) return [];
	const tree = descendants(doc, NS_P, "spTree")[0];
	if (!tree) return [];
	return descendants(tree, NS_P, "sp").filter((s) => !(skipPlaceholders && placeholderOf(s)));
}

/**
 * For every slide, the text boxes and table cells, resolved. The empty array
 * on failure means "leave the renderer's output alone".
 */
export async function readSlideText(buffer: ArrayBuffer): Promise<SlideTextModel[]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const deck = new DeckContext(zip);
		await deck.init();
		const out: SlideTextModel[] = [];

		const paths = await slidePathsInOrder(zip);
		for (const [index, path] of paths.entries()) {
			const slide = await deck.slide(path);
			if (!slide) {
				out.push({ boxes: [], tables: [] });
				continue;
			}
			const master = slide.layout?.master;
			const override = readColorMap(
				descendants(slide.doc, NS_A, "overrideClrMapping")[0]
			);
			const colors: ColorContext = {
				theme: master?.theme ?? {},
				clrMap: override ?? master?.clrMap ?? DEFAULT_CLR_MAP,
			};
			const scope: Scope = {
				master,
				layoutDoc: slide.layout?.doc,
				colors,
				defaultTextStyle: deck.defaultTextStyle,
				slideNumber: index + 1,
			};

			const boxes: TextBodyModel[] = [];
			const add = (m: TextBodyModel | null) => m && boxes.push(m);
			for (const s of textShapes(slide.doc, false)) add(readShape(s, scope, "slide"));
			// The renderer also draws text that lives on the layout and master,
			// but never their placeholders.
			for (const s of textShapes(slide.layout?.doc, true)) add(readShape(s, scope, "layout"));
			for (const s of textShapes(master?.doc, true)) add(readShape(s, scope, "master"));

			out.push({ boxes, tables: readTables(slide.doc, scope) });
		}

		return out;
	} catch {
		return [];
	}
}

