import { describe, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { pptxToHtml } from "@jvmr/pptx-to-html";

const DECK = process.env.AUDIT_DECK ?? "";
const OUT = process.env.AUDIT_OUT ?? "";

describe("audit", () => {
	it("compares source images to rendered images, per slide", async () => {
		const buf = readFileSync(DECK);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

		const zip = await JSZip.loadAsync(buf);
		const out: any = await pptxToHtml(ab as ArrayBuffer);
		const slides: any[] = Array.isArray(out) ? out : out.slides;

		// Slide order as PowerPoint numbers them.
		const names = Object.keys(zip.files)
			.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
			.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

		const rows: string[] = [];
		rows.push("| Slide | blip refs | media kinds | rendered <img> | delta |");
		rows.push("|---|---|---|---|---|");

		for (let i = 0; i < names.length; i++) {
			const xml = await zip.file(names[i])!.async("string");
			const relsName = names[i].replace("slides/", "slides/_rels/") + ".rels";
			const relsFile = zip.file(relsName);
			const rels = relsFile ? await relsFile.async("string") : "";

			// Every picture placed on the slide, including repeats of one image.
			const blips = [...xml.matchAll(/<a:blip[^>]*r:embed="([^"]+)"/g)].map((m) => m[1]);
			const relMap = new Map<string, string>();
			for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
				relMap.set(m[1], m[2]);
			}
			const kinds = new Map<string, number>();
			for (const id of blips) {
				const target = relMap.get(id) ?? "?";
				const ext = (target.split(".").pop() ?? "?").toLowerCase();
				kinds.set(ext, (kinds.get(ext) ?? 0) + 1);
			}

			const s = slides[i];
			const html = String(typeof s === "string" ? s : s?.html ?? "");
			const imgs = (html.match(/<img\b/g) ?? []).length;

			const kindText = [...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(", ") || "none";
			const delta = imgs - blips.length;
			rows.push(
				`| ${i + 1} | ${blips.length} | ${kindText} | ${imgs} | ${delta === 0 ? "ok" : (delta > 0 ? "+" : "") + delta} |`
			);
		}

		const report = rows.join("\n");
		console.log("\n" + report + "\n");
		if (OUT) {
			mkdirSync(join(OUT, ".."), { recursive: true });
			writeFileSync(OUT, report, "utf-8");
		}
	}, 180000);
});
