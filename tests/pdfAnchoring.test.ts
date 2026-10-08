import { describe, expect, it } from "vitest";
import { looseIndexOf } from "../src/comments/anchoring";
import { anchorLabel, type PdfAnchor } from "../src/comments/types";
import { PdfPageText, buildPdfAnchor, resolvePdfAnchor, type PdfTextItem } from "../src/pdf/pdfAnchoring";

// Shaped like PDF.js getTextContent() output: words split across items, and an
// empty hasEOL item at each line end (34 of 469 items on the real syllabus).
const LINE = (s: string): PdfTextItem[] => [{ str: s }, { str: "", hasEOL: true }];

const PAGE_1: PdfTextItem[] = [...LINE("CYBR 310 Secure Programming"), ...LINE("Course policies follow.")];
const PAGE_2: PdfTextItem[] = [
	{ str: "Late work loses " },
	{ str: "10% per day" },
	{ str: ", capped at 50%." },
	{ str: "", hasEOL: true },
	...LINE("Quizzes: 10% per day of lateness does not apply."),
];
const PAGE_3: PdfTextItem[] = [...LINE("Academic integrity: cite AI help.")];

function doc(pages: PdfTextItem[][]) {
	const texts = pages.map((items, i) => new PdfPageText(i + 1, items));
	const loads: number[] = [];
	const loadPage = async (n: number) => {
		loads.push(n);
		return texts[n - 1] ?? null;
	};
	return { texts, loads, loadPage, count: pages.length };
}

describe("PdfPageText", () => {
	it("joins items, with a newline after each end-of-line item", () => {
		const t = new PdfPageText(1, PAGE_1);
		expect(t.text).toBe("CYBR 310 Secure Programming\nCourse policies follow.\n");
		expect(t.itemCount).toBe(4); // empty EOL items still take an index
	});

	it("maps a span to offsets and back", () => {
		const t = new PdfPageText(2, PAGE_2);
		const span = { page: 2, startItem: 1, startOffset: 0, endItem: 1, endOffset: 11 };
		const off = t.toOffsets(span)!;
		expect(t.text.slice(off.start, off.end)).toBe("10% per day");
		expect(t.toSpan(off.start, off.end)).toEqual(span);
	});

	it("spans across items", () => {
		const t = new PdfPageText(2, PAGE_2);
		const start = t.text.indexOf("loses");
		const end = t.text.indexOf(", capped") + ", capped".length;
		expect(t.toSpan(start, end)).toEqual({ page: 2, startItem: 0, startOffset: 10, endItem: 2, endOffset: 8 });
	});

	it("pulls boundaries on an inserted newline onto real text", () => {
		const t = new PdfPageText(1, PAGE_1);
		const nl = t.text.indexOf("\n");
		// start on the newline -> next real item; end just past it -> end of the previous item
		expect(t.toSpan(nl, nl + 7)).toMatchObject({ startItem: 2, startOffset: 0 });
		expect(t.toSpan(0, nl + 1)).toMatchObject({ endItem: 0, endOffset: 27 });
	});

	it("rejects spans that no longer fit the page", () => {
		const t = new PdfPageText(1, PAGE_1);
		expect(t.toOffsets({ startItem: 0, startOffset: 0, endItem: 9, endOffset: 1 })).toBeNull();
		expect(t.toOffsets({ startItem: 0, startOffset: 99, endItem: 0, endOffset: 100 })).toBeNull();
		expect(t.toOffsets({ startItem: 0, startOffset: 5, endItem: 0, endOffset: 5 })).toBeNull();
	});
});

describe("buildPdfAnchor", () => {
	it("stores indices, quote and context for the same characters", () => {
		const t = new PdfPageText(2, PAGE_2);
		const a = buildPdfAnchor(t, { page: 2, startItem: 1, startOffset: 0, endItem: 1, endOffset: 11 })!;
		expect(a).toMatchObject({ kind: "pdf", page: 2, quote: "10% per day", selection: [1, 0, 1, 11] });
		expect(a.prefix.endsWith("Late work loses ")).toBe(true);
		expect(a.suffix.startsWith(", capped")).toBe(true);
		expect(anchorLabel(a)).toBe("Page 2");
	});

	it("trims whitespace off the span itself, not just the quote", () => {
		const t = new PdfPageText(2, PAGE_2);
		// "loses " with its trailing space, selected from item 0
		const a = buildPdfAnchor(t, { page: 2, startItem: 0, startOffset: 10, endItem: 0, endOffset: 16 })!;
		expect(a.quote).toBe("loses");
		expect(a.selection).toEqual([0, 10, 0, 15]);
	});

	it("refuses an all-whitespace selection", () => {
		const t = new PdfPageText(2, PAGE_2);
		expect(buildPdfAnchor(t, { page: 2, startItem: 0, startOffset: 15, endItem: 0, endOffset: 16 })).toBeNull();
	});
});

