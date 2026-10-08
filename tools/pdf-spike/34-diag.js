const leaf = window.__e2eLeaf, viewer = leaf.view.viewer.child.pdfViewer.pdfViewer;
const ctrl = app.plugins.plugins["vault-scope"].pdfComments.forLeaf(leaf);
const c = viewer.container.getBoundingClientRect();
const resolved = [...ctrl.resolved.entries()].map(([id, r]) => ({ id, step: r.placement.step, page: r.placement.span?.page }));
const placed = ctrl.placed.map((p) => ({ id: p.comment.id, orphaned: p.orphaned, n: p.elements.length, cls: p.elements[0]?.className, connected: p.elements[0]?.isConnected, top: p.elements[0] && Math.round(p.elements[0].getBoundingClientRect().top - c.top + viewer.container.scrollTop), styleTop: p.elements[0]?.style.top }));
const pv7 = viewer.getPageView(6);
return { resolved, placed, page7: { top: Math.round(pv7.div.getBoundingClientRect().top - c.top + viewer.container.scrollTop), h: pv7.div.offsetHeight, layer: !!pv7.div.querySelector(".vault-scope-pdf-highlights"), textRendered: !!pv7.textLayer?.textLayer?.textDivs?.length }, loadedTexts: [...ctrl.loadedTexts.keys()], pageBoxes: [...ctrl.pageBoxes.keys()] };
