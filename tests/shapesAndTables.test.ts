import { describe, expect, it } from "vitest";
import { readShapeArt, applyShapeArt } from "../src/pptx/shapes";
import { readTableCellStyles, applyTableCellStyles } from "../src/pptx/tableStyleEngine";
import { readPictureEffects, applyPictureEffects } from "../src/pptx/pictures";
import { buildDeck, slide } from "./helpers/deck";

const XFRM = `<a:xfrm><a:off x="952500" y="952500"/><a:ext cx="952500" cy="1905000"/></a:xfrm>`;

/** The renderer's element for a shape in that box: a plain positioned div. */
function rendered(): HTMLElement {
	const host = document.createElement("div");
	const el = document.createElement("div");
	Object.assign(el.style, { position: "absolute", left: "100px", top: "100px", width: "100px", height: "200px", zIndex: "7" });
	host.appendChild(el);
	return host;
}

describe("shape art", () => {
	it("draws a Facet freeform with its translucent theme fill", async () => {
		const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="f"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${XFRM}<a:custGeom><a:pathLst><a:path w="100" h="200"><a:moveTo><a:pt x="60" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="200"/></a:lnTo><a:lnTo><a:pt x="0" y="200"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:schemeClr val="accent1"><a:alpha val="30000"/></a:schemeClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
		const [arts] = await readShapeArt(await buildDeck({ slides: [slide(sp)] }));
		expect(arts).toHaveLength(1);
		expect(arts[0].paths[0].d).toBe("M60 0 L100 0 L100 200 L0 200 Z");
		expect(arts[0].fill).toBe("rgba(68, 114, 196, 0.3)");

		const host = rendered();
		expect(applyShapeArt(host, arts)).toBe(1);
		const svg = host.querySelector("svg.lectern-shape") as SVGSVGElement;
		expect(svg.style.zIndex).toBe("7");
		expect(svg.querySelector("path")!.getAttribute("fill")).toBe("rgba(68, 114, 196, 0.3)");
	});

	it("puts a triangle's apex where its adjust value says", async () => {
		const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${XFRM}<a:prstGeom prst="triangle"><a:avLst><a:gd name="adj" fmla="val 100000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="90C226"/></a:solidFill></p:spPr></p:sp>`;
		const [arts] = await readShapeArt(await buildDeck({ slides: [slide(sp)] }));
		expect(arts[0].paths[0].d).toBe("M100 0 L100 100 L0 100 Z");
	});

	it("draws a diagonal connector as a line, not a filled box", async () => {
		const cxn = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipH="1">${XFRM.slice(8, -9)}</a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:schemeClr val="bg1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
		const [arts] = await readShapeArt(await buildDeck({ slides: [slide(cxn)] }));
		expect(arts[0].line).toMatchObject({ x1: 100, y1: 0, x2: 0, y2: 200 });
		expect(arts[0].stroke?.color).toBe("#BFBFBF");
	});

	it("never redraws a picture-filled shape", async () => {
		const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="p"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${XFRM}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId9"/></a:blipFill></p:spPr></p:sp>`;
		const [arts] = await readShapeArt(await buildDeck({ slides: [slide(sp)] }));
		expect(arts).toHaveLength(0);
	});
});

const table = (tblPr: string, rows: number) =>
	`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${tblPr}<a:tblGrid><a:gridCol w="100"/></a:tblGrid>${Array.from(
		{ length: rows },
		(_, i) => `<a:tr h="10"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>r${i}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>`
	).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

describe("table styles", () => {
	it("styles a built-in GUID the file never defines, from PowerPoint's own definition", async () => {
		const tblPr = `<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>`;
		const [tables] = await readTableCellStyles(await buildDeck({ slides: [slide(table(tblPr, 3))] }));
		const [header, band1, band2] = tables[0]!.cells.map((r) => r[0]);
		// Medium Style 2 - Accent 1: solid accent header, bold white text...
		expect(header.fill).toBe("#4472C4");
		expect(header.color).toBe("#FFFFFF");
		expect(header.bold).toBe(true);
		// ...then accent1 at 40% tint on band 1, and band 2 on the 20% whole-table tint.
		expect(band1.fill).not.toBe("#4472C4");
		expect(band1.fill).not.toBe(band2.fill);
	});

	it("paints a Themed Style 1 table background from the theme's fill list", async () => {
		const tblPr = `<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{3C2FFA5D-87B4-456A-9821-1D502468CF0F}</a:tableStyleId></a:tblPr>`;
		const [tables] = await readTableCellStyles(await buildDeck({ slides: [slide(table(tblPr, 3))] }));
		expect(tables[0]!.background).toMatch(/^linear-gradient\(180deg/);
		// Band 1 is translucent, so the gradient shows through it.
		expect(tables[0]!.cells[1][0].fill).toMatch(/^rgba\(/);

		const host = document.createElement("div");
		host.innerHTML = "<table><tbody><tr><td>r0</td></tr><tr><td>r1</td></tr><tr><td>r2</td></tr></tbody></table>";
		expect(applyTableCellStyles(host, tables)).toBe(3);
		expect(host.querySelector("table")!.style.background).toContain("linear-gradient");
	});

	it("leaves a table with no style ID to the unstyled path", async () => {
		const [tables] = await readTableCellStyles(await buildDeck({ slides: [slide(table("<a:tblPr/>", 2))] }));
		expect(tables[0]).toBeNull();
	});
});

describe("picture effects", () => {
	it("applies blip transparency, which the renderer ignores", async () => {
		// The CYBR 310 week 1 master's wave graphic is 19% opaque.
		const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="w"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="19000"/><a:grayscl/></a:blip></p:blipFill><p:spPr>${XFRM}</p:spPr></p:pic>`;
		const [effects] = await readPictureEffects(await buildDeck({ slides: [slide(pic)] }));
		expect(effects[0]).toMatchObject({ opacity: 0.19, filter: "grayscale(1)" });

		const host = document.createElement("div");
		const img = document.createElement("img");
		Object.assign(img.style, { position: "absolute", left: "100px", top: "100px", width: "100px", height: "200px" });
		host.appendChild(img);
		expect(applyPictureEffects(host, effects)).toBe(1);
		expect(img.style.opacity).toBe("0.19");
	});
});
