# Vault Scope

An Obsidian plugin that previews Office and code files, lets you **copy text out of PowerPoint slides**, and adds **Word-style margin comments** stored as plain markdown in your vault. The comments work on PDFs too, inside Obsidian's own PDF viewer.

## Why

Existing preview plugins render `.pptx` slides to an HTML5 canvas. Canvas output is pixels: there are no text nodes, so nothing can be selected, Ctrl+F finds nothing, and screen readers read nothing.

Vault Scope renders slides to real DOM instead. Selection and copy then work with no special handling, because the text is actually text.

## Features

**Preview**
- `.docx`, `.xlsx`, `.xls`, `.pptx`, and 132 code and text extensions (the list is `CODE_EXTENSION_GROUPS` in `src/constants.ts`)
- Syntax highlighting with line numbers
- Zoom (Ctrl+scroll or toolbar), middle-drag to pan
- Edit and save, in place, for text files
- Sheet tabs and merged-cell support for workbooks

**PowerPoint**
- Slides are real DOM, so drag-select and Ctrl+C work
- `Copy slide` puts the current slide's text on the clipboard
- `Copy all` exports the deck as markdown, one heading per slide
- Speaker notes panel, read straight from the `.pptx` zip

**Comments**
- Select text, press `Ctrl+Alt+M`, write a note
- Cards sit in a right margin rail with a connector to the highlight, and stack instead of overlapping
- Resolve to hide; turn on "show resolved by default" in settings to keep them visible

**PDF comments**
- The same comments on PDFs, in Obsidian's built-in PDF viewer, with no separate viewer to switch to
- Select text, `Ctrl+Alt+M`: an amber highlight, a card in a margin strip, a connector, the same sidecar note
- Page links, search, thumbnails and "Copy link to selection" keep working, because the viewer is Obsidian's own
- The PDF file is never written to
- Toggle with "Comments on PDFs" in settings

## How comments are stored

One markdown sidecar per source file, in `File-Notes/` by default:

```
File-Notes/lecture-3.pptx.comments.md
```

Your `.pptx` is never rewritten. Rewriting an OOXML zip risks corrupting a file you did not author, and a sidecar is the only version Obsidian's global search can see.

Machine-readable data sits in a `%%scope` block. Obsidian renders `%% %%` as nothing but still indexes it, so the note reads cleanly and nothing is hidden from search:

```markdown
## Slide 4: "the CIA triad is not a checklist"

%%scope
{"id":"c3","anchor":{"kind":"pptx","slide":4,"quote":"...","prefix":"Remember ","suffix":". Instead"},"status":"open","created":"2026-09-17T14:02"}
%%

Check whether this is on the midterm.
```

Anchors follow the W3C Web Annotation TextQuoteSelector pattern: the exact quote plus about 30 characters either side. On open, resolution tries, in order:

1. prefix + quote + suffix inside the right slide, page or line
2. the quote alone inside that same scope
3. the quote anywhere in the file
4. otherwise the comment is badged **orphaned** in the margin

A comment is never silently dropped.

### PDF anchors

A PDF anchor stores two addresses for the same text:

```json
{"kind":"pdf","page":1,"selection":[5,0,5,12],"quote":"Introduction","prefix":"...","suffix":"..."}
```

`selection` is PDF.js text-item indices and character offsets, the same four numbers Obsidian writes into `#page=1&selection=5,0,5,12` links. It is exact while the PDF is unchanged. The quote is what survives a re-export, when the item boundaries shift. Resolution runs on `page.getTextContent()` rather than the DOM, because PDF.js only renders text for pages near the viewport:

1. the stored indices, if they still cover the stored quote
2. prefix + quote + suffix on the stored page
3. the quote alone on that page
4. the same on other pages, nearest page first
5. otherwise orphaned

## Install

