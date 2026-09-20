import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readTableStyleSupport, markUnstyledTables, UNSTYLED_TABLE_CLASS } from "../src/pptx/tableStyles";

const MEDIUM_2_ACCENT_1 = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";

async function deck(options: { styles: string; tables: string[] }): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file(
		"ppt/presentation.xml",
		`<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`
	);
	zip.file("ppt/tableStyles.xml", options.styles);
	zip.file(
		"ppt/slides/slide1.xml",
		`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
		   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${options.tables
				.map((t) => `<a:tbl>${t}<a:tr><a:tc><a:txBody/></a:tc></a:tr></a:tbl>`)
				.join("")}</p:sld>`
	);
	const buf = await zip.generateAsync({ type: "nodebuffer" });
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** The real shape of these decks: a def GUID and no definitions at all. */
const EMPTY_STYLES = `<?xml version="1.0"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${MEDIUM_2_ACCENT_1}"/>`;

const DEFINES = (id: string) =>
	`<?xml version="1.0"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${id}">
		<a:tblStyle styleId="${id}" styleName="Defined"/></a:tblStyleLst>`;

describe("readTableStyleSupport", () => {
	it("treats a table with no tableStyleId as unstyled, even with a def GUID", async () => {
		// This is exactly CYBR 226 week 3 slide 5.
		const buffer = await deck({ styles: EMPTY_STYLES, tables: ['<a:tblPr firstRow="1" bandRow="1"/>'] });
		expect(await readTableStyleSupport(buffer)).toEqual([[false]]);
	});

	it("treats a style the file defines as resolved", async () => {
		const buffer = await deck({
			styles: DEFINES(MEDIUM_2_ACCENT_1),
			tables: [`<a:tblPr><a:tableStyleId>${MEDIUM_2_ACCENT_1}</a:tableStyleId></a:tblPr>`],
		});
		expect(await readTableStyleSupport(buffer)).toEqual([[true]]);
	});

	it("treats a style the file names but never defines as unstyled", async () => {
		const buffer = await deck({
			styles: EMPTY_STYLES,
			tables: [`<a:tblPr><a:tableStyleId>${MEDIUM_2_ACCENT_1}</a:tableStyleId></a:tblPr>`],
		});
		expect(await readTableStyleSupport(buffer)).toEqual([[false]]);
	});

	it("reports one flag per table, in order", async () => {
		const buffer = await deck({
			styles: DEFINES(MEDIUM_2_ACCENT_1),
			tables: [
				"<a:tblPr/>",
				`<a:tblPr><a:tableStyleId>${MEDIUM_2_ACCENT_1}</a:tableStyleId></a:tblPr>`,
			],
		});
		expect(await readTableStyleSupport(buffer)).toEqual([[false, true]]);
	});

	it("falls back to an empty result rather than throwing on junk", async () => {
		const notAZip = new TextEncoder().encode("nope").buffer;
		expect(await readTableStyleSupport(notAZip as ArrayBuffer)).toEqual([]);
	});
});

describe("markUnstyledTables", () => {
	function slide(count: number): HTMLElement {
		const host = document.createElement("div");
		host.innerHTML = Array.from({ length: count }, () => "<table><tbody><tr><td>x</td></tr></tbody></table>").join("");
		return host;
	}

	it("tags only the tables whose style is unresolved", () => {
		const host = slide(2);
		expect(markUnstyledTables(host, [false, true])).toBe(1);

		const tables = host.querySelectorAll("table");
		expect(tables[0].classList.contains(UNSTYLED_TABLE_CLASS)).toBe(true);
		expect(tables[1].classList.contains(UNSTYLED_TABLE_CLASS)).toBe(false);
	});

	it("does nothing when there is no data for the slide", () => {
		const host = slide(1);
		expect(markUnstyledTables(host, [])).toBe(0);
		expect(host.querySelector("table")!.className).toBe("");
	});

	it("ignores extra flags beyond the tables present", () => {
		const host = slide(1);
		expect(markUnstyledTables(host, [false, false, false])).toBe(1);
	});
});
