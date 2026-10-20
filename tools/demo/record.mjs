// Record the README demo from a running Obsidian on the demo vault.
// Usage: node tools/demo/record.mjs <frames-dir>
// Obsidian must be started with --remote-debugging-port=9229 on the vault from
// make_demo_vault.py. See tools/demo/README.md for the full sequence.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const DECK = "Week 3/Lecture 3 - CIA Triad.pptx";
const PDF = "Week 3/Reading 3 - Threat Modeling.pdf";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md/index"));
if (!page) throw new Error("Obsidian window not found");
const wait = (ms) => page.waitForTimeout(ms);

// Fixed window size so every recording frames the same.
await page.evaluate(() => {
	const w = require("@electron/remote").getCurrentWindow();
	w.unmaximize();
	w.setContentSize(1280, 760);
	w.center();
});

// Screencasts don't include the OS cursor, so draw one that follows the mouse.
await page.evaluate(() => {
	document.getElementById("demo-cursor")?.remove();
	const c = document.body.createDiv({ attr: { id: "demo-cursor" } });
	c.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L9 21z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
	Object.assign(c.style, { position: "fixed", zIndex: 99999, pointerEvents: "none", left: "640px", top: "420px", transition: "none" });
	document.addEventListener("mousemove", (e) => { c.style.left = e.clientX - 3 + "px"; c.style.top = e.clientY - 2 + "px"; }, true);
});

// Reset to a clean state: no old comments, sidebars as wanted, explorer expanded.
await page.evaluate(async () => {
	const notes = app.vault.getAbstractFileByPath("File-Notes");
	if (notes) await app.vault.delete(notes, true);
	app.vault.setConfig("defaultViewMode", "preview");
	app.vault.setConfig("propertiesInDocument", "hidden");
	app.workspace.rightSplit?.collapse();
	app.workspace.leftSplit?.expand();
	for (const l of app.workspace.getLeavesOfType("markdown")) l.detach();
});

let pos = { x: 640, y: 420 };
async function moveTo(x, y, steps = 18) {
	await page.mouse.move(x, y, { steps });
	pos = { x, y };
}
async function clickAt(x, y) {
	await moveTo(x, y);
	await wait(120);
	await page.mouse.click(x, y);
}
async function center(selector) {
	const box = await page.locator(selector).first().boundingBox();
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Rects of the first and last character of `text` inside elements matching rootSel.
async function textEnds(rootSel, text) {
	return page.evaluate(({ rootSel, text }) => {
		for (const root of document.querySelectorAll(rootSel)) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				const i = n.data.indexOf(text);
				if (i < 0) continue;
				const r = document.createRange();
				r.setStart(n, i); r.setEnd(n, i + 1);
				const a = r.getBoundingClientRect();
				r.setStart(n, i + text.length - 1); r.setEnd(n, i + text.length);
				const b = r.getBoundingClientRect();
				return { x1: a.left + 1, y: (a.top + a.bottom) / 2, x2: b.right - 1 };
			}
		}
		return null;
	}, { rootSel, text });
}
async function dragSelect(rootSel, text) {
	const e = await textEnds(rootSel, text);
	if (!e) throw new Error(`text not found: ${text}`);
	await moveTo(e.x1, e.y);
	await page.mouse.down();
	await page.mouse.move(e.x2, e.y, { steps: 30 });
	await page.mouse.up();
	pos = { x: e.x2, y: e.y };
	return e;
}
async function typeNote(text) {
	await page.locator(".lectern-card.is-draft textarea").first().focus();
	await page.keyboard.type(text, { delay: 32 });
	await wait(300);
	const save = await center(".lectern-card.is-draft button.mod-cta");
	await clickAt(save.x, save.y);
}

// Start capturing.
const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
	frames.push({ t: f.metadata.timestamp, data: f.data });
	await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

// Open the deck before recording starts so the first frame isn't a blank tab.
await page.evaluate(async (p) => {
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(app.vault.getAbstractFileByPath(p));
}, DECK);
await wait(2500);
await page.evaluate(() => {
	const slide = document.querySelectorAll(".lectern-view [data-scope-kind='pptx']")[1]
		?? [...document.querySelectorAll("[data-scope-kind='pptx']")][1];
	slide?.scrollIntoView({ block: "start" });
	slide?.closest(".lectern-scroll, .view-content")?.scrollBy(0, -30);
});
// Small enough that the slide and the comment strip fit side by side at 1280px,
// otherwise cards overlay the slide edge (CommentRail.needsStrip).
await page.evaluate(() => app.workspace.getMostRecentLeaf().view.zoom?.set(0.45));
await page.mouse.move(640, 420);
await wait(600);

await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
await wait(1200);

// 1. Slide text is real text: drag-select a line, comment on it.
await dragSelect("[data-scope-kind='pptx']", "The triad is a way of asking questions, not a checklist");
await wait(700);
await page.keyboard.press("Control+Alt+KeyM");
await wait(500);
await typeNote("Likely midterm question. Compare with STRIDE in Reading 3.");
await wait(1800);

// 2. Same thing on a PDF, in Obsidian's own viewer, via the right-click menu.
const pdfRow = await center(`.nav-file-title[data-path="${PDF}"]`);
await clickAt(pdfRow.x, pdfRow.y);
await wait(2500);
const sel = await dragSelect(".textLayer", "Attackers follow the cheapest path.");
await wait(500);
await page.mouse.click(sel.x2 - 30, sel.y, { button: "right" });
await wait(700);
const item = await page.locator(".menu-item", { hasText: "Highlight and comment" }).first().boundingBox();
await clickAt(item.x + item.width / 2, item.y + item.height / 2);
await wait(500);
await typeNote("Phishing the help desk beats breaking crypto.");
await wait(1800);

// 3. Comments are plain markdown in a sidecar note.
await page.evaluate(() => {
	const el = document.querySelector('.nav-folder-title[data-path="File-Notes"]');
	if (el?.parentElement?.classList.contains("is-collapsed")) el.click();
});
await wait(400);
const side = await center(`.nav-file-title[data-path^="File-Notes/Reading 3"]`);
await clickAt(side.x, side.y);
await wait(2600);

await cdp.send("Page.stopScreencast");
await wait(300);
frames.forEach((f, i) => writeFileSync(join(out, `${String(i).padStart(4, "0")}_${f.t.toFixed(3)}.png`), Buffer.from(f.data, "base64")));
await page.evaluate(() => document.getElementById("demo-cursor")?.remove());
console.log(`${frames.length} frames -> ${out}`);
process.exit(0);
