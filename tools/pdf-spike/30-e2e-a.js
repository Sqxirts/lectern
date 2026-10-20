// Part A: reload the plugin, comment on page 1, check drawing, zoom, comment on page 7.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PATH = globalThis.LECTERN_PDF; // set LECTERN_PDF to a vault-relative PDF path before running cdp.mjs
window.__spikeLeaf?.detach(); window.__e2eLeaf?.detach();
document.querySelectorAll(".lectern-pdf-strip, .lectern-pdf-overlay").forEach((n) => n.remove());
await app.plugins.disablePlugin("lectern");
await app.plugins.enablePlugin("lectern");
const plugin = app.plugins.plugins["lectern"];
const out = {};

const leaf = app.workspace.getLeaf("tab");
await leaf.openFile(app.vault.getAbstractFileByPath(PATH));
app.workspace.setActiveLeaf(leaf, { focus: true });
window.__e2eLeaf = leaf;
let ctrl; for (let i = 0; i < 80 && !(ctrl = plugin.pdfComments.forLeaf(leaf)); i++) await sleep(150);
out.controllerAttached = !!ctrl;
const child = leaf.view.viewer.child, viewer = child.pdfViewer.pdfViewer, container = viewer.container;
viewer.currentScaleValue = "page-width"; await sleep(800);
out.scaleNoRail = +viewer.currentScale.toFixed(3);

// Select one whole text item with real words on a page.
function selectItem(pageNo, minLen = 12) {
  const pv = viewer.getPageView(pageNo - 1);
  const divs = pv.textLayer.textLayer.textDivs;
  const i = divs.findIndex((d) => (d.textContent ?? "").trim().length >= minLen);
  const r = document.createRange(); r.selectNodeContents(divs[i]);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return { item: i, text: divs[i].textContent, range: r.cloneRange() };
}
const err = (a, b) => +Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.right - b.right), Math.abs(a.bottom - b.bottom)).toFixed(2);
const fits = () => { const p = viewer.getPageView(0).div.getBoundingClientRect(), c = container.getBoundingClientRect(); return p.right <= c.right + 0.5; };

async function comment(pageNo, body) {
  const s = selectItem(pageNo);
  app.commands.executeCommandById("lectern:comment-on-selection");
  await sleep(500);
  const draft = leaf.view.containerEl.querySelector(".lectern-pdf-strip .lectern-card.is-draft textarea");
  if (!draft) return { ...s, draft: false };
  draft.value = body;
  leaf.view.containerEl.querySelector(".lectern-card.is-draft button.mod-cta").click();
  await sleep(1200);
  return { ...s, draft: true };
}

const c1 = await comment(1, "e2e page one");
out.c1 = { draftOpened: c1.draft, text: c1.text };
const box = () => viewer.getPageView(0).div.querySelector(".lectern-pdf-box");
const textRect = () => { const pv = viewer.getPageView(0); const r = document.createRange(); r.selectNodeContents(pv.textLayer.textLayer.textDivs[c1.item]); return r.getBoundingClientRect(); };
const card = () => leaf.view.containerEl.querySelector(".lectern-pdf-strip .lectern-card:not(.is-draft)");
out.afterC1 = {
  stripActive: leaf.view.containerEl.querySelector(".lectern-pdf-strip").classList.contains("is-active"),
  containerRight: container.style.right, scaleWithRail: +viewer.currentScale.toFixed(3), pageFits: fits(),
  boxes: viewer.getPageView(0).div.querySelectorAll(".lectern-pdf-box").length,
  boxVsTextPx: box() && err(box().getBoundingClientRect(), textRect()),
  cardTopVsBoxPx: card() && box() && Math.round(card().getBoundingClientRect().top - box().getBoundingClientRect().top),
  connectors: leaf.view.containerEl.querySelectorAll(".lectern-pdf-overlay path").length,
  selectionCleared: window.getSelection().rangeCount === 0,
};
const note = app.vault.getAbstractFileByPath(`File-Notes/${PATH.split("/").pop()}.comments.md`);
const md = note ? await app.vault.read(note) : "";
out.sidecar = { exists: !!note, kind: /"kind":"(\w+)"/.exec(md)?.[1], selection: /"selection":\[([\d,]+)\]/.exec(md)?.[1], heading: /^## .*$/m.exec(md)?.[0] };

// Zoom: boxes must follow the re-render, card must stay level.
viewer.currentScale = viewer.currentScale * 1.6; await sleep(1800);
out.afterZoom = { scale: +viewer.currentScale.toFixed(3), boxVsTextPx: box() && err(box().getBoundingClientRect(), textRect()), cardTopVsBoxPx: card() && box() && Math.round(card().getBoundingClientRect().top - box().getBoundingClientRect().top) };
viewer.currentScaleValue = "page-width"; await sleep(1200);

// Second comment on page 7.
viewer.currentPageNumber = 7; await sleep(1500);
const c2 = await comment(7, "e2e page seven");
out.c2 = { draftOpened: c2.draft, text: c2.text, cards: leaf.view.containerEl.querySelectorAll(".lectern-pdf-strip .lectern-card").length };
viewer.currentPageNumber = 1; await sleep(1000);
container.scrollTop = 0; await sleep(500);
return out;
