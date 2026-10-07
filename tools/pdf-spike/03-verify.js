const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaf = window.__spikeLeaf;
const child = leaf.view.viewer.child;
const app_ = child.pdfViewer, viewer = app_.pdfViewer, bus = app_.eventBus, container = viewer.container;
window.__spikeCleanup?.();
document.querySelectorAll(".spike-hl").forEach((n) => n.remove());
container.style.paddingRight = "";
viewer.currentScaleValue = "page-width"; await sleep(800);

// Target: text item 3 of each page, characters 0..min(8,len).
function rangeFor(pv) {
  const tl = pv.textLayer?.textLayer; if (!tl?.textDivs?.length) return null;
  const i = Math.min(3, tl.textDivs.length - 1);
  const node = tl.textDivs[i].firstChild ?? tl.textDivs[i];
  const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, Math.min(8, node.length ?? 0));
  return r;
}
// Draw in % of the layer box, so a CSS-only zoom keeps boxes on the text.
function draw(pv) {
  const r = rangeFor(pv); if (!r) return;
  let layer = pv.div.querySelector(".spike-hl");
  if (!layer) {
    layer = document.createElement("div"); layer.className = "spike-hl";
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1";
    pv.div.insertBefore(layer, pv.textLayer.div);
  }
  layer.replaceChildren();
  const L = layer.getBoundingClientRect();
  for (const c of r.getClientRects()) {
    if (c.width < 1) continue;
    const b = document.createElement("div");
    b.style.cssText = `position:absolute;background:rgba(255,200,0,.45);left:${(c.left-L.left)/L.width*100}%;top:${(c.top-L.top)/L.height*100}%;width:${c.width/L.width*100}%;height:${c.height/L.height*100}%`;
    layer.appendChild(b);
  }
}
// Error = drawn box vs where the text is right now.
function err(idx) {
  const pv = viewer.getPageView(idx); const b = pv.div.querySelector(".spike-hl > div"); const r = rangeFor(pv);
  if (!b || !r) return null;
  const a = b.getBoundingClientRect(), t = r.getClientRects()[0];
  return +Math.max(Math.abs(a.left-t.left), Math.abs(a.top-t.top), Math.abs(a.width-t.width), Math.abs(a.height-t.height)).toFixed(2);
}
const onText = (e) => draw(e.source);
bus._on("textlayerrendered", onText);
window.__spikeCleanup = () => bus._off("textlayerrendered", onText);
for (let i = 0; i < viewer.pagesCount; i++) draw(viewer.getPageView(i));

const out = { errAtFit: err(0) };
viewer.currentScale *= 1.5;
await sleep(30); out.errMidZoom30ms = err(0);
await sleep(1500); out.errAfterZoom = err(0);
viewer.currentPageNumber = viewer.pagesCount; await sleep(1500); out.errLastPage = err(viewer.pagesCount - 1);
viewer.currentPageNumber = 1; await sleep(1500); out.errBackPage1 = err(0);

// Rail option 2: narrow the scroller instead of padding it.
viewer.currentScaleValue = "page-width"; await sleep(1000);
const s0 = viewer.currentScale, w0 = container.clientWidth;
let events = 0; const onS = () => events++; bus._on("scalechanging", onS);
container.style.width = "calc(100% - 292px)";
await sleep(2000);
const idle0 = events; await sleep(1500);
const pageBox = viewer.getPageView(0).div.getBoundingClientRect(), cBox = container.getBoundingClientRect();
out.narrow = { widthBefore: w0, widthAfter: container.clientWidth, scaleBefore: +s0.toFixed(4), scaleAfter: +viewer.currentScale.toFixed(4),
  scaleEvents: idle0, scaleEventsIdle: events - idle0, pageInsideScroller: pageBox.right <= cBox.right, errAfterNarrow: err(0),
  freeStripPx: Math.round(leaf.view.containerEl.getBoundingClientRect().right - cBox.right) };
bus._off("scalechanging", onS);

// Text-index agreement: rendered text layer vs getTextContent() for the same page.
const pv1 = viewer.getPageView(0);
const items = pv1.textLayer.textLayer.textContentItems;
const tc = await (await app_.pdfDocument.getPage(1)).getTextContent();
const n = Math.min(items.length, tc.items.length);
let mismatch = 0; for (let i = 0; i < n; i++) if (items[i].str !== tc.items[i].str) mismatch++;
out.indices = { layerItems: items.length, textContentItems: tc.items.length, strMismatches: mismatch, emptyItems: tc.items.filter((x) => x.str === "").length, eolItems: tc.items.filter((x) => x.hasEOL).length };

// Obsidian's own selection string for a programmatic selection.
const r = rangeFor(pv1); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
out.selection = { text: sel.toString(), obsidianRangeStr: child.getTextSelectionRangeStr(pv1.div) };
sel.removeAllRanges();
return out;
