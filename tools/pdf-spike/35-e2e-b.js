// Part B: reopen, placement before render, scroll, click-to-focus, resolve, delete, restore.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PATH = globalThis.LECTERN_PDF; // set LECTERN_PDF to a vault-relative PDF path before running cdp.mjs
const plugin = app.plugins.plugins["lectern"];
await app.plugins.disablePlugin("lectern"); await app.plugins.enablePlugin("lectern");
const p2 = app.plugins.plugins["lectern"];
window.__e2eLeaf?.detach(); await sleep(300);
const leaf = app.workspace.getLeaf("tab");
await leaf.openFile(app.vault.getAbstractFileByPath(PATH));
app.workspace.setActiveLeaf(leaf, { focus: true });
window.__e2eLeaf = leaf;
let ctrl; for (let i = 0; i < 80 && !(ctrl = p2.pdfComments.forLeaf(leaf)); i++) await sleep(150);
await sleep(1500);
const viewer = leaf.view.viewer.child.pdfViewer.pdfViewer, container = viewer.container;
const out = { reattached: !!ctrl };
const rel = (el) => Math.round(el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop);
const cardFor = (id) => leaf.view.containerEl.querySelector(`.lectern-pdf-strip .lectern-card[data-comment-id="${id}"]`);
const [p1, p7] = ctrl.placed;

out.onOpen = {
  steps: [...ctrl.resolved.values()].map((r) => r.placement.step),
  p1: { kind: p1.elements[0]?.className, cardMinusTarget: Math.round(cardFor(p1.comment.id).getBoundingClientRect().top - p1.elements[0].getBoundingClientRect().top) },
  p7: { kind: p7.elements[0]?.className, connected: p7.elements[0]?.isConnected, targetTop: rel(p7.elements[0]), page7Top: rel(viewer.getPageView(6).div), cardMinusTarget: Math.round(cardFor(p7.comment.id).getBoundingClientRect().top - p7.elements[0].getBoundingClientRect().top) },
};

// Scroll to page 7: marker becomes a box once the text layer renders.
viewer.currentPageNumber = 7; await sleep(1800);
const p7box = ctrl.placed[1].elements[0];
const pv7 = viewer.getPageView(6); const divs = pv7.textLayer.textLayer.textDivs;
const sel = ctrl.resolved.get(p7.comment.id).placement.span;
const r = document.createRange(); r.selectNodeContents(divs[sel.startItem]);
const t = r.getBoundingClientRect(), b = p7box.getBoundingClientRect();
out.onPage7 = { kind: p7box.className, boxVsTextPx: +Math.max(Math.abs(t.left - b.left), Math.abs(t.top - b.top), Math.abs(t.bottom - b.bottom)).toFixed(2), cardMinusTarget: Math.round(cardFor(p7.comment.id).getBoundingClientRect().top - b.top) };

// Click the highlight: its card gets focus.
container.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
await sleep(400);
out.clickFocus = cardFor(p7.comment.id).classList.contains("is-focused");

// Scroll back to page 1, then far away again: nothing should drift to the top.
viewer.currentPageNumber = 1; await sleep(1500);
viewer.currentPageNumber = 8; await sleep(1500);
const e7 = ctrl.placed[1].elements[0];
out.afterEviction = { connected: e7.isConnected, cardMinusTarget: Math.round(cardFor(p7.comment.id).getBoundingClientRect().top - e7.getBoundingClientRect().top) };
viewer.currentPageNumber = 1; await sleep(1200);

// Resolve page 1's comment: card hides, box dims.
[...cardFor(p1.comment.id).querySelectorAll("button")].find((x) => x.textContent === "Resolve").click(); await sleep(800);
out.afterResolve = { cardShown: !!cardFor(p1.comment.id), boxResolved: !!viewer.getPageView(0).div.querySelector(".lectern-pdf-box.is-resolved") };

// Delete page 7's comment; resolved one is hidden, so the strip should be released.
[...cardFor(p7.comment.id).querySelectorAll("button")].find((x) => x.textContent === "Delete").click(); await sleep(1200);
const strip = leaf.view.containerEl.querySelector(".lectern-pdf-strip");
viewer.currentScaleValue = "page-width"; await sleep(800);
out.afterDelete = { stripActive: strip.classList.contains("is-active"), containerRight: container.style.right, scale: +viewer.currentScale.toFixed(3), cardsLeft: leaf.view.containerEl.querySelectorAll(".lectern-card").length };

// Close the tab: everything we added must go.
leaf.detach(); await sleep(500);
out.afterClose = { strays: document.querySelectorAll(".lectern-pdf-strip, .lectern-pdf-overlay, .lectern-pdf-highlights").length };
const note = app.vault.getAbstractFileByPath(`File-Notes/${PATH.split("/").pop()}.comments.md`);
out.noteBeforeCleanup = note ? (await app.vault.read(note)).match(/"status":"\w+"/g) : null;
if (note) await app.vault.delete(note);
delete window.__e2eLeaf;
return out;
