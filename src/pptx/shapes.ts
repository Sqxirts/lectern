import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";
import { resolveColorIn, type ColorContext } from "./color";
import { NS_P, child, loadSlideParts } from "./parts";

/**
 * Shapes the renderer cannot draw, redrawn as SVG from the XML.
 *
 * `@jvmr/pptx-to-html` has no custom geometry at all: every freeform
 * (<a:custGeom>) comes out as a filled rectangle of its bounding box. It also
 * ignores fill transparency (<a:alpha>) and preset adjustments, so a triangle
 * whose apex the deck put at the right edge is drawn centred. The CYBR 310
 * decks use PowerPoint's Facet theme, whose side artwork is exactly this:
 * translucent freeform panels over a right-angled triangle. It rendered as
 * three opaque green blocks covering a fifth of every slide.
 *
 * This reads each shape's geometry, fill, outline and transform, and swaps
 * the renderer's element for an SVG in the same box at the same z-order.
 */

const EMU_PER_PX = 9525;

export interface PathModel {
	/** SVG path data in the path's own coordinate space. */
	d: string;
	w: number;
	h: number;
	fill: boolean;
	stroke: boolean;
}

export interface GradientModel {
	angleDeg: number;
	stops: { offset: number; color: string }[];
}

export interface ShapeArtModel {
	rectPx: { x: number; y: number; w: number; h: number };
	rotationDeg: number;
	flipH: boolean;
	flipV: boolean;
	paths: PathModel[];
	fill: string | GradientModel | null;
	stroke: { color: string; widthPx: number } | null;
	/**
	 * Set for straight lines and connectors, drawn in pixel space from one
	 * corner of the box to the other. The renderer draws these as a filled
	 * rectangle of the bounding box, which is only right when the line is
	 * perfectly flat; a diagonal one became a solid block (CYBR 310 Facet).
	 */
	line?: { x1: number; y1: number; x2: number; y2: number; head: boolean; tail: boolean };
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function num(el: Element | null | undefined, attr: string, fallback = 0): number {
	const n = Number(el?.getAttribute(attr));
	return Number.isFinite(n) && el?.hasAttribute(attr) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Transforms: the same arithmetic as the renderer's getAbsoluteTransform, so
// the boxes we compute land on the boxes it drew.
// ---------------------------------------------------------------------------

function readXfrm(node: Element) {
	const xfrm = node.getElementsByTagNameNS("*", "xfrm")[0] ?? null;
	const off = child(xfrm, "off");
	const ext = child(xfrm, "ext");
	const chOff = child(xfrm, "chOff");
	const chExt = child(xfrm, "chExt");
	return {
		x: num(off, "x"),
		y: num(off, "y"),
		cx: ext ? num(ext, "cx") : 1e6,
		cy: ext ? num(ext, "cy") : 5e5,
		chX: num(chOff, "x"),
		chY: num(chOff, "y"),
		chCx: num(chExt, "cx"),
		chCy: num(chExt, "cy"),
		rot: num(xfrm, "rot") / 60000,
		flipH: xfrm?.getAttribute("flipH") === "1",
		flipV: xfrm?.getAttribute("flipV") === "1",
	};
}

export function absoluteBox(shape: Element, spTree: Element) {
	const own = readXfrm(shape);
	let { x, y, cx, cy } = own;
	let rot = own.rot;
	let parent = shape.parentElement;
	while (parent && parent !== spTree) {
		if (parent.localName === "grpSp") {
			const g = readXfrm(parent);
			const sx = g.chCx > 0 ? g.cx / g.chCx : 1;
			const sy = g.chCy > 0 ? g.cy / g.chCy : 1;
			x = g.x + (x - g.chX) * sx;
			y = g.y + (y - g.chY) * sy;
			cx *= sx;
			cy *= sy;
			rot += g.rot;
		}
		parent = parent.parentElement;
	}
	return { x, y, cx, cy, rot, flipH: own.flipH, flipV: own.flipV };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const fmt = (n: number) => +n.toFixed(2);

/** One <a:path> as SVG path data. */
function customPath(path: Element, fallbackW: number, fallbackH: number): PathModel {
	const w = num(path, "w", fallbackW) || fallbackW;
	const h = num(path, "h", fallbackH) || fallbackH;
	const parts: string[] = [];
	let cur = { x: 0, y: 0 };

	const pt = (el: Element) => ({ x: num(el, "x"), y: num(el, "y") });
	const pts = (el: Element) => Array.from(el.children).filter((c) => c.localName === "pt").map(pt);

	for (const cmd of Array.from(path.children)) {
		switch (cmd.localName) {
			case "moveTo": {
				cur = pts(cmd)[0] ?? cur;
				parts.push(`M${fmt(cur.x)} ${fmt(cur.y)}`);
				break;
			}
			case "lnTo": {
				cur = pts(cmd)[0] ?? cur;
				parts.push(`L${fmt(cur.x)} ${fmt(cur.y)}`);
				break;
			}
			case "cubicBezTo": {
				const [a, b, c] = pts(cmd);
				if (a && b && c) {
					parts.push(`C${fmt(a.x)} ${fmt(a.y)} ${fmt(b.x)} ${fmt(b.y)} ${fmt(c.x)} ${fmt(c.y)}`);
					cur = c;
				}
				break;
			}
			case "quadBezTo": {
				const [a, b] = pts(cmd);
				if (a && b) {
					parts.push(`Q${fmt(a.x)} ${fmt(a.y)} ${fmt(b.x)} ${fmt(b.y)}`);
					cur = b;
				}
				break;
			}
			case "arcTo": {
				// DrawingML arcs are given by radii and angles from the current
				// point; SVG wants the end point. The angles are visual angles
				// on the ellipse, so convert to the parametric angle first.
				const wR = num(cmd, "wR");
				const hR = num(cmd, "hR");
				const st = (num(cmd, "stAng") / 60000) * (Math.PI / 180);
				const sw = (num(cmd, "swAng") / 60000) * (Math.PI / 180);
				if (!wR || !hR) break;
				const param = (a: number) => Math.atan2(wR * Math.sin(a), hR * Math.cos(a));
				const t0 = param(st);
				const t1 = param(st + sw);
				const cx = cur.x - wR * Math.cos(t0);
				const cy = cur.y - hR * Math.sin(t0);
				const end = { x: cx + wR * Math.cos(t1), y: cy + hR * Math.sin(t1) };
				const large = Math.abs(sw) > Math.PI ? 1 : 0;
				const sweep = sw > 0 ? 1 : 0;
				parts.push(`A${fmt(wR)} ${fmt(hR)} 0 ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`);
				cur = end;
				break;
			}
			case "close":
				parts.push("Z");
				break;
		}
	}

	return {
		d: parts.join(" "),
		w,
		h,
		fill: path.getAttribute("fill") !== "none",
		stroke: path.getAttribute("stroke") !== "0" && path.getAttribute("stroke") !== "false",
	};
}

/** Adjust value from <a:avLst>, as a fraction of 100000. */
function adj(prstGeom: Element, name: string, fallback: number): number {
	const gd = Array.from(child(prstGeom, "avLst")?.children ?? []).find((g) => g.getAttribute("name") === name);
	const m = gd?.getAttribute("fmla")?.match(/^val\s+(-?\d+)/);
	return m ? Number(m[1]) / 100000 : fallback;
}

/**
 * The presets whose shape the renderer gets wrong or not at all, drawn in a
 * 100x100 box. Anything else is left to the renderer.
 */
function presetPath(prstGeom: Element, w: number, h: number): PathModel | null {
	const prst = prstGeom.getAttribute("prst") ?? "";
	const W = 100;
	const H = 100;
	let d: string | null = null;

	switch (prst) {
		case "triangle": {
			const a = Math.min(1, Math.max(0, adj(prstGeom, "adj", 0.5)));
			d = `M${fmt(a * W)} 0 L${W} ${H} L0 ${H} Z`;
			break;
		}
		case "rtTriangle":
			d = `M0 0 L${W} ${H} L0 ${H} Z`;
			break;
		case "rect":
			d = `M0 0 L${W} 0 L${W} ${H} L0 ${H} Z`;
			break;
		case "diamond":
			d = `M${W / 2} 0 L${W} ${H / 2} L${W / 2} ${H} L0 ${H / 2} Z`;
			break;
		case "ellipse":
			d = `M0 ${H / 2} A${W / 2} ${H / 2} 0 1 1 ${W} ${H / 2} A${W / 2} ${H / 2} 0 1 1 0 ${H / 2} Z`;
			break;
		case "parallelogram": {
			// The adjust is a fraction of the *shorter* side, per the spec.
			const off = (Math.min(w, h) * adj(prstGeom, "adj", 0.25) / w) * W;
			d = `M${fmt(off)} 0 L${W} 0 L${fmt(W - off)} ${H} L0 ${H} Z`;
			break;
		}
		case "trapezoid": {
			const off = (Math.min(w, h) * adj(prstGeom, "adj", 0.25) / w) * W;
			d = `M${fmt(off)} 0 L${fmt(W - off)} 0 L${W} ${H} L0 ${H} Z`;
			break;
		}
		case "rightArrow":
		case "leftArrow":
		case "upArrow":
		case "downArrow": {
			// Block arrows, per the preset definitions: adj1 is the shaft's
			// thickness as a fraction of the cross dimension, adj2 the head's
			// length as a fraction of the *shorter* side. The renderer drew
			// these at a fixed near-square size, so a long labelled arrow came
			// out stubby with its white label on the white slide (CYBR 310
			// week 3 slides 11-19).
			const horizontal = prst === "rightArrow" || prst === "leftArrow";
			const along = horizontal ? w : h;
			const ss = Math.min(w, h);
			const shaft = Math.min(1, Math.max(0, adj(prstGeom, "adj1", 0.5)));
			const head = Math.min((adj(prstGeom, "adj2", 0.5) * ss) / along, 1);
			// Built pointing right in a 100x100 box, then turned to face.
			const x1 = fmt(W * (1 - head));
			const y1 = fmt((H * (1 - shaft)) / 2);
			const y2 = fmt(H - (H * (1 - shaft)) / 2);
			const pts: [number, number][] = [[0, y1], [x1, y1], [x1, 0], [W, H / 2], [x1, H], [x1, y2], [0, y2]];
			const turned = pts.map(([x, y]): [number, number] => {
				if (prst === "rightArrow") return [x, y];
				if (prst === "leftArrow") return [W - x, y];
				// Vertical arrows: swap axes so "along" runs down the box.
				return prst === "downArrow" ? [y, x] : [y, H - x];
			});
			d = `M${turned.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" L")} Z`;
			break;
		}
	}

	return d ? { d, w: W, h: H, fill: true, stroke: true } : null;
}

// ---------------------------------------------------------------------------
// Fill and outline
// ---------------------------------------------------------------------------

function readFill(spPr: Element | null, styleEl: Element | null, colors: ColorContext): ShapeArtModel["fill"] {
	if (child(spPr, "noFill")) return null;
	const solid = child(spPr, "solidFill");
	if (solid) return resolveColorIn(solid, colors) ?? null;

	const grad = child(spPr, "gradFill");
	if (grad) {
		const stops = Array.from(child(grad, "gsLst")?.children ?? [])
			.map((gs) => ({ offset: num(gs, "pos") / 100000, color: resolveColorIn(gs, colors) }))
			.filter((s): s is { offset: number; color: string } => Boolean(s.color));
		const lin = child(grad, "lin");
		if (stops.length) return { angleDeg: num(lin, "ang") / 60000, stops };
	}

	// No fill of its own: the theme style reference supplies one, unless idx 0.
	const fillRef = child(styleEl, "fillRef");
	if (fillRef && num(fillRef, "idx") > 0 && !spPr?.querySelector("*|blipFill, *|pattFill, *|grpFill")) {
		return resolveColorIn(fillRef, colors) ?? null;
	}
	return null;
}

function readStroke(spPr: Element | null, styleEl: Element | null, colors: ColorContext): ShapeArtModel["stroke"] {
	const ln = child(spPr, "ln");
	if (child(ln, "noFill")) return null;
	const widthPx = Math.max(0.75, num(ln, "w", 9525) / EMU_PER_PX);
	const own = resolveColorIn(child(ln, "solidFill"), colors);
	if (own) return { color: own, widthPx };

	const lnRef = child(styleEl, "lnRef");
	if (lnRef && num(lnRef, "idx") > 0) {
		const color = resolveColorIn(lnRef, colors);
		if (color) return { color, widthPx };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readShape(shape: Element, spTree: Element, colors: ColorContext): ShapeArtModel | null {
	const spPr = child(shape, "spPr");
	if (!spPr) return null;
	// Picture, pattern and group fills stay with the renderer: redrawing
	// without them would erase the picture.
	if (child(spPr, "blipFill") || child(spPr, "pattFill") || child(spPr, "grpFill")) return null;
	const box = absoluteBox(shape, spTree);
	const wPx = box.cx / EMU_PER_PX;
	const hPx = box.cy / EMU_PER_PX;

	const styleEl = child(shape, "style");
	const prst = child(spPr, "prstGeom");
	const prstName = prst?.getAttribute("prst") ?? "";

	if (prstName === "line" || prstName.startsWith("straightConnector")) {
		const stroke = readStroke(spPr, styleEl, colors);
		if (!stroke) return null;
		const ln = child(spPr, "ln");
		const arrow = (name: string) => {
			const t = child(ln, name)?.getAttribute("type");
			return Boolean(t && t !== "none");
		};
		// Flips pick which diagonal of the box the line runs along.
		const x1 = box.flipH ? wPx : 0;
		const x2 = box.flipH ? 0 : wPx;
		const y1 = box.flipV ? hPx : 0;
		const y2 = box.flipV ? 0 : hPx;
		return {
			rectPx: { x: box.x / EMU_PER_PX, y: box.y / EMU_PER_PX, w: wPx, h: hPx },
			rotationDeg: box.rot,
			flipH: false,
			flipV: false,
			paths: [],
			fill: null,
			stroke,
			line: { x1, y1, x2, y2, head: arrow("headEnd"), tail: arrow("tailEnd") },
		};
	}

	let paths: PathModel[] | null = null;
	const cust = child(spPr, "custGeom");
	if (cust) {
		paths = Array.from(child(cust, "pathLst")?.children ?? [])
			.filter((p) => p.localName === "path")
			.map((p) => customPath(p, box.cx, box.cy));
	} else if (prst) {
		const p = presetPath(prst, box.cx, box.cy);
		paths = p ? [p] : null;
	}
	if (!paths || !paths.length) return null;

	return {
		rectPx: { x: box.x / EMU_PER_PX, y: box.y / EMU_PER_PX, w: wPx, h: hPx },
		rotationDeg: box.rot,
		flipH: box.flipH,
		flipV: box.flipV,
		paths,
		fill: readFill(spPr, styleEl, colors),
		stroke: readStroke(spPr, styleEl, colors),
	};
}

function isPlaceholder(shape: Element): boolean {
	return Boolean(shape.getElementsByTagNameNS(NS_P, "ph")[0]);
}

function readTree(doc: Document | null, colors: ColorContext, skipPlaceholders: boolean): ShapeArtModel[] {
	const tree = doc?.getElementsByTagNameNS(NS_P, "spTree")[0];
	if (!tree) return [];
	// Shapes and connectors, in document order so matching follows z-order.
	return Array.from(tree.getElementsByTagName("*"))
		.filter((e) => e.namespaceURI === NS_P && (e.localName === "sp" || e.localName === "cxnSp"))
		.filter((s) => !(skipPlaceholders && isPlaceholder(s)))
		.map((s) => readShape(s, tree, colors))
		.filter((m): m is ShapeArtModel => m !== null);
}

/** Per slide: the shapes to redraw, from the slide, its layout and its master. */
export async function readShapeArt(buffer: ArrayBuffer): Promise<ShapeArtModel[][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const out: ShapeArtModel[][] = [];
		for (const path of await slidePathsInOrder(zip)) {
			const { slide, layout, master, colors } = await loadSlideParts(zip, path);
			out.push([...readTree(slide, colors, false), ...readTree(layout, colors, true), ...readTree(master, colors, true)]);
		}
		return out;
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
const TOLERANCE_PX = 0.6;

function boxOf(el: HTMLElement | SVGElement) {
	const s = el.style;
	return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
}

function sameBox(a: ReturnType<typeof boxOf>, b: ShapeArtModel["rectPx"]): boolean {
	return (
		Math.abs(a.x - b.x) < TOLERANCE_PX &&
		Math.abs(a.y - b.y) < TOLERANCE_PX &&
		Math.abs(a.w - b.w) < TOLERANCE_PX &&
		Math.abs(a.h - b.h) < TOLERANCE_PX
	);
}

let gradientSeq = 0;

function buildLineSvg(art: ShapeArtModel, line: NonNullable<ShapeArtModel["line"]>, zIndex: string): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	const { x, y, w, h } = art.rectPx;
	// At least 1px each way, so the collapsed-shape pass leaves it alone and
	// the browser still lays it out; the stroke overflows the box anyway.
	const bw = Math.max(w, 1);
	const bh = Math.max(h, 1);
	svg.setAttribute("viewBox", `0 0 ${fmt(bw)} ${fmt(bh)}`);
	svg.classList.add("lectern-shape");
	Object.assign(svg.style, {
		position: "absolute",
		left: `${x}px`,
		top: `${y}px`,
		width: `${bw}px`,
		height: `${bh}px`,
		zIndex,
		overflow: "visible",
	});
	if (art.rotationDeg) {
		svg.style.transform = `rotate(${art.rotationDeg}deg)`;
		svg.classList.add("lectern-transformed");
	}

	const stroke = art.stroke!;
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", `M${fmt(line.x1)} ${fmt(line.y1)} L${fmt(line.x2)} ${fmt(line.y2)}`);
	path.setAttribute("stroke", stroke.color);
	path.setAttribute("stroke-width", String(stroke.widthPx));
	path.setAttribute("fill", "none");

	if (line.head || line.tail) {
		const id = `vs-arrow-${++gradientSeq}`;
		const defs = document.createElementNS(SVG_NS, "defs");
		const marker = document.createElementNS(SVG_NS, "marker");
		marker.id = id;
		for (const [k, v] of Object.entries({
			markerUnits: "strokeWidth",
			markerWidth: "4",
			markerHeight: "4",
			refX: "2",
			refY: "2",
			orient: "auto-start-reverse",
		})) marker.setAttribute(k, v);
		const tip = document.createElementNS(SVG_NS, "polygon");
		tip.setAttribute("points", "0,0 4,2 0,4");
		tip.setAttribute("fill", stroke.color);
		marker.appendChild(tip);
		defs.appendChild(marker);
		svg.appendChild(defs);
		// DrawingML head is the start of the line, tail the end.
		if (line.head) path.setAttribute("marker-start", `url(#${id})`);
		if (line.tail) path.setAttribute("marker-end", `url(#${id})`);
	}

	svg.appendChild(path);
	return svg;
}

function buildSvg(art: ShapeArtModel, zIndex: string): SVGSVGElement {
	if (art.line) return buildLineSvg(art, art.line, zIndex);
	const svg = document.createElementNS(SVG_NS, "svg");
	const { x, y, w, h } = art.rectPx;
	svg.setAttribute("viewBox", `0 0 ${fmt(Math.max(w, 0.01))} ${fmt(Math.max(h, 0.01))}`);
	svg.setAttribute("preserveAspectRatio", "none");
	svg.classList.add("lectern-shape");
	Object.assign(svg.style, {
		position: "absolute",
		left: `${x}px`,
		top: `${y}px`,
		width: `${w}px`,
		height: `${h}px`,
		zIndex,
		overflow: "visible",
	});
	const transforms: string[] = [];
	if (art.rotationDeg) transforms.push(`rotate(${art.rotationDeg}deg)`);
	if (art.flipH) transforms.push("scaleX(-1)");
	if (art.flipV) transforms.push("scaleY(-1)");
	if (transforms.length) {
		svg.style.transform = transforms.join(" ");
		svg.classList.add("lectern-transformed");
	}

	let fillValue = "none";
	if (typeof art.fill === "string") {
		fillValue = art.fill;
	} else if (art.fill) {
		const id = `vs-grad-${++gradientSeq}`;
		const defs = document.createElementNS(SVG_NS, "defs");
		const grad = document.createElementNS(SVG_NS, "linearGradient");
		grad.id = id;
		// DrawingML measures the angle clockwise from the x axis.
		const rad = (art.fill.angleDeg * Math.PI) / 180;
		grad.setAttribute("x1", `${fmt(50 - Math.cos(rad) * 50)}%`);
		grad.setAttribute("y1", `${fmt(50 - Math.sin(rad) * 50)}%`);
		grad.setAttribute("x2", `${fmt(50 + Math.cos(rad) * 50)}%`);
		grad.setAttribute("y2", `${fmt(50 + Math.sin(rad) * 50)}%`);
		for (const s of art.fill.stops) {
			const stop = document.createElementNS(SVG_NS, "stop");
			stop.setAttribute("offset", String(s.offset));
			stop.setAttribute("stop-color", s.color);
			grad.appendChild(stop);
		}
		defs.appendChild(grad);
		svg.appendChild(defs);
		fillValue = `url(#${id})`;
	}

	for (const p of art.paths) {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", p.d);
		// Each path has its own coordinate space; stretch it onto the box.
		path.setAttribute("transform", `scale(${w / (p.w || 1)} ${h / (p.h || 1)})`);
		path.setAttribute("fill", p.fill ? fillValue : "none");
		if (p.stroke && art.stroke) {
			path.setAttribute("stroke", art.stroke.color);
			path.setAttribute("stroke-width", String(art.stroke.widthPx));
			path.setAttribute("vector-effect", "non-scaling-stroke");
		} else {
			path.setAttribute("stroke", "none");
		}
		svg.appendChild(path);
	}

	return svg;
}

/** Shape elements the renderer drew: absolutely placed, holding no text, table or picture. */
function renderedShapes(slide: HTMLElement): (HTMLElement | SVGElement)[] {
	const candidates = Array.from(slide.querySelectorAll<HTMLElement | SVGElement>("div, svg"));
	return candidates.filter(
		(el) =>
			el.style.position === "absolute" &&
			!(el.textContent ?? "").trim() &&
			!el.querySelector("img, table") &&
			!el.classList.contains("lectern-shape") &&
			el.style.zIndex !== "-1"
	);
}

/** Swap the renderer's shape elements for correct SVG. Returns how many were redrawn. */
export function applyShapeArt(slide: HTMLElement, arts: ShapeArtModel[] | undefined): number {
	if (!arts?.length) return 0;
	const pool = renderedShapes(slide);
	const used = new Set<Element>();
	let redrawn = 0;

	for (const art of arts) {
		const match = pool.find((el) => !used.has(el) && sameBox(boxOf(el), art.rectPx));
		if (!match) continue;
		used.add(match);
		match.replaceWith(buildSvg(art, match.style.zIndex));
		redrawn++;
	}

	return redrawn;
}
