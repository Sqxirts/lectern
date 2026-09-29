import { describe, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { pptxToHtml } from "@jvmr/pptx-to-html";
import { detectMetafile, dataUrlBytes } from "../src/pptx/metafiles";
import { readSlideFixData, fixSlide } from "../src/pptx/postProcess";
import { readSlideSize } from "../src/pptx/slideSize";

// The plugin's real stylesheet, not a hand-kept excerpt of it. An excerpt is
// how a cell-fill regression got past this harness.
const STYLES = readFileSync(join(__dirname, "..", "styles.css"), "utf-8");

// Passes that need layout run in the page, from the plugin's real source
// bundled here, not a copy pasted into the page. The copy in realdom.mjs, and
// this probe skipping the pass entirely, is why flat divider lines looked
// missing in harness output while the plugin drew them.
// esbuild runs as a child process: under vitest's jsdom its TextEncoder
// invariant check fails, because jsdom swaps in its own Uint8Array.
const LAYOUT_PASSES = execFileSync("npx", ["esbuild", "--bundle", "--format=iife", "--loader=ts"], {
	cwd: join(__dirname, ".."),
	input: `import { repairCollapsedShapes } from "./src/pptx/thinShapes";
		import { applyTabStops } from "./src/pptx/tabStops";
		const slide = document.querySelector(".vault-scope-slide");
		repairCollapsedShapes(slide);
		applyTabStops(slide);`,
	shell: true,
	encoding: "utf-8",
});

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
		const fixData = await readSlideFixData(ab as ArrayBuffer);
		const size = await readSlideSize(ab as ArrayBuffer);

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

			// The same table fixes the plugin applies, through the same function.
			const holder = document.createElement("div");
			holder.innerHTML = html;
			fixSlide(holder, fixData, i);
			html = holder.innerHTML;

			const page = `<!doctype html><meta charset="utf-8"><style>
				html,body{margin:0;padding:0;background:#fff}
${STYLES}
				.vault-scope-slide{box-shadow:none}
			</style><div class="vault-scope-slide" style="width:${size.width}px;height:${size.height}px">${html}</div><script>${LAYOUT_PASSES}</script>`;

			writeFileSync(join(OUT, `slide-${String(i + 1).padStart(2, "0")}.html`), page, "utf-8");
		});

		console.log(`slides written: ${slides.length}; metafiles converted: ${converted}, failed: ${failed}`);
	}, 600000);
});
