# Architecture

One `FileView` subclass owns the chrome (toolbar, zoom, comment rail) and delegates content to a renderer chosen by extension.

```
src/
  main.ts                    plugin entry: views, extensions, commands
  view/LecternView.ts        the FileView, orchestrates everything
  view/Toolbar.ts            toolbar rendering
  view/ZoomController.ts     transform-based zoom, pan, sizer sync
  renderers/                 one per file kind, behind a shared interface
  pptx/extract.ts            JSZip walk for slide text and speaker notes
  comments/anchoring.ts      build and resolve text anchors in the DOM
  comments/CommentStore.ts   vault I/O for the sidecar
  comments/sidecarFormat.ts  the markdown format, no Obsidian imports
  comments/CommentRail.ts    margin cards and connectors
  comments/CommentSession.ts the comment workflow, shared by LecternView and PDF tabs
  pdf/                       PDF comments inside Obsidian's own viewer (see below)
  util/safeHtml.ts           sanitise renderer HTML before inserting it
```

Renderers sit behind an interface, so swapping the pptx engine is a one-file change.

Anchor scoping contract: any element a comment can attach inside carries `data-scope-kind` (`pptx` / `docx` / `code` / `xlsx`) and `data-scope-index` (slide, page, line, or sheet name). `anchoring.ts` reads those and needs to know nothing else about the renderer. The sidecar format and resolution order are in [comments.md](comments.md).

## PDF comments

PDFs are not opened by Lectern. Obsidian's PDF viewer keeps them, and `PdfCommentManager` attaches one `PdfCommentController` to each open PDF tab:

```
pdf/pdfInternals.ts          one probe for every private Obsidian / PDF.js field used
pdf/pdfAnchoring.ts          anchors on PDF.js text items, pure, no DOM
pdf/pdfDom.ts                DOM selection <-> item span
pdf/pdfHighlights.ts         percent-unit boxes under the text layer, markers for unrendered pages
pdf/PdfCommentController.ts  one PDF tab: session host, events, the rail strip
pdf/PdfCommentManager.ts     one controller per PDF tab, kept in sync on workspace events
```

**This relies on Obsidian internals that are not public API.** The only public PDF hook is `loadPdfJs()`. The controller reads `view.viewer.child`, its PDF.js `PDFViewer` and event bus, and subscribes to `textlayerrendered`. The controller itself never patches prototypes. The one exception is `pdf/pdfContextMenu.ts`: the PDF right-click menu is built in the viewer's private `onContextMenu` and fires no event, so it wraps `Menu.prototype.showAtMouseEvent` to add **Highlight and comment**. The wrap adds its item only for right-clicks on a PDF page it controls, swallows its own errors, always calls the original, and unwraps on unload (or goes inert if another plugin wrapped the method after it). Tested on Obsidian 1.14.4 with PDF.js 5.3.34. If an update changes those fields, `probePdfInternals` returns null, the feature switches itself off with a notice, and the viewer is left untouched. It also stays off while PDF++ is enabled, since both would draw over the same pages.

Two PDF.js behaviours shape the code:

- **The fit ignores padding.** PDF.js fits pages to the scroller's `clientWidth`, which includes padding. So the rail can't reserve space with padding the way `.has-rail` does elsewhere. The scroller is narrowed (`right: 292px`, then `child.onResize()`), and the rail sits beside it, translating with the scroll (`RailBeside`).
- **The text layer gets thrown away.** It is rebuilt on zoom, and far-off pages are emptied with no event at all. Highlights are redrawn on `textlayerrendered`, and anything detached is redrawn on scroll and resize.

[pdf-highlights-scope.md](pdf-highlights-scope.md) has the full design and the measurements behind it. `tools/pdf-spike/` has the CDP scripts used to test against a running Obsidian started with `--remote-debugging-port`.

## Security

`pptx-to-html` returns HTML strings built from a file you may not have authored, so everything goes through `util/safeHtml.ts` first: `<script>`, `<iframe>`, `<object>`, `javascript:` URLs and all `on*` attributes are stripped in a detached document before insertion. Inline `style` attributes are kept deliberately, because the renderer positions every shape with them, which is why Obsidian's own `sanitizeHTMLToDom()` is not used here.

## Dependencies

| Package | Purpose |
|---|---|
| `@jvmr/pptx-to-html` | pptx to DOM, the reason slide text is selectable |
| `docx-preview` | docx rendering |
| SheetJS `xlsx` | workbook parsing, installed from the SheetJS CDN, not npm |
| `highlight.js` | syntax highlighting |
| `jszip` | reading speaker notes and slide text from the pptx zip |

**Note on SheetJS:** the `xlsx` package on npm is frozen at 0.18.5 (2022). SheetJS moved distribution to their own CDN and treats the registry copy as stale. `package.json` therefore points at `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
