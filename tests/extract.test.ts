import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deckToMarkdown, extractPptxText, slideToPlainText } from "../src/pptx/extract";

const NEEDLE = "the CIA triad is not a checklist";

function fixture(name: string): ArrayBuffer {
	const buffer = readFileSync(join(__dirname, "..", "fixtures", "out", name));
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

describe("extractPptxText", () => {
	it("reads every slide in presentation order", async () => {
		const slides = await extractPptxText(fixture("fixture-deck.pptx"));

		expect(slides).toHaveLength(5);
		expect(slides.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
		expect(slides[0].paragraphs.join(" ")).toContain("Lectern Fixture Deck");
	});

	it("pulls table cells out as text", async () => {
		const slides = await extractPptxText(fixture("fixture-deck.pptx"));
		const third = slides[2].paragraphs.join(" ");

		expect(third).toContain("A table");
		// Table text lives in a graphicFrame, not a shape, so this is the case
		// that quietly goes missing if the extractor only walks <p:sp>.
		expect(third).toContain("Backups");
	});

	it("keeps speaker notes separate from slide text", async () => {
		const slides = await extractPptxText(fixture("fixture-deck.pptx"));

		expect(slides[0].notes.join(" ")).toContain("set the agenda");
		expect(slides[3].notes.join(" ")).toContain("this is the line to comment on");
		// The slide number placeholder must not leak into the notes.
		expect(slides[3].notes.join(" ")).not.toMatch(/^\d+$/);
		expect(slides[4].notes).toHaveLength(0);
	});

	it("gives clean plain text for the copy-slide button", async () => {
		const slides = await extractPptxText(fixture("fixture-deck.pptx"));

		expect(slideToPlainText(slides[3])).toContain(NEEDLE);
		expect(slideToPlainText(slides[3])).not.toContain("<");
	});

	it("builds markdown with one heading per slide", async () => {
		const slides = await extractPptxText(fixture("fixture-deck.pptx"));
		const markdown = deckToMarkdown(slides, true);

		expect(markdown).toContain("## Slide 1");
		expect(markdown).toContain("## Slide 5");
		expect(markdown).toContain(NEEDLE);
		expect(markdown).toContain("Speaker notes");

		expect(deckToMarkdown(slides, false)).not.toContain("Speaker notes");
	});
});
