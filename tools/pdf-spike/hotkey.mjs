// Select text in the open CE3 PDF, press the real Ctrl+Alt+M, check a draft card opens, then cancel it.
import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
const before = await page.evaluate(async () => {
  const leaf = app.workspace.getLeavesOfType("pdf")[0];
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await new Promise((r) => setTimeout(r, 500));
  const pv = leaf.view.viewer.child.pdfViewer.pdfViewer.getPageView(0);
  const div = pv.textLayer.textLayer.textDivs.find((d) => (d.textContent ?? "").trim().length > 8);
  const r = document.createRange(); r.selectNodeContents(div);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  return s.toString();
});
await page.keyboard.press("Control+Alt+KeyM");
await page.waitForTimeout(600);
const after = await page.evaluate(() => {
  const leaf = app.workspace.getLeavesOfType("pdf")[0];
  const draft = leaf.view.containerEl.querySelector(".vault-scope-pdf-strip .vault-scope-card.is-draft");
  draft?.querySelectorAll("button")[1]?.click(); // Cancel
  return { draftOpened: !!draft };
});
await page.waitForTimeout(400);
const end = await page.evaluate(() => {
  const leaf = app.workspace.getLeavesOfType("pdf")[0];
  return { stripActiveAfterCancel: leaf.view.containerEl.querySelector(".vault-scope-pdf-strip").classList.contains("is-active"), sidecarWritten: !!app.vault.getAbstractFileByPath("File-Notes") };
});
console.log(JSON.stringify({ selected: before, ...after, ...end }));
await browser.close().catch(() => {});
process.exit(0);
