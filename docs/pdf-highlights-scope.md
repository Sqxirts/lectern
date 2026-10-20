# PDF highlights and comments: scope

Status: scoped 2026-10-07, spike passed the same day (see "Spike results"). Branch `feat/pdf-highlights-scope`.

## Goal

The same commenting you get on slides, docs and code, on PDFs: select text, `Ctrl+Alt+M`, a highlight plus a margin card, stored in the same `File-Notes/<file>.comments.md` sidecar. The PDF itself is never written to.

We do this **inside Obsidian's own PDF viewer**, not by replacing it. You keep page links (`[[x.pdf#page=3]]`), the viewer's search, its thumbnails and outline, and "Copy link to selection".

## What Obsidian gives us (checked against the installed 1.14.4 bundle)

The public API has exactly one PDF hook: `loadPdfJs()`. Everything below is private and can change in any Obsidian release.

| Piece | Where | What we use it for |
|---|---|---|
| View type `"pdf"` | `workspace.getLeavesOfType("pdf")` | Find open PDF views |
| `view.viewer.child` | the per-file PDF controller | Entry point to everything else |
| `child.pdfViewer` | PDF.js's application object (`PDFViewerApplication`-shaped) | `pdfDocument`, `eventBus` |
| `child.pdfViewer.pdfViewer` | the actual PDF.js 5.3.34 `PDFViewer` | `pagesCount`, `getPageView(i)`, `container` (`.pdf-viewer-container`), `currentScale`, `currentScaleValue` |
| eventBus `textlayerrendered` | fires per page, carries `source.id` (page number) and `source.textLayer` | Draw highlights once a page's text exists |
| `child.getPage(n)` | page view, `div.dataset.loaded` when rendered | Page container to draw into |
| `child.onResize()` | Obsidian's own pane-resize handler | Refit pages after we add or remove the rail strip |
| `textLayer.textDivs` / `textContentItems` | one div per PDF.js text item, each with `data-idx` | Map a DOM selection to item indices and back |
| `child.getTextSelectionRangeStr(pageDiv)` | returns `"startIdx,startOff,endIdx,endOff"` | The same selection format Obsidian puts in `#page=N&selection=...` links |

**We read these, we do not patch them.** PDF++ monkey-patches the viewer's prototypes, which is why it breaks on Obsidian updates. We only subscribe to an event bus that already exists and read fields. If a field goes missing after an update, the feature turns itself off with one notice instead of breaking the viewer.

One built-in we **cannot** reuse: `child.highlightText()` clears the previous highlight before drawing, so it only ever shows one. It also rewrites the text divs in place. We draw our own layer instead and leave the text layer alone.

## Design

### 1. Anchor

New kind in `src/comments/types.ts`:

```ts
export interface PdfAnchor extends QuoteAnchor {
	kind: "pdf";
	/** 1-based page number. */
	page: number;
	/** PDF.js text-item range, the same four numbers Obsidian uses in &selection=. */
	selection?: [number, number, number, number];
}
```

The anchor stores both. The indices are exact while the PDF is unchanged. The quote is what survives a re-export of the PDF, where the item indices shift. `anchorLabel` gets `Page N`. The sidecar stores anchors as JSON, so `sidecarFormat.ts` needs no change.

### 2. Resolution ladder (pure, testable without Obsidian)

New `src/pdf/pdfAnchoring.ts`, working on PDF.js `getTextContent()` items rather than the DOM. That matters because PDF.js only renders the text layer for pages near the viewport. A comment on page 40 must still resolve (or orphan) the moment you open the file.

1. `selection` indices, accepted only if the text they cover still equals `quote` (whitespace-insensitive).
2. prefix + quote + suffix within that page's item text.
3. quote alone within that page.
4. quote anywhere in the document (page number changed).
5. orphaned.

Reuse `looseIndexOf` / `normalise` from `anchoring.ts`; export them rather than copying. Output: `{ page, startIdx, startOff, endIdx, endOff }`.

### 3. Drawing

New `src/pdf/PdfHighlightLayer.ts`. On each `textlayerrendered` for a page that has comments:

- Build a DOM `Range` from the resolved item indices over `textLayer.textDivs`.
- `range.getClientRects()`, convert to page-relative boxes, merge boxes on the same line.
- Append absolutely positioned divs to a `.lectern-pdf-highlights` layer inside the page div, under the text layer so selection still works. `mix-blend-mode: multiply` in light theme, `screen` in dark.
- Position boxes in **percent of the layer box**, measured from the layer's own `getBoundingClientRect()` (not the page div's, which includes its border). Percent units keep boxes on the text during PDF.js's CSS-only zoom, before the text layer is re-rendered.

PDF.js throws the text layer away and rebuilds it on zoom and when a page scrolls far off and back. The event fires again each time, so we simply redraw. Nothing is cached in pixel units.

Before the text layer exists, a comment still needs a vertical position for its card. Use a zero-height marker at the top of its page div. The page div exists at full size even when unrendered. Swap to the real highlight when the page renders, then `rail.layout()`.

