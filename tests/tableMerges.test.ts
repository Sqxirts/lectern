import { describe, expect, it } from "vitest";
import { applyTableMerges, tablesInSlide, type TableMerges } from "../src/pptx/tableMerges";

function xml(body: string): Document {
	return new DOMParser().parseFromString(
		`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
		        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</p:sld>`,
		"application/xml"
	);
}

/** A table row of <a:tc>, each given as an attribute string. */
function tr(...cells: string[]): string {
	return `<a:tr>${cells.map((a) => `<a:tc ${a}><a:txBody/></a:tc>`).join("")}</a:tr>`;
}

function table(...rows: string[]): string {
	return `<a:graphicFrame><a:tbl>${rows.join("")}</a:tbl></a:graphicFrame>`;
}

/** An HTML table of the given shape, one cell per <a:tc>. */
function html(rows: number, cols: number): HTMLElement {
	const host = document.createElement("div");
	const body = Array.from({ length: rows }, (_, r) =>
		`<tr>${Array.from({ length: cols }, (_, c) => `<td>r${r}c${c}</td>`).join("")}</tr>`
	).join("");
	host.innerHTML = `<table><tbody>${body}</tbody></table>`;
	return host;
}

function shape(host: HTMLElement): string[] {
	return Array.from(host.querySelectorAll("tr")).map((row) =>
		Array.from(row.cells)
			.map((c) => `${c.textContent}${c.colSpan > 1 ? `+c${c.colSpan}` : ""}${c.rowSpan > 1 ? `+r${c.rowSpan}` : ""}`)
			.join(" ")
	);
}

describe("tablesInSlide", () => {
	it("reads spans and continuation flags", () => {
		const doc = xml(table(tr('gridSpan="2" rowSpan="2"', 'hMerge="1"'), tr('vMerge="1"', 'hMerge="1" vMerge="1"')));
		const [t] = tablesInSlide(doc);

		expect(t[0][0]).toEqual({ colSpan: 2, rowSpan: 2, continuation: false });
		expect(t[0][1].continuation).toBe(true);
		expect(t[1][0].continuation).toBe(true);
		expect(t[1][1].continuation).toBe(true);
	});

	it("accepts true/false as well as 1/0 for the merge flags", () => {
		const doc = xml(table(tr('hMerge="true"', 'vMerge="false"')));
		const [t] = tablesInSlide(doc);
		expect(t[0][0].continuation).toBe(true);
		expect(t[0][1].continuation).toBe(false);
	});

	it("defaults a missing or nonsense span to 1", () => {
		const doc = xml(table(tr("", 'gridSpan="oops"', 'rowSpan="0"')));
		const [t] = tablesInSlide(doc);
		for (const cell of t[0]) {
			expect(cell.colSpan).toBe(1);
			expect(cell.rowSpan).toBe(1);
		}
	});

	it("finds every table on the slide", () => {
		const doc = xml(table(tr("", "")) + table(tr("", ""), tr("", "")));
		const tables = tablesInSlide(doc);
		expect(tables).toHaveLength(2);
		expect(tables[1]).toHaveLength(2);
	});
});

describe("applyTableMerges", () => {
	it("spans the anchor and drops the cells it swallows", () => {
		// Row 1 col 2 spans two rows, as slide 5's T568A pair column does.
		const merges: TableMerges = [
			[
				{ colSpan: 1, rowSpan: 1, continuation: false },
				{ colSpan: 1, rowSpan: 2, continuation: false },
			],
			[
				{ colSpan: 1, rowSpan: 1, continuation: false },
				{ colSpan: 1, rowSpan: 1, continuation: true },
			],
		];
		const host = html(2, 2);

		expect(applyTableMerges(host, [merges])).toBe(1);
		expect(shape(host)).toEqual(["r0c0 r0c1+r2", "r1c0"]);
	});

	it("handles a cell merged both across and down", () => {
		const merges: TableMerges = [
			[
				{ colSpan: 2, rowSpan: 2, continuation: false },
				{ colSpan: 1, rowSpan: 1, continuation: true },
			],
			[
				{ colSpan: 1, rowSpan: 1, continuation: true },
				{ colSpan: 1, rowSpan: 1, continuation: true },
			],
		];
		const host = html(2, 2);

		expect(applyTableMerges(host, [merges])).toBe(3);
		expect(shape(host)).toEqual(["r0c0+c2+r2", ""]);
	});

	it("leaves a table alone when the row count disagrees", () => {
		const merges: TableMerges = [[{ colSpan: 1, rowSpan: 1, continuation: true }]];
		const host = html(2, 1);

		expect(applyTableMerges(host, [merges])).toBe(0);
		expect(shape(host)).toEqual(["r0c0", "r1c0"]);
	});

	it("leaves a table alone when a row's cell count disagrees", () => {
		const merges: TableMerges = [
			[
				{ colSpan: 1, rowSpan: 1, continuation: true },
				{ colSpan: 1, rowSpan: 1, continuation: false },
				{ colSpan: 1, rowSpan: 1, continuation: false },
			],
		];
		const host = html(1, 2);

		expect(applyTableMerges(host, [merges])).toBe(0);
		expect(shape(host)).toEqual(["r0c0 r0c1"]);
	});

	it("does nothing when the slide has no merge data", () => {
		const host = html(2, 2);
		expect(applyTableMerges(host, [])).toBe(0);
		expect(shape(host)).toEqual(["r0c0 r0c1", "r1c0 r1c1"]);
	});

	it("applies each table's own data when a slide has several", () => {
		const host = document.createElement("div");
		host.innerHTML =
			"<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>" +
			"<table><tbody><tr><td>c</td><td>d</td></tr></tbody></table>";

		const first: TableMerges = [
			[
				{ colSpan: 2, rowSpan: 1, continuation: false },
				{ colSpan: 1, rowSpan: 1, continuation: true },
			],
		];
		const second: TableMerges = [
			[
				{ colSpan: 1, rowSpan: 1, continuation: false },
				{ colSpan: 1, rowSpan: 1, continuation: false },
			],
		];

		expect(applyTableMerges(host, [first, second])).toBe(1);
		expect(shape(host)).toEqual(["a+c2", "c d"]);
	});
});
