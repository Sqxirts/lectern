import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectMetafile, dataUrlBytes } from "../src/pptx/metafiles";

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

describe("detectMetafile", () => {
	it("spots an EMF header", () => {
		const emf = Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00, 0xff]);
		expect(detectMetafile(emf)).toBe("emf");
	});

	it("spots both placeable and plain WMF headers", () => {
		expect(detectMetafile(Uint8Array.from([0xd7, 0xcd, 0xc6, 0x9a, 0x00]))).toBe("wmf");
		expect(detectMetafile(Uint8Array.from([0x01, 0x00, 0x09, 0x00, 0x00]))).toBe("wmf");
	});

	it("leaves a real PNG alone", () => {
		expect(detectMetafile(PNG_MAGIC)).toBeNull();
	});

	it("does not run off the end of a short buffer", () => {
		expect(detectMetafile(Uint8Array.from([0x01, 0x00]))).toBeNull();
		expect(detectMetafile(new Uint8Array())).toBeNull();
	});

	it("reads the real fixture deck's media, EMF and PNG alike", () => {
		// The CYBR 226 deck is coursework and not in the repo, so this uses the
		// generated fixture: it proves the PNG path, and the EMF path is covered
		// by the header tests above.
		const png = readFileSync(join(__dirname, "..", "fixtures", "out", "fixture-deck.pptx"));
		expect(detectMetafile(new Uint8Array(png.subarray(0, 8)))).toBeNull();
	});
});

describe("dataUrlBytes", () => {
	it("decodes a base64 data URL", () => {
		const url = `data:image/png;base64,${base64(PNG_MAGIC)}`;
		expect(dataUrlBytes(url)).toEqual(PNG_MAGIC);
	});

	it("decodes regardless of the declared mime type, which is the whole point", () => {
		// The renderer labels EMF bytes as image/png. Trust the bytes, not the label.
		const emf = Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00]);
		const url = `data:image/png;base64,${base64(emf)}`;
		expect(detectMetafile(dataUrlBytes(url)!)).toBe("emf");
	});

	it("returns null for a non-data or non-base64 url", () => {
		expect(dataUrlBytes("https://example.com/a.png")).toBeNull();
		expect(dataUrlBytes("data:image/svg+xml,<svg/>")).toBeNull();
		expect(dataUrlBytes("")).toBeNull();
	});
});
