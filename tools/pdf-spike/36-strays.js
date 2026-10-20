const m = app.plugins.plugins["lectern"].pdfComments;
const els = [...document.querySelectorAll(".lectern-pdf-strip, .lectern-pdf-overlay, .lectern-pdf-highlights")];
return { pdfTabs: app.workspace.getLeavesOfType("pdf").map((l) => l.view.file?.path), controllers: m.controllers.size,
  strays: els.map((e) => ({ cls: e.className, ownerFile: app.workspace.getLeavesOfType("pdf").find((l) => l.view.containerEl.contains(e))?.view.file?.path ?? "NO OWNER (leak)" })) };
