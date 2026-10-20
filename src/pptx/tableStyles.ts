import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

/**
 * Work out which tables have a style at all.
 *
 * PowerPoint's built-in table styles live inside PowerPoint, not in the .pptx.
 * A deck that uses one stores only its GUID in `<a:tableStyleId>`. The `def`
 * attribute on `<a:tblStyleLst>` is not a style applied to anything: it names
 * the style PowerPoint will give the *next* table somebody creates.
 *
 * So a table with no `<a:tableStyleId>` has no style, and PowerPoint draws it
 * plain: no fills, no banding, a thin grid (CYBR 226 week 3 slide 5). A table
 * that names a GUID the file does not define is *not* plain: PowerPoint knows
 * the built-in and draws it fully styled (CYBR 310 week 1 slide 22, Themed
 * Style 1). An earlier version wiped those to a grid too. tableStyleEngine
 * paints the styled ones.
 *
 * `@jvmr/pptx-to-html` paints every table with an invented Office 2007 look.
 * Marking the truly unstyled ones lets the stylesheet put them back to the
 * plain grid the deck asked for.
 */

/** For every slide, one flag per table in document order: true when it names any style. */
export async function readTableStyleSupport(buffer: ArrayBuffer): Promise<boolean[][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const paths = await slidePathsInOrder(zip);
		const perSlide: boolean[][] = [];

		for (const path of paths) {
			const file = zip.file(path);
			if (!file) {
				perSlide.push([]);
				continue;
			}
			const doc = new DOMParser().parseFromString(await file.async("text"), "application/xml");
			const tbls = doc.getElementsByTagNameNS(NS_A, "tbl");
			const flags: boolean[] = [];
			for (let t = 0; t < tbls.length; t++) {
				const id = tbls[t].getElementsByTagNameNS(NS_A, "tableStyleId")[0]?.textContent?.trim();
				flags.push(Boolean(id));
			}
			perSlide.push(flags);
		}

		return perSlide;
	} catch {
		return [];
	}
}

/**
 * A fill the deck set on one cell directly, in that cell's own `<a:tcPr>`.
 *
 * A CSS colour for an `<a:srgbClr>`, KEEP_RENDERER_FILL for any other solid
 * fill (a theme colour we cannot resolve here, so the renderer's guess stands),
 * or null when the cell sets no fill of its own.
 */
export type CellFill = string | null;
export const KEEP_RENDERER_FILL = "keep";

/** The solid fill set directly on a cell, ignoring the ones inside its borders. */
function cellFill(tc: Element): CellFill {
	const tcPr = Array.from(tc.children).find((el) => el.localName === "tcPr");
	if (!tcPr) return null;

	// Only a direct child counts. The <a:solidFill> inside <a:lnL> and friends
	// is the border colour, and every cell in these decks has four of them.
	const fill = Array.from(tcPr.children).find((el) => el.localName === "solidFill");
	if (!fill) return null;

	const srgb = Array.from(fill.children).find((el) => el.localName === "srgbClr");
	const hex = srgb?.getAttribute("val");
	if (hex && /^[0-9A-Fa-f]{6}$/.test(hex)) return `#${hex}`;
	return KEEP_RENDERER_FILL;
}

/**
 * For every slide, for every table, the explicit fill of each cell by row and
 * column, in XML order. Merge continuations are included, so this lines up
 * with the renderer's output before applyTableMerges removes anything.
 */
export async function readCellFills(buffer: ArrayBuffer): Promise<CellFill[][][][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const paths = await slidePathsInOrder(zip);
		const perSlide: CellFill[][][][] = [];

		for (const path of paths) {
			const file = zip.file(path);
			if (!file) {
				perSlide.push([]);
				continue;
			}

			const doc = new DOMParser().parseFromString(await file.async("text"), "application/xml");
			const tbls = Array.from(doc.getElementsByTagNameNS(NS_A, "tbl"));
			perSlide.push(
				tbls.map((tbl) =>
					Array.from(tbl.getElementsByTagNameNS(NS_A, "tr")).map((tr) =>
						Array.from(tr.getElementsByTagNameNS(NS_A, "tc")).map(cellFill)
					)
				)
			);
		}

		return perSlide;
	} catch {
		return [];
	}
}

/** Class marking a table whose style the deck never defined. */
export const UNSTYLED_TABLE_CLASS = "lectern-table-unstyled";

/** Class marking a cell whose fill the deck set directly, so it survives the reset. */
export const FILLED_CELL_CLASS = "lectern-cell-filled";

/**
 * Put back the fills a deck set directly on individual cells.
 *
 * The unstyled-table reset strips every cell background, which is right for
 * the header the renderer invents and wrong for a cell the deck painted
 * itself. CYBR 226 week 5 slide 11 is the case: a navy header row with white
 * text, which the reset turned into white text on white.
 *
 * Must run before applyTableMerges, while cells still map 1:1 to <a:tc>.
 * A table whose shape disagrees with the XML is skipped, the same guard the
 * merge pass uses. Returns how many cells were marked.
 */
export function applyCellFills(slide: HTMLElement, tables: CellFill[][][]): number {
	const rendered = Array.from(slide.querySelectorAll("table"));
	let marked = 0;

	for (let t = 0; t < Math.min(rendered.length, tables.length); t++) {
		const expected = tables[t];
		const rows = Array.from(rendered[t].rows);

		if (rows.length !== expected.length) continue;
		if (!rows.every((row, r) => row.cells.length === expected[r].length)) continue;

		rows.forEach((row, r) => {
			Array.from(row.cells).forEach((cell, c) => {
				const fill = expected[r][c];
				if (fill === null) return;
				cell.classList.add(FILLED_CELL_CLASS);
				if (fill !== KEEP_RENDERER_FILL) cell.style.backgroundColor = fill;
				marked++;
			});
		});
	}

	return marked;
}

/**
 * Tag every table on this slide whose style the file does not define.
 *
 * Tables are matched positionally against the XML, the same assumption
 * applyTableMerges makes. Returns how many were tagged.
 */
export function markUnstyledTables(slide: HTMLElement, resolved: boolean[]): number {
	const tables = Array.from(slide.querySelectorAll("table"));
	let marked = 0;

	for (let t = 0; t < Math.min(tables.length, resolved.length); t++) {
		if (resolved[t]) continue;
		tables[t].classList.add(UNSTYLED_TABLE_CLASS);
		marked++;
	}

	return marked;
}
