import { describe, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { pptxToHtml } from "@jvmr/pptx-to-html";
import { detectMetafile, dataUrlBytes } from "../src/pptx/metafiles";
import { readTableMerges, applyTableMerges } from "../src/pptx/tableMerges";

const DECK = process.env.RENDER_DECK ?? "";
const OUT = process.env.RENDER_OUT ?? "";
const PS = process.env.RENDER_PS ?? "";

/** Same GDI+ rasterisation the plugin does, via the standalone script. */
function convertMetafile(bytes: Uint8Array): string | null {
	const dir = mkdtempSync(join(tmpdir(), "vs-emf-"));
	const src = join(dir, "in.emf").replace(/\\/g, "/");
	const dst = join(dir, "out.png").replace(/\\/g, "/");
	try {
		writeFileSync(src, bytes);
		execFileSync(
			"powershell.exe",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS, "-Src", src, "-Dst", dst, "-Scale", "4"],
			{ timeout: 30000, stdio: "pipe" }
		);
		return `data:image/png;base64,${readFileSync(dst).toString("base64")}`;
	} catch (e) {
		console.log("convert failed:", String(e).slice(0, 200));
		return null;
	}
}

describe("render", () => {
	it("writes one standalone html per slide, metafiles converted", async () => {
		const buf = readFileSync(DECK);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const out: any = await pptxToHtml(ab as ArrayBuffer);
		const slides: any[] = Array.isArray(out) ? out : out.slides;
		const merges = await readTableMerges(ab as ArrayBuffer);

		mkdirSync(OUT, { recursive: true });
		const cache = new Map<string, string | null>();
		let converted = 0;
		let failed = 0;

		slides.forEach((s, i) => {
			let html = String(typeof s === "string" ? s : s?.html ?? "");

			html = html.replace(/src="(data:[^"]+)"/g, (whole, src: string) => {
				const bytes = dataUrlBytes(src);
				if (!bytes || !detectMetafile(bytes)) return whole;
				if (!cache.has(src)) {
					const png = convertMetafile(bytes);
					cache.set(src, png);
					if (png) converted++;
					else failed++;
				}
				const png = cache.get(src);
				return png ? `src="${png}"` : whole;
			});

			// Reunite merged table cells, as the renderer does.
			const holder = document.createElement("div");
			holder.innerHTML = html;
			applyTableMerges(holder, merges[i] ?? []);
			html = holder.innerHTML;

			const page = `<!doctype html><meta charset="utf-8"><style>
				html,body{margin:0;padding:0;background:#fff}
				.vault-scope-slide{position:relative;background:#fff;color:#1a1a1a;
					width:1280px;height:720px;overflow:hidden}
			</style><div class="vault-scope-slide">${html}</div>`;

			writeFileSync(join(OUT, `slide-${String(i + 1).padStart(2, "0")}.html`), page, "utf-8");
		});

		console.log(`slides written: ${slides.length}; metafiles converted: ${converted}, failed: ${failed}`);
	}, 600000);
});
