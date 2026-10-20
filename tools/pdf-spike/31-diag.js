const plugin = app.plugins.plugins["lectern"];
const leaf = window.__e2eLeaf, view = leaf.view;
const child = view.viewer?.child, a = child?.pdfViewer, v = a?.pdfViewer;
const m = plugin.pdfComments;
return {
  hasManager: !!m, setting: plugin.settings.pdfComments,
  pdfLeaves: app.workspace.getLeavesOfType("pdf").length, isOurLeafListed: app.workspace.getLeavesOfType("pdf").includes(leaf),
  controllers: m?.controllers?.size, attaching: m?.attaching?.size,
  checks: {
    viewType: view.getViewType(), file: view.file?.path,
    containerElIsHTMLElement: child?.containerEl instanceof HTMLElement, containerElCtor: child?.containerEl?.constructor?.name,
    onResize: typeof child?.onResize, busOn: typeof a?.eventBus?._on, busOff: typeof a?.eventBus?._off,
    containerIsHTMLElement: v?.container instanceof HTMLElement, getPageView: typeof v?.getPageView, pagesCount: v?.pagesCount, doc: !!a?.pdfDocument,
  },
  pdfPlus: app.plugins.enabledPlugins.has("pdf-plus"),
};
