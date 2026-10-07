const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaf = window.__spikeLeaf, child = leaf.view.viewer.child;
const app_ = child.pdfViewer, viewer = app_.pdfViewer, bus = app_.eventBus, container = viewer.container;
let events = 0; const onS = () => events++; bus._on("scalechanging", onS);
const fits = () => { const p = viewer.getPageView(0).div.getBoundingClientRect(), c = container.getBoundingClientRect(); return p.right <= c.right && p.left >= c.left; };
const out = { modeNow: viewer.currentScaleValue, fitsBefore: fits() };

child.onResize(); await sleep(1200);
out.afterOnResize = { scale: +viewer.currentScale.toFixed(4), fits: fits(), events };
if (!out.afterOnResize.fits) { viewer.currentScaleValue = "page-width"; await sleep(1200); }
out.afterReassign = { scale: +viewer.currentScale.toFixed(4), fits: fits(), events };
const e0 = events; await sleep(2000); out.idleEvents = events - e0;

// Real pane resize while narrowed: does Obsidian's own observer keep it fitted?
leaf.view.containerEl.style.width = "1200px"; await sleep(1500);
out.paneShrunk = { scrollerWidth: container.clientWidth, fits: fits(), scale: +viewer.currentScale.toFixed(4) };
leaf.view.containerEl.style.width = ""; await sleep(1500);
out.paneRestored = { scrollerWidth: container.clientWidth, fits: fits(), scale: +viewer.currentScale.toFixed(4) };

// Remove the rail strip again: does it re-expand?
container.style.width = ""; child.onResize(); await sleep(1200);
out.railRemoved = { scrollerWidth: container.clientWidth, scale: +viewer.currentScale.toFixed(4) };
bus._off("scalechanging", onS);
// Clean up everything the spike added.
window.__spikeCleanup?.(); document.querySelectorAll(".spike-hl").forEach((n) => n.remove());
return out;
