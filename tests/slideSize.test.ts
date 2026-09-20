import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { DEFAULT_SLIDE_SIZE, emuToPx, readSlideSize } from "../src/pptx/slideSize";

function arrayBuffer(path: string): ArrayBuffer {
	const buf = readFileSync(path);
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Build a minimal pptx-shaped zip carrying just the presentation part. */
async function deckWith(sldSz: string | null): Promise<ArrayBuffer> {
	const zip = new JSZip();
	const inner = sldSz ?? "";
	zip.file(
		"ppt/presentation.xml",
		`<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${inner}</p:presentation>`
	);
	const blob = await zip.generateAsync({ type: "nodebuffer" });
	return blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer;
}

describe("emuToPx", () => {
	it("converts at 9525 EMU per CSS pixel", () => {
		expect(emuToPx(9525)).toBe(1);
		expect(emuToPx(914400)).toBe(96); // one inch
	});
});

describe("readSlideSize", () => {
	it("reads a 16:9 deck as 1280x720", async () => {
		const deck = await deckWith('<p:sldSz cx="12192000" cy="6858000"/>');
		expect(await readSlideSize(deck)).toEqual({ width: 1280, height: 720 });
	});

	it("reads a 4:3 deck as 960x720, not the 16:9 default", async () => {
		const deck = await deckWith('<p:sldSz cx="9144000" cy="6858000"/>');
		expect(await readSlideSize(deck)).toEqual({ width: 960, height: 720 });
	});

	it("handles a custom page size with a fractional pixel result", async () => {
		const deck = await deckWith('<p:sldSz cx="10692000" cy="7560000"/>');
		const size = await readSlideSize(deck);
		expect(size.width).toBeCloseTo(1122.52, 1);
		expect(size.height).toBeCloseTo(793.7, 1);
	});

	it("falls back to the default when the element is missing", async () => {
		expect(await readSlideSize(await deckWith(null))).toEqual(DEFAULT_SLIDE_SIZE);
	});

	it("falls back when the attributes are junk or zero", async () => {
		expect(await readSlideSize(await deckWith('<p:sldSz cx="nope" cy="6858000"/>'))).toEqual(DEFAULT_SLIDE_SIZE);
		expect(await readSlideSize(await deckWith('<p:sldSz cx="0" cy="0"/>'))).toEqual(DEFAULT_SLIDE_SIZE);
	});

	it("falls back rather than throwing on a file that is not a zip", async () => {
		const notAZip = new TextEncoder().encode("this is not a pptx").buffer;
		expect(await readSlideSize(notAZip as ArrayBuffer)).toEqual(DEFAULT_SLIDE_SIZE);
	});

	it("reads the generated fixture deck", async () => {
		const fixture = join(__dirname, "..", "fixtures", "out", "fixture-deck.pptx");
		if (!existsSync(fixture)) return;
		const size = await readSlideSize(arrayBuffer(fixture));
		expect(size.width).toBeGreaterThan(0);
		expect(size.height).toBeGreaterThan(0);
	});
});
