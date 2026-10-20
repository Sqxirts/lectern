const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const path = globalThis.LECTERN_PDF; // set LECTERN_PDF to a vault-relative PDF path before running cdp.mjs
const leaf = app.workspace.getLeaf("tab");
await leaf.openFile(app.vault.getAbstractFileByPath(path));
window.__spikeLeaf = leaf;
let child; for (let i = 0; i < 50; i++) { child = leaf.view.viewer?.child; if (child?.pdfViewer?.pdfViewer?.pagesCount) break; await sleep(200); }
await sleep(800);
const viewer = child.pdfViewer.pdfViewer, container = viewer.container;
const chain = []; let el = container; while (el && el !== leaf.view.containerEl.parentElement) { const cs = getComputedStyle(el); chain.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} pos=${cs.position} ${el.clientWidth}x${el.clientHeight} top=${el.offsetTop}`); el = el.parentElement; }
const pv = viewer.getPageView(0);
const tl = pv.textLayer.textLayer;
const kinds = {}; tl.textDivs.forEach((d) => { const k = d.nodeType === 3 ? "text" : d.tagName + (d.childNodes.length === 1 && d.firstChild.nodeType === 3 ? ">text" : ">" + [...d.childNodes].map((c) => c.nodeName).join(",")); kinds[k] = (kinds[k] ?? 0) + 1; });
const tlChildren = {}; [...pv.textLayer.div.childNodes].forEach((c) => { const k = c.nodeName + (c.className ? "." + c.className : ""); tlChildren[k] = (tlChildren[k] ?? 0) + 1; });
const items = tl.textContentItems;
return {
  chain,
  childContainer: `${child.containerEl.className}`,
  siblings: [...container.parentElement.children].map((c) => c.className),
  pageDiv: { cls: pv.div.className, dataPage: pv.div.dataset.pageNumber, children: [...pv.div.children].map((c) => c.className), pos: getComputedStyle(pv.div).position, border: getComputedStyle(pv.div).borderTopWidth },
  textDivKinds: kinds, textLayerChildren: tlChildren,
  sampleItem: { str: items[3].str, transform: items[3].transform, width: items[3].width, height: items[3].height },
  pdfPageView: pv.pdfPage?.view, viewportHasConvert: typeof pv.viewport?.convertToViewportPoint,
  docOnApp: !!child.pdfViewer.pdfDocument, viewerScope: !!child.scope, keysInScope: child.scope?.keys?.map((k) => `${k.modifiers}+${k.key}`).slice(0, 20),
};
