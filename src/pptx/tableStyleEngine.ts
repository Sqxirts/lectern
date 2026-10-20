import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";
import { resolveColorIn, type ColorContext } from "./color";
import { NS_A, child, loadSlideParts, loadXml, parseXml, readThemeStyles, resolveFillRef, resolveLnRef, type ThemeStyles } from "./parts";
import { BUILTIN_TABLE_STYLES } from "./builtinTableStyles";

/**
 * PowerPoint table styles, applied cell by cell.
 *
 * The renderer's own table styling reads a style's base colours and drops
 * their modifiers, so Medium Style 2's bands (accent1 at 40% tint) paint as
 * full accent1, and a style the file only names by GUID gets an invented
 * Office 2007 look. A built-in style is named, not defined, in the file:
 * PowerPoint carries the definition. BUILTIN_TABLE_STYLES supplies the ones
 * our decks use.
 *
 * Regions are layered in PowerPoint's order, each overriding the last where
 * it says anything:
 *   wholeTbl, band1V/band2V, band1H/band2H, firstCol, lastCol, firstRow, lastRow
 * then the cell's own <a:tcPr> fill and borders on top.
 */

export interface CellStyle {
	/** CSS colour, or "transparent" for an explicit no-fill. Undefined: no opinion. */
	fill?: string;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	borders: { top?: string; right?: string; bottom?: string; left?: string };
}

type Edge = "top" | "right" | "bottom" | "left";

export interface StyledTable {
	/** CSS background for the whole table: a colour or a gradient. */
	background?: string;
	cells: CellStyle[][];
}

// ---------------------------------------------------------------------------
// Reading a style definition
// ---------------------------------------------------------------------------

/** A border edge: a direct <a:ln>, or an <a:lnRef> into the theme's line styles. */
function edgeCss(edge: Element | null, styles: ThemeStyles, colors: ColorContext): string | undefined {
	const ln = child(edge, "ln");
	if (ln) return lnCss(ln, colors);
	const ref = resolveLnRef(child(edge, "lnRef"), styles, colors);
	return ref ? `${ref.widthPx}px solid ${ref.color}` : undefined;
}

function lnCss(ln: Element | null, colors: ColorContext): string | undefined {
	if (!ln) return undefined;
	if (child(ln, "noFill")) return "none";
	const color = resolveColorIn(child(ln, "solidFill"), colors);
	if (!color) return undefined;
	const w = Number(ln.getAttribute("w") ?? 12700);
	return `${Math.max(0.75, +(w / 9525).toFixed(2))}px solid ${color}`;
}

interface Region {
	fill?: string;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	/** Outer edges of the region, and the lines between its cells. */
	edges: Partial<Record<Edge | "insideH" | "insideV", string>>;
}

function readRegion(el: Element | null, styles: ThemeStyles, colors: ColorContext): Region | null {
	if (!el) return null;
	const region: Region = { edges: {} };

	const tx = child(el, "tcTxStyle");
	if (tx) {
		const b = tx.getAttribute("b");
		if (b) region.bold = b === "on";
		const i = tx.getAttribute("i");
		if (i) region.italic = i === "on";
		// The text colour is a colour element directly under tcTxStyle; the
		// one inside fontRef is only a fallback for the font reference.
		const colorEl = Array.from(tx.children).find((c) => c.localName !== "fontRef" && c.localName !== "font");
		if (colorEl) {
			const wrapper = parseXml(`<w xmlns:a="${NS_A}"/>`).documentElement;
			wrapper.appendChild(colorEl.cloneNode(true));
			region.color = resolveColorIn(wrapper, colors);
		}
	}

	const tcStyle = child(el, "tcStyle");
	const fill = child(tcStyle, "fill");
	if (fill) {
		if (child(fill, "noFill")) region.fill = "transparent";
		else region.fill = resolveColorIn(child(fill, "solidFill"), colors);
	} else {
		const fillRef = child(tcStyle, "fillRef");
		if (fillRef) region.fill = resolveFillRef(fillRef, styles, colors);
	}

	const bdr = child(tcStyle, "tcBdr");
	for (const edge of ["left", "right", "top", "bottom", "insideH", "insideV"] as const) {
		const css = edgeCss(child(bdr, edge), styles, colors);
		if (css) region.edges[edge] = css;
	}

	return region;
}

// ---------------------------------------------------------------------------
// Layering
// ---------------------------------------------------------------------------

