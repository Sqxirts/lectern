import { beforeEach, describe, expect, it } from "vitest";
import { locateInDiv, pageElementOf, pointToItem, rangeToSpan, spanToRange } from "../src/pdf/pdfDom";

// Shaped like PDF.js 5's text layer on the real syllabus: item spans nested in
// markedContent wrappers, and empty spans for end-of-line items.
function textLayer(): { page: HTMLElement; divs: HTMLElement[] } {
	document.body.innerHTML = `
		<div class="page" data-page-number="3">
			<div class="textLayer">
				<span class="markedContent"><span id="i0">Late work loses </span><span id="i1">10% per day</span></span>
				<span class="markedContent"><span id="i2">, capped at 50%.</span><span id="i3"></span></span>
				<br>
				<span class="markedContent"><span id="i4">Quizzes excluded.</span></span>
				<div class="endOfContent"></div>
			</div>
		</div>`;
	const page = document.querySelector<HTMLElement>(".page")!;
	const divs = [0, 1, 2, 3, 4].map((i) => document.getElementById(`i${i}`)!);
	return { page, divs };
}

describe("pdfDom", () => {
	let divs: HTMLElement[];
	let page: HTMLElement;

	beforeEach(() => {
		({ page, divs } = textLayer());
	});

	it("maps a selection inside one item", () => {
		const r = document.createRange();
		r.setStart(divs[1].firstChild!, 0);
		r.setEnd(divs[1].firstChild!, 3);
		expect(rangeToSpan(r, 3, divs)).toEqual({ page: 3, startItem: 1, startOffset: 0, endItem: 1, endOffset: 3 });
	});

	it("maps a selection across items and wrappers", () => {
		const r = document.createRange();
		r.setStart(divs[0].firstChild!, 5);
		r.setEnd(divs[4].firstChild!, 7);
		expect(rangeToSpan(r, 3, divs)).toEqual({ page: 3, startItem: 0, startOffset: 5, endItem: 4, endOffset: 7 });
	});

	it("snaps a start between items forward, and an end between items back", () => {
		const layer = page.querySelector(".textLayer")!;
		const br = layer.querySelector("br")!;
		const brIndex = Array.from(layer.childNodes).indexOf(br);
		// A boundary on the <br> between lines, as a drag across a line end produces.
		expect(pointToItem(divs, layer, brIndex, "start")).toEqual({ item: 4, offset: 0 });
		expect(pointToItem(divs, layer, brIndex, "end")).toEqual({ item: 2, offset: 16 });
	});

	it("skips empty end-of-line items when snapping", () => {
		const wrapper = divs[2].parentElement!;
		// After the empty i3: an end there belongs to the end of i2, not to i3.
		expect(pointToItem(divs, wrapper, 2, "end")).toEqual({ item: 2, offset: 16 });
	});

	it("rejects an empty or reversed selection", () => {
		const r = document.createRange();
		r.setStart(divs[1].firstChild!, 4);
		r.setEnd(divs[1].firstChild!, 4);
		expect(rangeToSpan(r, 3, divs)).toBeNull();
	});

	it("round-trips a span to a DOM range with the same text", () => {
		const span = { page: 3, startItem: 0, startOffset: 10, endItem: 2, endOffset: 8 };
		const range = spanToRange(span, divs)!;
		// The fixture HTML has indentation whitespace between spans; the real text layer may too.
		expect(range.toString().replace(/\s+/g, " ")).toBe("loses 10% per day , capped");
		expect(rangeToSpan(range, 3, divs)).toEqual(span);
	});

	it("locates offsets in an empty item without throwing", () => {
		expect(locateInDiv(divs[3], 0)).toEqual({ node: divs[3], offset: 0 });
	});

	it("finds the page a node is on", () => {
		expect(pageElementOf(divs[4].firstChild!)?.dataset.pageNumber).toBe("3");
		expect(pageElementOf(document.body)).toBeNull();
	});
});