The [0.1.0 release](https://github.com/Sqxirts/vault-scope/releases/tag/0.1.0) predates the slide-fidelity work and PDF comments, so build from source until a new one is cut.

```bash
git clone https://github.com/Sqxirts/vault-scope.git
cd vault-scope
npm install
npm approve-scripts esbuild   # npm blocks postinstall scripts by default
cp .env.example .env.local    # then edit it to point at your vault
npm run build
```

Set `VAULT_SCOPE_OUT` in `.env.local` to your vault's plugin folder:

```
VAULT_SCOPE_OUT=C:/path/to/YourVault/.obsidian/plugins/vault-scope
```

Without it the build goes to `./dist` and you can copy `main.js`, `manifest.json` and `styles.css` across by hand.

Then **fully quit and reopen Obsidian**. Registering a new view type only happens at startup, so a plugin reload is not enough. Enable Vault Scope under Settings, Community plugins.

## Development

```bash
npm run dev        # rebuild on save
npm test           # 163 vitest tests
npm run typecheck
```

After the first launch you can pick up a rebuild by toggling the plugin off and on, without restarting Obsidian.

Test fixtures are generated, not committed:

```bash
pip install python-pptx python-docx openpyxl
python fixtures/make_fixtures.py
```

## Architecture

One `FileView` subclass owns the chrome (toolbar, zoom, comment rail) and delegates content to a renderer chosen by extension.

```
src/
  main.ts                 plugin entry: views, extensions, commands
  view/ScopeView.ts       the FileView, orchestrates everything
  view/Toolbar.ts         toolbar rendering
  view/ZoomController.ts  transform-based zoom, pan, sizer sync
  renderers/              one per file kind, behind a shared interface
  pptx/extract.ts         JSZip walk for slide text and speaker notes
  comments/anchoring.ts   build and resolve text anchors in the DOM
  comments/CommentStore.ts   vault I/O for the sidecar
  comments/sidecarFormat.ts  the markdown format, no Obsidian imports
  comments/CommentRail.ts    margin cards and connectors
  comments/CommentSession.ts the comment workflow, shared by ScopeView and PDF tabs
  pdf/                    PDF comments inside Obsidian's own viewer (see below)
  util/safeHtml.ts        sanitise renderer HTML before inserting it
```

Renderers sit behind an interface, so swapping the pptx engine is a one-file change.

Anchor scoping contract: any element a comment can attach inside carries `data-scope-kind` (`pptx` / `docx` / `code` / `xlsx`) and `data-scope-index` (slide, page, line, or sheet name). `anchoring.ts` reads those and needs to know nothing else about the renderer.

### PDF comments

PDFs are not opened by Vault Scope. Obsidian's PDF viewer keeps them, and `PdfCommentManager` attaches one `PdfCommentController` to each open PDF tab:

```
pdf/pdfInternals.ts        one probe for every private Obsidian / PDF.js field used
pdf/pdfAnchoring.ts        anchors on PDF.js text items, pure, no DOM
pdf/pdfDom.ts              DOM selection <-> item span
pdf/pdfHighlights.ts       percent-unit boxes under the text layer, markers for unrendered pages
pdf/PdfCommentController.ts  one PDF tab: session host, events, the rail strip
pdf/PdfCommentManager.ts   one controller per PDF tab, kept in sync on workspace events
```

**This relies on Obsidian internals that are not public API.** The only public PDF hook is `loadPdfJs()`. The controller reads `view.viewer.child`, its PDF.js `PDFViewer` and event bus, and subscribes to `textlayerrendered`. It never patches prototypes. Tested on Obsidian 1.14.4 with PDF.js 5.3.34. If an update changes those fields, `probePdfInternals` returns null, the feature switches itself off with a notice, and the viewer is left untouched. It also stays off while PDF++ is enabled, since both would draw over the same pages.

Two PDF.js behaviours shape the code:

- **The fit ignores padding.** PDF.js fits pages to the scroller's `clientWidth`, which includes padding. So the rail can't reserve space with padding the way `.has-rail` does elsewhere. The scroller is narrowed (`right: 292px`, then `child.onResize()`), and the rail sits beside it, translating with the scroll (`RailBeside`).
- **The text layer gets thrown away.** It is rebuilt on zoom, and far-off pages are emptied with no event at all. Highlights are redrawn on `textlayerrendered`, and anything detached is redrawn on scroll and resize.

`docs/pdf-highlights-scope.md` has the full design and the measurements behind it. `tools/pdf-spike/` has the CDP scripts used to test against a running Obsidian started with `--remote-debugging-port`.

## Security

`pptx-to-html` returns HTML strings built from a file you may not have authored, so everything goes through `util/safeHtml.ts` first: `<script>`, `<iframe>`, `<object>`, `javascript:` URLs and all `on*` attributes are stripped in a detached document before insertion. Inline `style` attributes are kept deliberately, because the renderer positions every shape with them, which is why Obsidian's own `sanitizeHTMLToDom()` is not used here.

## Known limits

- `@jvmr/pptx-to-html` describes its own fidelity as practical, not pixel-perfect. No SmartArt, animations, embedded media or 3D, and fonts are not embedded. That is the trade for selectable text.
- Commenting on code files is read-mode only. A highlight span cannot live inside a `<textarea>`.
- PDF comments need a text layer. Scanned PDFs have nothing to select. One comment cannot span two pages. PDF embeds inside notes (`![[x.pdf]]`) are not covered.
- Spreadsheets are capped at 5,000 rows and 256 columns per sheet.
- If another preview plugin claims the same extensions, Vault Scope skips those it cannot register. Per-extension toggles are in settings.

## Dependencies

| Package | Purpose |
|---|---|
| `@jvmr/pptx-to-html` | pptx to DOM, the reason slide text is selectable |
| `docx-preview` | docx rendering |
| SheetJS `xlsx` | workbook parsing, installed from the SheetJS CDN, not npm |
| `highlight.js` | syntax highlighting |
| `jszip` | reading speaker notes and slide text from the pptx zip |

**Note on SheetJS:** the `xlsx` package on npm is frozen at 0.18.5 (2022). SheetJS moved distribution to their own CDN and treats the registry copy as stale. `package.json` therefore points at `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

## Licence

MIT