### 4. Margin rail

**Padding the scroller does not work** (spike, phase A). `clientWidth` includes padding, so PDF.js's page-width fit ignores it and the page runs under the rail.

**Narrow the scroller instead**, then call `child.onResize()`. Set `.pdf-viewer-container` to `width: calc(100% - var(--lectern-rail-width) - 32px)` while there are comments to show, and call `child.onResize()` after every toggle. PDF.js then refits into the narrower box, and Obsidian's own resize observer keeps it fitted on later pane resizes.

Consequence for `CommentRail`: the rail can no longer live *inside* the scroller (it would be clipped), so it sits in the freed strip as a sibling of the scroller. Today's rail scrolls with the content because it is inside the wrapper. Add a mode where the rail is outside, and on the scroller's `scroll` event it translates its card layer by `-scrollTop`. Connectors become one SVG over both the scroller and the strip, recomputed on scroll. Keep that change inside `CommentRail` behind a constructor option, so `LecternView` is untouched.

The sidebar-list fallback is no longer needed.

### 5. Glue

New `src/pdf/PdfCommentController.ts`, one per open PDF leaf. It owns the store, rail, layer and event subscriptions, and implements `RailDelegate`. Most of `LecternView`'s comment methods (`commitDraft`, `saveBody`, `setStatus`, `deleteComment`, `openSidecar`, `reloadComments`) move into a shared base or helper so both classes use them. Do that extraction as its own commit, with existing tests green, before adding PDF code.

`main.ts`:

- On `layout-change` and `file-open`, attach a controller to every `"pdf"` leaf that lacks one. Poll briefly for `viewer.child.pdfViewer`, because it appears after the file loads.
- Detach on leaf close or file change.
- The `comment-on-selection`, `open-comment-note` and `reload-comments` commands accept either a `LecternView` or a PDF controller for the active leaf.
- Setting "Comments on PDFs" (default on). Off means no attachment at all.

`NEVER_REGISTER` keeps `pdf`. We never take the extension from Obsidian.

## Build order

Each step ends with `npm run build`, `npm test`, and a manual check on a real course PDF.

1. ~~Spike.~~ Done 2026-10-07, passed. See "Spike results".
2. ~~Extract shared comment logic out of `LecternView`.~~ Done 2026-10-07: `src/comments/CommentSession.ts`, Obsidian-free with the store, rail and notices injected, 13 unit tests. Verified end to end in the live app on the code and pptx fixtures by `tools/pdf-spike/10-comment-smoke.js`.
3. ~~`PdfAnchor` + `pdfAnchoring.ts` + tests.~~ Done 2026-10-07. `src/pdf/pdfAnchoring.ts`: `PdfPageText` (items joined with a newline after each `hasEOL` item, offsets to and from item indices), `buildPdfAnchor`, and `resolvePdfAnchor`. Its fallback order is: stored indices if they still cover the quote, then context, then quote, then other pages nearest first, then orphaned. 18 tests. The context step also found two bugs in the shared matcher, now fixed for slides, docs and code too:
   - `looseIndexOf(text, needle, from)` ignored `from` on its whitespace-tolerant fallback.
   - The context step searched for the quote *from* the context match. The exact-match path runs first, so a cleanly typed copy of the quote further down beat the line-wrapped copy inside the match. It now searches *within* the match (`looseIndexWithin`). Both have regression tests that fail without the fix.
4. ~~Highlight layer + controller.~~ Done 2026-10-07, together with step 5. New in `src/pdf/`:
   - `pdfInternals.ts`: one probe for every private field we touch.
   - `pdfDom.ts`: selection to item span and back, 8 jsdom tests.
   - `pdfHighlights.ts`: percent-unit boxes under the text layer, plus markers for unrendered pages placed at the text's estimated height from its PDF transform.
   - `PdfCommentController.ts`: one per PDF tab, host for `CommentSession`.
   - `PdfCommentManager.ts`: keeps one controller per PDF tab in sync on `layout-change` and `file-open`.
5. ~~`CommentRail` outside-the-scroller mode.~~ Done: `RailBeside` (strip, overlay, `onReserve`). The rail translates with the scroller, connectors are drawn on an overlay in viewport terms, and the scroller is narrowed with `right: 292px` plus `child.onResize()`. Clicking a highlight focuses its card: the boxes sit under the text layer, so the click is hit-tested by position.
6. Version guard, PDF++ check and settings toggle: done (`Comments on PDFs`, default on). **README still to do.**

## Spike results (2026-10-07)

Run against the live Obsidian 1.14.4 on a Windows desktop, started with `--remote-debugging-port=9229` and driven over CDP by Playwright. Test file: `CYBR 310 - Syllabus (original PDF).pdf` (8 pages). The scripts are in `tools/pdf-spike/` (`cdp.mjs` runs any of the numbered snippets in the Obsidian window). The spike changed nothing in the plugin. It added DOM from outside and removed it afterwards.

