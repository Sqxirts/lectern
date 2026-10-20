// Reload the plugin CSS, scroll the first highlight into view, and report its computed colours.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaf = window.__e2eLeaf, viewer = leaf.view.viewer.child.pdfViewer.pdfViewer;
await app.plugins.disablePlugin("lectern");
await app.plugins.enablePlugin("lectern");
await sleep(2500);
viewer.currentPageNumber = 1; viewer.container.scrollTop = 0; await sleep(800);
const box = leaf.view.containerEl.querySelector(".lectern-pdf-box");
const path = leaf.view.containerEl.querySelector(".lectern-pdf-overlay path");
const card = leaf.view.containerEl.querySelector(".lectern-pdf-strip .lectern-card");
return {
  boxBg: box && getComputedStyle(box).backgroundColor, boxBorder: box && getComputedStyle(box).borderBottomColor,
  connectorStroke: path && getComputedStyle(path).stroke, cardLeftBorder: card && getComputedStyle(card).borderLeftColor,
  cards: leaf.view.containerEl.querySelectorAll(".lectern-pdf-strip .lectern-card").length,
};
