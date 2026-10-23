// Drive the find bar over CDP: open a file, press Mod+F in the view, type a
// query, step through matches, and report what the bar and highlights show.
// Usage: node tools/pdf-spike/42-find.mjs <outdir> <vault-relative file> <query> [steps]
import { chromium } from "playwright";

const [out, path, query, stepsArg] = process.argv.slice(2);
if (!out || !path || !query) throw new Error("usage: 42-find.mjs <outdir> <file> <query> [steps]");
const steps = Number(stepsArg ?? 2);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
if (!page) throw new Error("Obsidian window not found");

await page.evaluate(async (p) => {
	const f = app.vault.getAbstractFileByPath(p);
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(f);
	app.workspace.setActiveLeaf(leaf, { focus: true });
}, path);
await page.waitForFunction(() => document.querySelector(".workspace-leaf.mod-active .lectern-content")?.textContent.trim().length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// Focus the view the way a user would, then use the real shortcut.
await page.locator(".workspace-leaf.mod-active .lectern-wrapper").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+f");
await page.keyboard.type(query);
await page.waitForTimeout(400);

const state = () => page.evaluate(() => {
	const leaf = document.querySelector(".workspace-leaf.mod-active");
	const current = CSS.highlights.get("lectern-find-current");
	const range = current ? [...current][0] : null;
	const sheet = range?.startContainer.parentElement?.closest(".lectern-xlsx-sheet");
	const box = range?.getBoundingClientRect();
	const view = leaf.querySelector(".lectern-wrapper").getBoundingClientRect();
	return {
		barOpen: leaf.querySelector(".lectern-find")?.classList.contains("is-open"),
		inputFocused: document.activeElement?.classList.contains("lectern-find-input"),
		count: leaf.querySelector(".lectern-find-count")?.textContent,
		painted: CSS.highlights.get("lectern-find")?.size ?? 0,
		current: range?.toString(),
		onScreen: box ? box.top >= view.top && box.bottom <= view.bottom && box.height > 0 : null,
		sheet: sheet ? sheet.dataset.sheetIndex + (sheet.classList.contains("is-active") ? " (shown)" : " (hidden!)") : undefined,
		findButtonActive: leaf.querySelector(".lectern-toolbar-btn.is-active")?.textContent,
	};
});

const log = [{ after: "type", ...(await state()) }];
await page.screenshot({ path: `${out}/find-0.png` });
for (let i = 1; i <= steps; i++) {
	await page.keyboard.press("Enter");
	await page.waitForTimeout(250);
	log.push({ after: `enter ${i}`, ...(await state()) });
}
await page.keyboard.press("Shift+Enter");
await page.waitForTimeout(250);
log.push({ after: "shift+enter", ...(await state()) });
await page.screenshot({ path: `${out}/find-1.png` });

await page.keyboard.press("Escape");
await page.waitForTimeout(250);
log.push({ after: "escape", ...(await state()) });

console.log(JSON.stringify(log, null, 1));
await browser.close().catch(() => {});
process.exit(0);
