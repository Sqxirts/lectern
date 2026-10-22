// Open a code/HTML file in Obsidian over CDP and report the zoom it opened at.
// A file with one very long line used to open at the 25% floor.
// Usage: node tools/pdf-spike/41-code-zoom.mjs <outdir> <vault-relative file>
import { chromium } from "playwright";

const out = process.argv[2];
const path = process.argv[3];
if (!out || !path) throw new Error("usage: 41-code-zoom.mjs <outdir> <vault-relative file>");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
if (!page) throw new Error("Obsidian window not found");

await page.evaluate(async (p) => {
	const f = app.vault.getAbstractFileByPath(p);
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(f);
	app.workspace.setActiveLeaf(leaf, { focus: true });
}, path);
await page.waitForFunction(() => document.querySelector(".workspace-leaf.mod-active .lectern-code-row"), null, { timeout: 30000 });
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
	const root = document.querySelector(".workspace-leaf.mod-active");
	const wrapper = root.querySelector(".lectern-wrapper");
	const content = root.querySelector(".lectern-content");
	return {
		zoom: root.querySelector(".lectern-zoom-indicator")?.textContent,
		wrapperClass: wrapper.className,
		wrapperWidth: wrapper.clientWidth,
		contentScrollWidth: content.scrollWidth,
		transform: content.style.transform,
	};
});
await page.screenshot({ path: `${out}/code-zoom.png` });
console.log(JSON.stringify(result, null, 2));
await browser.close().catch(() => {});
process.exit(0);