describe("resolvePdfAnchor", () => {
	const base = (): PdfAnchor => {
		const t = new PdfPageText(2, PAGE_2);
		return buildPdfAnchor(t, { page: 2, startItem: 1, startOffset: 0, endItem: 1, endOffset: 11 })!;
	};

	it("1. uses the stored indices when they still cover the quote, reading one page", async () => {
		const d = doc([PAGE_1, PAGE_2, PAGE_3]);
		const r = await resolvePdfAnchor(base(), d.count, d.loadPage);
		expect(r.step).toBe("selection");
		expect(r.span).toMatchObject({ page: 2, startItem: 1, endItem: 1 });
		expect(d.loads).toEqual([2]);
	});

	it("2. falls back to context when re-export shifted the items", async () => {
		// Same text, different item boundaries: the stored indices now point at the wrong words.
		const reexported: PdfTextItem[] = [
			{ str: "Late work loses 10% per day, capped at 50%." },
			{ str: "", hasEOL: true },
			...PAGE_2.slice(4),
		];
		const d = doc([PAGE_1, reexported, PAGE_3]);
		const r = await resolvePdfAnchor(base(), d.count, d.loadPage);
		expect(r.step).toBe("context");
		const t = d.texts[1];
		const off = t.toOffsets(r.span!)!;
		expect(t.text.slice(off.start, off.end)).toBe("10% per day");
		// The first line, not the second "10% per day" further down.
		expect(r.span!.startItem).toBe(0);
	});

	it("2b. context picks the right copy of a repeated phrase", async () => {
		const d = doc([PAGE_1, PAGE_2, PAGE_3]);
		const t = d.texts[1];
		const second = t.text.lastIndexOf("10% per day");
		const span = t.toSpan(second, second + 11)!;
		const a = { ...buildPdfAnchor(t, span)!, selection: undefined };
		const r = await resolvePdfAnchor(a, d.count, d.loadPage);
		expect(r.step).toBe("context");
		expect(r.span!.startItem).toBe(span.startItem);
	});

	it("3. falls back to the quote alone when the surrounding text was edited", async () => {
		const edited: PdfTextItem[] = [...LINE("Penalty is 10% per day for everything."), ...PAGE_2.slice(4)];
		const d = doc([PAGE_1, edited, PAGE_3]);
		const r = await resolvePdfAnchor(base(), d.count, d.loadPage);
		expect(r.step).toBe("quote");
		expect(r.span!.page).toBe(2);
	});

	it("4. finds text that moved to another page, nearest page first", async () => {
		const moved: PdfTextItem[] = [...LINE("Inserted cover page.")];
		const d = doc([PAGE_1, moved, PAGE_2, PAGE_3]);
		const r = await resolvePdfAnchor(base(), d.count, d.loadPage);
		expect(r.step).toBe("other-page");
		expect(r.span!.page).toBe(3);
		expect(d.loads).toEqual([2, 1, 3]);
	});

	it("4b. searches from the nearest real page when the stored page no longer exists", async () => {
		const d = doc([PAGE_2]);
		const r = await resolvePdfAnchor({ ...base(), page: 5 }, d.count, d.loadPage);
		expect(r.step).toBe("other-page");
		expect(r.span!.page).toBe(1);
	});

	it("5. orphans an anchor whose text is gone, without throwing", async () => {
		const d = doc([PAGE_1, PAGE_3]);
		const r = await resolvePdfAnchor(base(), d.count, d.loadPage);
		expect(r).toEqual({ span: null, step: "orphaned" });
	});

	it("matches across whitespace drift and line breaks", async () => {
		const wrapped: PdfTextItem[] = [
			{ str: "Late work loses 10%" },
			{ str: "", hasEOL: true },
			{ str: "per   day, capped at 50%." },
			{ str: "", hasEOL: true },
			// The stored suffix runs into this next line, so keep it for the context step.
			...PAGE_2.slice(4),
		];
		const d = doc([PAGE_1, wrapped]);
		const r = await resolvePdfAnchor(base(), d.count, d.loadPage);
		expect(r.step).toBe("context");
		expect(r.span).toMatchObject({ startItem: 0, startOffset: 16, endItem: 2 });
	});
});

describe("looseIndexOf", () => {
	it("honours `from` on the whitespace-insensitive path (regression)", () => {
		const hay = "one  two three. one two three.";
		// The second copy is found exactly; ask for one that only matches loosely.
		const needle = "one two  three";
		const second = looseIndexOf(hay, needle, 10);
		expect(second?.start).toBe(hay.lastIndexOf("one two"));
	});
});