interface Flags {
	firstRow: boolean;
	lastRow: boolean;
	firstCol: boolean;
	lastCol: boolean;
	bandRow: boolean;
	bandCol: boolean;
}

/** The cells a region covers, as inclusive row and column ranges. */
interface Extent {
	r0: number;
	r1: number;
	c0: number;
	c1: number;
}

function layer(cell: CellStyle, region: Region | null, extent: Extent, r: number, c: number): void {
	if (!region) return;
	if (region.fill !== undefined) cell.fill = region.fill;
	if (region.color !== undefined) cell.color = region.color;
	if (region.bold !== undefined) cell.bold = region.bold;
	if (region.italic !== undefined) cell.italic = region.italic;

	// An edge on the region's boundary takes the boundary line; one inside it
	// takes the inside line.
	const pick = (outer: Edge, inner: "insideH" | "insideV", onBoundary: boolean) =>
		onBoundary ? region.edges[outer] : region.edges[inner];
	const top = pick("top", "insideH", r === extent.r0);
	const bottom = pick("bottom", "insideH", r === extent.r1);
	const left = pick("left", "insideV", c === extent.c0);
	const right = pick("right", "insideV", c === extent.c1);
	if (top) cell.borders.top = top;
	if (bottom) cell.borders.bottom = bottom;
	if (left) cell.borders.left = left;
	if (right) cell.borders.right = right;
}

function styleTable(tbl: Element, def: Element, styles: ThemeStyles, colors: ColorContext): StyledTable {
	const tblPr = child(tbl, "tblPr");
	const flag = (n: string) => tblPr?.getAttribute(n) === "1" || tblPr?.getAttribute(n) === "true";
	const f: Flags = {
		firstRow: flag("firstRow"),
		lastRow: flag("lastRow"),
		firstCol: flag("firstCol"),
		lastCol: flag("lastCol"),
		bandRow: flag("bandRow"),
		bandCol: flag("bandCol"),
	};

	const R = (name: string) => readRegion(child(def, name), styles, colors);
	const regions = {
		wholeTbl: R("wholeTbl"),
		band1H: R("band1H"),
		band2H: R("band2H"),
		band1V: R("band1V"),
		band2V: R("band2V"),
		firstRow: R("firstRow"),
		lastRow: R("lastRow"),
		firstCol: R("firstCol"),
		lastCol: R("lastCol"),
	};

	const rows = Array.from(tbl.children).filter((e) => e.localName === "tr");
	const nRows = rows.length;
	const nCols = Math.max(0, ...rows.map((tr) => Array.from(tr.children).filter((e) => e.localName === "tc").length));
	const lastR = nRows - 1;
	const lastC = nCols - 1;

	// The table's own background, behind every cell. Themed Style 1 puts a
	// theme gradient here and lays translucent bands over it.
	const bg = child(def, "tblBg");
	const background = bg ? resolveFillRef(child(bg, "fillRef"), styles, colors) : undefined;

	const cells = rows.map((tr, r) =>
		Array.from(tr.children)
			.filter((e) => e.localName === "tc")
			.map((tc, c) => {
				const cell: CellStyle = { borders: {} };
				layer(cell, regions.wholeTbl, { r0: 0, r1: lastR, c0: 0, c1: lastC }, r, c);

				// Bands skip the header and total rows or columns when those are on.
				const inBodyRow = !(f.firstRow && r === 0) && !(f.lastRow && r === lastR);
				const inBodyCol = !(f.firstCol && c === 0) && !(f.lastCol && c === lastC);
				if (f.bandCol && inBodyCol) {
					const band = (c - (f.firstCol ? 1 : 0)) % 2 === 0 ? regions.band1V : regions.band2V;
					layer(cell, band, { r0: 0, r1: lastR, c0: c, c1: c }, r, c);
				}
				if (f.bandRow && inBodyRow) {
					const band = (r - (f.firstRow ? 1 : 0)) % 2 === 0 ? regions.band1H : regions.band2H;
					layer(cell, band, { r0: r, r1: r, c0: 0, c1: lastC }, r, c);
				}
				if (f.firstCol && c === 0) layer(cell, regions.firstCol, { r0: 0, r1: lastR, c0: 0, c1: 0 }, r, c);
				if (f.lastCol && c === lastC) layer(cell, regions.lastCol, { r0: 0, r1: lastR, c0: lastC, c1: lastC }, r, c);
				if (f.firstRow && r === 0) layer(cell, regions.firstRow, { r0: 0, r1: 0, c0: 0, c1: lastC }, r, c);
				if (f.lastRow && r === lastR) layer(cell, regions.lastRow, { r0: lastR, r1: lastR, c0: 0, c1: lastC }, r, c);

				// The cell's own properties win over any style.
				const tcPr = child(tc, "tcPr");
				if (child(tcPr, "noFill")) cell.fill = "transparent";
				const own = resolveColorIn(child(tcPr, "solidFill"), colors);
				if (own) cell.fill = own;
				for (const [tag, edge] of [["lnT", "top"], ["lnR", "right"], ["lnB", "bottom"], ["lnL", "left"]] as const) {
					const css = lnCss(child(tcPr, tag), colors);
					if (css) cell.borders[edge] = css;
				}
				return cell;
			})
	);
	return { background, cells };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * For every slide, for every table in XML order: per-cell styles when the
 * table names a style we have a definition for, else null (leave it be).
 */
export async function readTableCellStyles(buffer: ArrayBuffer): Promise<(StyledTable | null)[][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const defs = new Map<string, Element>();

		const own = await loadXml(zip, "ppt/tableStyles.xml");
		for (const s of Array.from(own?.getElementsByTagNameNS(NS_A, "tblStyle") ?? [])) {
			const id = s.getAttribute("styleId");
			if (id) defs.set(id, s);
		}
		// Built-ins fill in only where the file has no definition of its own.
		for (const [id, xml] of Object.entries(BUILTIN_TABLE_STYLES)) {
			if (defs.has(id)) continue;
			const doc = parseXml(`<a:tblStyleLst xmlns:a="${NS_A}">${xml}</a:tblStyleLst>`);
			const s = doc.getElementsByTagNameNS(NS_A, "tblStyle")[0];
			if (s) defs.set(id, s);
		}

		const out: (StyledTable | null)[][] = [];
		for (const path of await slidePathsInOrder(zip)) {
			const { slide, theme, colors } = await loadSlideParts(zip, path);
			const styles = readThemeStyles(theme);
			const tables = Array.from(slide?.getElementsByTagNameNS(NS_A, "tbl") ?? []);
			out.push(
				tables.map((tbl) => {
					const id = child(child(tbl, "tblPr"), "tableStyleId")?.textContent?.trim();
					const def = id ? defs.get(id) : undefined;
					return def ? styleTable(tbl, def, styles, colors) : null;
				})
			);
		}
		return out;
	} catch {
		return [];
	}
}

