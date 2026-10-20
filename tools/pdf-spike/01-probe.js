const path = globalThis.LECTERN_PDF; // set LECTERN_PDF to a vault-relative PDF path before running cdp.mjs
const file = app.vault.getAbstractFileByPath(path);
const leaf = app.workspace.getLeaf("tab");
await leaf.openFile(file);
const view = leaf.view;
let child;
for (let i = 0; i < 50; i++) {
  child = view?.viewer?.child;
  if (child?.pdfViewer?.pdfViewer?.pagesCount || child?.pdfViewer?.pagesCount) break;
  await new Promise((r) => setTimeout(r, 200));
}
const pv = child.pdfViewer;
const inner = pv.pdfViewer;
window.__spikeLeaf = leaf;
return {
  viewType: view.getViewType(),
  childKeys: Object.keys(child).slice(0, 60),
  childProto: Object.getOwnPropertyNames(Object.getPrototypeOf(child)).slice(0, 80),
  pvKeys: Object.keys(pv).slice(0, 60),
  innerCtor: inner?.constructor?.name,
  innerPages: inner?.pagesCount,
  pvPages: pv.pagesCount,
  eventBusOnPv: !!pv.eventBus, eventBusOnInner: !!inner?.eventBus,
  scale: inner?.currentScaleValue ?? pv.currentScaleValue,
  containerCls: (inner?.container ?? pv.container)?.className,
  viewerCls: (inner?.viewer ?? pv.viewer)?.className,
};
