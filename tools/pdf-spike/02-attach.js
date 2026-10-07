// Spike: own highlight layer + rail padding on Obsidian's native PDF view.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaf = window.__spikeLeaf;
const child = leaf.view.viewer.child;
const app_ = child.pdfViewer;          // PDFViewerApplication-like
const viewer = app_.pdfViewer;         // PDF.js PDFViewer
for (let i = 0; i < 50 && !viewer.pagesCount; i++) await sleep(200);
const bus = app_.eventBus;
const container = viewer.container;

const stats = { textlayer: {}, scalechanging: 0, draws: 0, resizes: 0 };
const scaleLog = [];

// Draw a box over text items 0..2 of a page, in a layer under the text layer.
function draw(pageView) {
  const tl = pageView.textLayer?.textLayer;
  if (!tl?.textDivs?.length) return;
  let layer = pageView.div.querySelector(".spike-hl");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "spike-hl";
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1";
    pageView.div.insertBefore(layer, pageView.textLayer.div);
  }
  layer.replaceChildren();
  const divs = tl.textDivs;
  const range = document.createRange();
  range.setStart(divs[0].firstChild ?? divs[0], 0);
  const last = divs[Math.min(2, divs.length - 1)];
  range.setEnd(last.firstChild ?? last, (last.firstChild ?? last).length ?? 0);
  const pageBox = pageView.div.getBoundingClientRect();
  for (const r of range.getClientRects()) {
    if (r.width < 1) continue;
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;background:rgba(255,200,0,.45);left:${r.left - pageBox.left}px;top:${r.top - pageBox.top}px;width:${r.width}px;height:${r.height}px`;
    layer.appendChild(box);
  }
  stats.draws++;
}

const onText = (e) => {
  const pv = e.source;
  stats.textlayer[pv.id] = (stats.textlayer[pv.id] ?? 0) + 1;
  draw(pv);
};
const onScale = (e) => { stats.scalechanging++; scaleLog.push(+e.scale.toFixed(4)); };
bus._on("textlayerrendered", onText);
bus._on("scalechanging", onScale);
const ro = new ResizeObserver(() => stats.resizes++);
ro.observe(container);
window.__spikeCleanup = () => { bus._off("textlayerrendered", onText); bus._off("scalechanging", onScale); ro.disconnect(); };

// Draw on pages already rendered before we subscribed.
for (let i = 0; i < viewer.pagesCount; i++) {
  const pv = viewer.getPageView(i);
  if (pv?.textLayer?.textLayer?.textDivs?.length) draw(pv);
}

// Alignment: our first box vs the real first text div, in px.
function alignment(pageIdx) {
  const pv = viewer.getPageView(pageIdx);
  const box = pv.div.querySelector(".spike-hl > div");
  const div0 = pv.textLayer?.textLayer?.textDivs?.[0];
  if (!box || !div0) return { page: pageIdx + 1, drawn: !!box, textLayer: !!div0 };
  const a = box.getBoundingClientRect(), b = div0.getBoundingClientRect();
  return { page: pageIdx + 1, dx: +(a.left - b.left).toFixed(2), dy: +(a.top - b.top).toFixed(2) };
}

const out = { pages: viewer.pagesCount, startScaleValue: viewer.currentScaleValue, startScale: +viewer.currentScale.toFixed(4) };

// Phase A: put the viewer in page-width fit, then reserve the rail strip.
viewer.currentScaleValue = "page-width";
await sleep(800);
out.fitScaleBefore = +viewer.currentScale.toFixed(4);
out.containerWidthBefore = container.clientWidth;
const before = { ...stats, textlayer: { ...stats.textlayer } };
container.style.paddingRight = "292px";   // same as .has-rail
child.onResize?.();                        // what Obsidian calls on pane resize
await sleep(2500);
out.phaseA = {
  containerWidthAfter: container.clientWidth,
  fitScaleAfter: +viewer.currentScale.toFixed(4),
  scaleEventsDuring: stats.scalechanging - before.scalechanging,
  resizeObserverHits: stats.resizes - before.resizes,
  pageWidth: viewer.getPageView(0).div.offsetWidth,
  pageRightEdgeVsPadding: Math.round(container.getBoundingClientRect().right - viewer.getPageView(0).div.getBoundingClientRect().right),
};
// Watch for a feedback loop: any scale changes in a further quiet second?
const quiet0 = stats.scalechanging; await sleep(1500);
out.phaseA.scaleEventsWhileIdle = stats.scalechanging - quiet0;
out.alignAfterPad = alignment(0);

// Phase B: zoom in 150%.
const drawsB = stats.draws;
viewer.currentScale = viewer.currentScale * 1.5;
await sleep(1500);
out.phaseB = { scale: +viewer.currentScale.toFixed(4), redraws: stats.draws - drawsB, align: alignment(0) };

// Phase C: scroll to the last page and back.
const drawsC = stats.draws;
viewer.currentPageNumber = viewer.pagesCount;
await sleep(1500);
out.phaseC_lastPage = alignment(viewer.pagesCount - 1);
viewer.currentPageNumber = 1;
await sleep(1500);
out.phaseC = { redraws: stats.draws - drawsC, backOnPage1: alignment(0) };

// Phase D: real pane resize (shrink the leaf's container width).
const drawsD = stats.draws;
leaf.view.containerEl.style.width = "700px";
await sleep(1500);
viewer.currentScaleValue = "page-width";
await sleep(1500);
out.phaseD = { containerWidth: container.clientWidth, scale: +viewer.currentScale.toFixed(4), redraws: stats.draws - drawsD, align: alignment(0) };
leaf.view.containerEl.style.width = "";

out.textlayerEventsPerPage = stats.textlayer;
out.scaleLog = scaleLog;
return out;
