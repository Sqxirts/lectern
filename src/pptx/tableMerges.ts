import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

/**
 * Put merged table cells back together.
 *
 * `@jvmr/pptx-to-html` emits one <td> per <a:tc> and no rowspan or colspan at
 * all, so a merged region renders as its top-left cell followed by blanks. On
 * CYBR 226 week 3 slide 5 that turns a pinout table into one that looks like
 * pins 2, 5 and 8 have no pair assigned, which is worse than ugly: it reads as
 * a fact, and the fact is wrong.
 *
 * DrawingML describes a merge on every cell it covers, not just the anchor:
 *
 *   anchor      gridSpan="2" rowSpan="2"   the cell that survives
 *   to its right  hMerge="1"               continuation, not drawn
 *   below it      vMerge="1"               continuation, not drawn
 *
 * So the rule is: drop every continuation, and give each anchor its spans.
 */

export interface CellMerge {
	colSpan: number;
	rowSpan: number;
	/** A cell swallowed by a merge to its left or above. Not drawn. */
	continuation: boolean;
}

/** One table, as rows of cells, in document order including continuations. */
export type TableMerges = CellMerge[][];

function cellMerge(tc: Element): CellMerge {
	const span = (name: string): number => {
		const raw = tc.getAttribute(name);
		const value = raw ? Number.parseInt(raw, 10) : 1;
		return Number.isFinite(value) && value > 1 ? value : 1;
	};

	// Both attributes are "1"/"0" or "true"/"false" depending on the producer.
	const flag = (name: string): boolean => {
		const raw = tc.getAttribute(name);
		return raw === "1" || raw === "true";
	};

	return {
		colSpan: span("gridSpan"),
		rowSpan: span("rowSpan"),
		continuation: flag("hMerge") || flag("vMerge"),
	};
}

/** Every table on one slide, in document order. */
export function tablesInSlide(doc: Document): TableMerges[] {
	const tables: TableMerges[] = [];

	const tbls = doc.getElementsByTagNameNS(NS_A, "tbl");
	for (let t = 0; t < tbls.length; t++) {
		const rows: TableMerges = [];
		const trs = tbls[t].getElementsByTagNameNS(NS_A, "tr");

		for (let r = 0; r < trs.length; r++) {
			const cells: CellMerge[] = [];
			// Direct children only: a nested table would otherwise leak in.
			for (const child of Array.from(trs[r].childNodes)) {
				const el = child as Element;
				if (el.nodeType === 1 && el.localName === "tc") cells.push(cellMerge(el));
			}
			rows.push(cells);
		}

		tables.push(rows);
	}

	return tables;
}

/** Table merge data for every slide, in presentation order. */
export async function readTableMerges(buffer: ArrayBuffer): Promise<TableMerges[][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const paths = await slidePathsInOrder(zip);
		const perSlide: TableMerges[][] = [];

		for (const path of paths) {
			const file = zip.file(path);
			if (!file) {
				perSlide.push([]);
				continue;
			}
			const doc = new DOMParser().parseFromString(await file.async("text"), "application/xml");
			perSlide.push(tablesInSlide(doc));
		}

		return perSlide;
	} catch {
		return [];
	}
}

/**
 * Apply one slide's merge data to the tables the renderer produced.
 *
 * Tables are matched positionally, which is only safe while the shapes come
 * out in document order. So the shape is checked first: a table whose row
 * count or per-row cell count disagrees with the XML is left exactly as it
 * was. A table with no spans at all is better than one with the wrong ones.
 *
 * Returns the number of cells removed, which the tests assert on.
 */
export function applyTableMerges(slide: HTMLElement, tables: TableMerges[]): number {
	const rendered = Array.from(slide.querySelectorAll("table"));
	let removed = 0;

	for (let t = 0; t < Math.min(rendered.length, tables.length); t++) {
		const expected = tables[t];
		const rows = Array.from(rendered[t].rows);

		if (rows.length !== expected.length) continue;
		const sameShape = rows.every((row, r) => row.cells.length === expected[r].length);
		if (!sameShape) continue;

		// Collect first, mutate after: removing as we walk would renumber
		// row.cells underneath the loop.
		const doomed: HTMLTableCellElement[] = [];

		rows.forEach((row, r) => {
			Array.from(row.cells).forEach((cell, c) => {
				const merge = expected[r][c];
				if (merge.continuation) {
					doomed.push(cell);
					return;
				}
				if (merge.colSpan > 1) cell.colSpan = merge.colSpan;
				if (merge.rowSpan > 1) cell.rowSpan = merge.rowSpan;
			});
		});

		for (const cell of doomed) cell.remove();
		removed += doomed.length;
	}

	return removed;
}
