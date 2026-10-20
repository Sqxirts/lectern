import { relaxOverflowAbove } from "./overflow";
/**
 * PowerPoint stores vector art, and anything pasted from Visio or Word, as a
 * Windows metafile: EMF or the older WMF. Browsers cannot decode either one.
 *
 * `@jvmr/pptx-to-html` does not look at the bytes it embeds: every image comes
 * out of it as `data:image/png;base64,...` regardless of what it actually is,
 * so a metafile reaches the DOM as a PNG that fails to decode and the reader
 * gets a broken-image icon. CYBR 226 week 3 slide 5 is 6 metafiles out of 21
 * images, which is every wire-colour swatch in its pinout table.
 *
 * Windows can rasterise these through GDI+, so on Windows we convert and swap
 * the image in. Everywhere else, and whenever conversion fails, the image is
 * replaced by a visible label rather than being left as a broken icon.
 */

/** EMR_HEADER: record type 1, header size 0x6C. */
const EMF_MAGIC = [0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00];
/** Placeable WMF (0x9AC6CDD7), then the plain WMF header 0x01 0x00 0x09 0x00. */
const WMF_PLACEABLE_MAGIC = [0xd7, 0xcd, 0xc6, 0x9a];
const WMF_MAGIC = [0x01, 0x00, 0x09, 0x00];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
	if (bytes.length < magic.length) return false;
	return magic.every((byte, i) => bytes[i] === byte);
}

export type MetafileKind = "emf" | "wmf" | null;

export function detectMetafile(bytes: Uint8Array): MetafileKind {
	if (startsWith(bytes, EMF_MAGIC)) return "emf";
	if (startsWith(bytes, WMF_PLACEABLE_MAGIC) || startsWith(bytes, WMF_MAGIC)) return "wmf";
	return null;
}

/** Decode the base64 payload of a `data:` URL. Returns null if it is not one. */
export function dataUrlBytes(src: string): Uint8Array | null {
	const comma = src.indexOf(",");
	if (!src.startsWith("data:") || comma === -1) return null;
	if (!src.slice(0, comma).includes("base64")) return null;
	try {
		const binary = atob(src.slice(comma + 1));
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

/**
 * Node's `require`, if this really is Electron with node integration on.
 *
 * esbuild rewrites a literal top-level `require` call, so it is reached through
 * window instead. Returns null in a plain browser, in vitest's jsdom, and
 * anywhere Obsidian has node access switched off.
 */
function nodeRequire(): NodeRequireFn | null {
	const candidate = (window as unknown as Record<string, unknown>).require;
	return typeof candidate === "function" ? (candidate as NodeRequireFn) : null;
}

/** The Node builtins this file loads, typed. Type-only imports: nothing is bundled. */
interface NodeBuiltins {
	"fs/promises": typeof import("fs/promises");
	os: typeof import("os");
	path: typeof import("path");
	child_process: typeof import("child_process");
	util: typeof import("util");
}
type NodeRequireFn = <K extends keyof NodeBuiltins>(id: K) => NodeBuiltins[K];

/**
 * Rasterise a metafile to a PNG data URL using GDI+ through PowerShell.
 *
 * Rendered at 4x the metafile's logical size: these are small swatches and
 * line art, and 1x looks soft once the slide is zoomed. Returns null on any
 * failure, including every non-Windows platform, so callers must have a
 * fallback.
 */
export async function metafileToPngDataUrl(bytes: Uint8Array): Promise<string | null> {
	let dir: string | null = null;
	let rm: ((path: string, options: { recursive: boolean; force: boolean }) => Promise<void>) | null = null;

	try {
		// Everything risky lives inside the try, the module loads included. An
		// earlier version resolved them above it, so a failing import rejected
		// instead of returning null, and the caller's fallback never ran.
		if (typeof process === "undefined" || process.platform !== "win32") return null;

		// require, not import(). Obsidian loads plugins as CommonJS inside the
		// Electron renderer, where a bare-specifier `import("fs/promises")` is
		// treated as a *browser* dynamic import and fails trying to fetch a URL
		// by that name. require reaches Node's real builtins.
		const req = nodeRequire();
		if (!req) return null;

		const fs = req("fs/promises");
		const os = req("os");
		const path = req("path");
		const childProcess = req("child_process");
		const util = req("util");
		const run = util.promisify(childProcess.execFile);
		rm = (target, options) => fs.rm(target, options);

		dir = await fs.mkdtemp(path.join(os.tmpdir(), "lectern-emf-"));
		const src = path.join(dir, "in.bin");
		const dst = path.join(dir, "out.png");
		await fs.writeFile(src, bytes);

		// -File would need a script on disk; -Command keeps it to one process.
		// Paths are ours and live under the OS temp dir, so no quoting surprises.
		const script = [
			"Add-Type -AssemblyName System.Drawing;",
			`$mf = [System.Drawing.Imaging.Metafile]::FromFile('${src}');`,
			"$w = [int]($mf.Width * 4); $h = [int]($mf.Height * 4);",
			"$bmp = New-Object System.Drawing.Bitmap($w, $h);",
			"$g = [System.Drawing.Graphics]::FromImage($bmp);",
			"$g.Clear([System.Drawing.Color]::Transparent);",
			"$g.DrawImage($mf, 0, 0, $w, $h);",
			`$bmp.Save('${dst}', [System.Drawing.Imaging.ImageFormat]::Png);`,
			"$g.Dispose(); $bmp.Dispose(); $mf.Dispose();",
		].join(" ");

		await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
			timeout: 10000,
			windowsHide: true,
		});

		const png = await fs.readFile(dst);
		return `data:image/png;base64,${png.toString("base64")}`;
	} catch (error) {
		console.warn("[lectern] metafile conversion failed", error);
		return null;
	} finally {
		if (dir && rm) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * Find every metafile the renderer mislabelled as a PNG and fix it in place.
 *
 * Conversions run in parallel and identical images are converted once: a
 * pinout table uses the same swatch in both its T568A and T568B columns, so
 * caching by payload roughly halves the PowerShell calls.
 */
export async function repairMetafileImages(root: HTMLElement): Promise<number> {
	const images = [...root.querySelectorAll("img")];
	const cache = new Map<string, Promise<string | null>>();
	let repaired = 0;

	await Promise.all(
		images.map(async (img) => {
			const src = img.getAttribute("src") ?? "";
			const bytes = dataUrlBytes(src);
			if (!bytes) return;

			const kind = detectMetafile(bytes);
			if (!kind) return;

			const key = src;
			let pending = cache.get(key);
			if (!pending) {
				pending = metafileToPngDataUrl(bytes);
				cache.set(key, pending);
			}

			let png: string | null = null;
			try {
				png = await pending;
			} catch (error) {
				// Never let one image's failure reject the whole pass: the rest
				// still deserve their conversion or their placeholder.
				console.warn("[lectern] metafile conversion threw", error);
			}

			if (png) {
				img.setAttribute("src", png);
				repaired++;
				return;
			}

			// Nothing to show, so say what it is instead of leaving a broken icon.
			const note = createSpan({ cls: "lectern-metafile-missing", text: `${kind.toUpperCase()} vector image` });
			note.title = `This slide uses a Windows ${kind.toUpperCase()} metafile, which browsers cannot display.`;
			const slide = img.closest<HTMLElement>(".lectern-slide");
			img.replaceWith(note);
			relaxOverflowAbove(note, slide);
		})
	);

	return repaired;
}