export const STYLED_TABLE_CLASS = "lectern-table-styled";

/**
 * Paint resolved styles onto the renderer's cells. Positional, so it runs
 * before merges and skips any table whose shape disagrees with the XML.
 */
export function applyTableCellStyles(slide: HTMLElement, tables: (StyledTable | null)[] | undefined): number {
	if (!tables) return 0;
	const rendered = Array.from(slide.querySelectorAll("table"));
	let styled = 0;

	for (let t = 0; t < Math.min(rendered.length, tables.length); t++) {
		const styledTable = tables[t];
		if (!styledTable) continue;
		const expected = styledTable.cells;
		const table = rendered[t];
		const rows = Array.from(table.rows);
		if (rows.length !== expected.length) continue;
		if (!rows.every((row, r) => row.cells.length === expected[r].length)) continue;

		// The renderer's own guess at a table background and header weight.
		table.style.background = styledTable.background ?? "transparent";
		for (const row of rows) row.style.removeProperty("font-weight");
		table.classList.add(STYLED_TABLE_CLASS);

		rows.forEach((row, r) => {
			Array.from(row.cells).forEach((cell, c) => {
				const s = expected[r][c];
				// "background", not "background-color": a fill can be a gradient.
				cell.style.background = s.fill ?? "transparent";
				if (s.color) cell.style.color = s.color;
				cell.style.fontWeight = s.bold ? "bold" : "normal";
				cell.style.fontStyle = s.italic ? "italic" : "normal";
				for (const edge of ["top", "right", "bottom", "left"] as const) {
					const prop = `border-${edge}`;
					const v = s.borders[edge];
					cell.style.setProperty(prop, v && v !== "none" ? v : "none");
				}
				styled++;
			});
		});
	}

	return styled;
}
