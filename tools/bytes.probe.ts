import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { pptxToHtml } from "@jvmr/pptx-to-html";
import { detectMetafile, dataUrlBytes } from "../src/pptx/metafiles";

describe("bytes", () => {
	it("compares emitted metafile payloads to the originals on disk", async () => {
		const deck = process.env.BYTES_DECK!;
		const mediaDir = process.env.BYTES_MEDIA!;
		const buf = readFileSync(deck);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const out: any = await pptxToHtml(ab as ArrayBuffer);
		const slides: any[] = Array.isArray(out) ? out : out.slides;
		const html = String(typeof slides[4] === "string" ? slides[4] : slides[4].html);

		const seen = new Set<string>();
		for (const m of html.matchAll(/src="(data:[^"]+)"/g)) {
			const src = m[1];
			if (seen.has(src)) continue;
			seen.add(src);
			const bytes = dataUrlBytes(src);
			if (!bytes || !detectMetafile(bytes)) continue;
			console.log(`emitted metafile: ${bytes.length} bytes, head ${Buffer.from(bytes.subarray(0, 8)).toString("hex")}`);
		}

		for (const name of ["image2.emf", "image3.emf", "image4.emf"]) {
			const disk = readFileSync(`${mediaDir}/${name}`);
			console.log(`on disk ${name}: ${disk.length} bytes, head ${disk.subarray(0, 8).toString("hex")}`);
		}
	}, 180000);
});