| Question | Result |
|---|---|
| Does `textlayerrendered` re-fire after zoom, scroll-away-and-back, and pane resize? | Yes, every time. Page 1 saw it 3 times. Pages 4 to 6 never rendered at all, which confirms resolution must run on `getTextContent()`, not the DOM. |
| Do our boxes stay on the text? | Worst error **0.02 px**: at fit width, 30 ms into a zoom (CSS-only phase), after the zoom re-render, on the last page, and after scrolling back. |
| Do `getTextContent()` indices match the text layer's? | Yes. Page 1 gives 469 items both ways, with 0 string mismatches. 34 items are empty end-of-line items (`hasEOL`); they still take an index, so never filter them out. |
| Does Obsidian's selection string use the same indices? | Yes. Selecting item 3 chars 0..3 ("310") returned `3,0,3,3` from `getTextSelectionRangeStr(pageView.div)`. |
| Does padding the scroller for the rail fight PDF.js? | No feedback loop (0 zoom changes while idle), but padding is **ignored** by the fit, so the page runs under the rail. |
| Does narrowing the scroller work? | Yes, once `child.onResize()` is called. Scale went 2.70 to 2.34 and the page sits inside the box, again with 0 idle zoom changes. It stayed fitted through a real pane shrink to 1200px and back, and removing the strip restored 2.70. |

## Live test results, step 4 (2026-10-07)

`tools/pdf-spike/30-e2e-a.js`, `35-e2e-b.js` and `hotkey.mjs` against the real plugin build, on the CYBR 310 syllabus. Everything passed:

- **Draft and refit:** the draft opens in the strip, and the scroller narrows so pages refit (zoom 2.34 to 1.98) and still fit.
- **Alignment:** a box sits within 0.02 px of its text, before and after a 1.6× zoom. The card is level with its highlight (0 to 4 px).
- **Comment note:** `"kind":"pdf"`, `"selection":[5,0,5,12]`, heading `Page 1: "Introduction"`.
- **Reopening:** both comments come back through the `selection` step. A page-7 comment, before page 7 renders, shows as a marker, with its card 2 px from it. After scrolling there it's a box, 0.02 px from the text.
- **Interaction:** clicking a box focuses its card. Resolving dims the box and hides the card. Deleting the last open comment releases the strip and restores the scroller.
- **Hotkey:** the real `Ctrl+Alt+M` works inside the PDF viewer. Cancelling a draft writes nothing.
- **Cleanup:** closing the tab removes everything we added. The only elements left belonged to another open PDF tab's own controller.

Three bugs only the live run could show, all fixed:

1. **`createSvg` throws on a space-separated `cls`.** It adds the string as one class token, and SVG elements reject one containing a space. `createDiv` assigns `className`, which is why the same string worked there. Pass an array. A failed start also left the strip in the page, so `attach` now destroys the controller if `start` throws.
2. **CSS variables were scoped to `.lectern-container`.** The PDF pieces live outside it, so the boxes, connectors and card accent rendered with no colour. The measurements all passed; only the screenshot showed it. The variables now go on the PDF elements too.
3. **PDF.js evicts far-off pages by emptying their div, and fires no event.** That took a marker with it, which read as top 0 and pulled its card to the top of the rail. Fix: on scroll and resize, redraw any comment whose element `isConnected` is false.

## Risks and limits

- **Private API drift.** Mitigation: a single `probePdfInternals(view)` function checks every field we touch. If anything is missing, show one notice ("PDF comments are off: this Obsidian version changed its PDF viewer") and attach nothing. Record the tested versions (Obsidian 1.14.4, PDF.js 5.3.34) in the README.
- **Scanned PDFs** have no text layer, so there's nothing to select. Out of scope. Supporting them means box-shaped highlights stored by position, which is a separate feature.
- **Embeds** (`![[x.pdf]]` in a note) use a separate viewer instance. Out of scope for v1. The controller design allows it later.
- **PDF++ installed alongside.** Both draw over the same pages. Detect `app.plugins.enabledPlugins.has("pdf-plus")` and show a notice. Don't try to make them coexist.
- **Multi-page selections.** `getTextSelectionRangeStr` takes one page div. v1 rejects a selection that crosses pages with a notice, the same way the slide anchoring rejects cross-slide selections.
- **Ligatures and hyphenation.** PDF text items can split words oddly ("ﬁ", soft hyphens at line ends). The whitespace-insensitive matcher handles spacing, not ligatures. Add NFKC normalisation in `normalise()` if the tests on real course PDFs show misses.

## Test material

- Unit tests: synthetic text items, no PDF needed.
- Fixture: add `make_pdf()` to `fixtures/make_fixtures.py` (3 pages, one repeated phrase on two pages for the ladder, one line-wrapped sentence).
- Manual: a real CYBR 310 lecture PDF from the vault, one scanned PDF to confirm the graceful no-op.
