// Open a PDF in Obsidian over CDP, select text, real right-click, screenshot the menu,
// then click our item and screenshot the draft.
// Usage: node tools/pdf-spike/40-context-menu.mjs <outdir> <vault-relative.pdf>
import { chromium } from "playwright";

const out = process.argv[2];
const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
if (!page) throw new Error("Obsidian window not found");

const path = process.argv[3];
if (!out || !path) throw new Error("usage: 40-context-menu.mjs <outdir> <vault-relative.pdf>");
await page.evaluate(async (p) => {
	const f = app.vault.getAbstractFileByPath(p);
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(f);
	app.workspace.setActiveLeaf(leaf, { focus: true });
}, path);

// Wait for the text layer and our controller.
await page.waitForFunction(() => {
	const leaf = app.workspace.getLeavesOfType("pdf").find((l) => l === app.workspace.getMostRecentLeaf());
	const plugin = app.plugins.plugins["lectern"];
	return leaf && plugin.pdfComments.forLeaf(leaf) && leaf.view.containerEl.querySelector(".page .textLayer span");
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// Select a span's text with a real mouse drag across one text-layer span.
const box = await page.evaluate(() => {
	const leaf = app.workspace.getMostRecentLeaf();
	const spans = [...leaf.view.containerEl.querySelectorAll(".page .textLayer span")].filter((s) => { const r = s.getBoundingClientRect(); return s.textContent.trim().length > 30 && r.top > 200 && r.bottom < innerHeight - 50 && !s.closest(".page").querySelector(".lectern-pdf-highlights")?.contains(s); });
	const r = spans[0].getBoundingClientRect();
	return { x: r.left, y: r.top + r.height / 2, w: r.width, text: spans[0].textContent };
});
await page.mouse.move(box.x + 2, box.y);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.6, box.y, { steps: 8 });
await page.mouse.up();
const selected = await page.evaluate(() => window.getSelection().toString());

await page.mouse.click(box.x + box.w * 0.3, box.y, { button: "right" });
await page.waitForTimeout(800);
const items = await page.evaluate(() => [...document.querySelectorAll(".menu .menu-item-title")].map((e) => e.textContent));
await page.screenshot({ path: `${out}/menu.png` });

// Click our item.
const ours = page.locator(".menu .menu-item", { hasText: "Highlight and comment" });
let draft = false;
if (await ours.count()) {
	await ours.first().click();
	await page.waitForTimeout(800);
	draft = await page.evaluate(() => !!document.querySelector(".lectern-comment-draft, .lectern-rail textarea"));
	await page.screenshot({ path: `${out}/draft.png` });
}
console.log(JSON.stringify({ spanText: box.text, selected, items, draft }, null, 2));
await browser.close().catch(() => {});
process.exit(0);
