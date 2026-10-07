# PDF highlights and comments: scope

Status: scoped 2026-10-07, not started. Branch `feat/pdf-highlights-scope`.

## Goal

The same commenting you get on slides, docs and code, on PDFs: select text, `Ctrl+Alt+M`, a highlight plus a margin card, stored in the same `File-Notes/<file>.comments.md` sidecar. The PDF itself is never written to.

We do this **inside Obsidian's own PDF viewer**, not by replacing it. You keep page links (`[[x.pdf#page=3]]`), the viewer's search, its thumbnails and outline, and "Copy link to selection".

## What Obsidian gives us (checked against the installed 1.14.4 bundle)

The public API has exactly one PDF hook: `loadPdfJs()`. Everything below is private and can change in any Obsidian release.

| Piece | Where | What we use it for |
|---|---|---|
| View type `"pdf"` | `workspace.getLeavesOfType("pdf")` | Find open PDF views |
| `view.viewer.child` | the per-file PDF controller | Entry point to everything else |
| `child.pdfViewer` | wraps PDF.js 5.3.34's `PDFViewer` | page count, `pdfDocument`, `eventBus` |
| eventBus `textlayerrendered` | fires per page, carries `source.id` (page number) and `source.textLayer` | Draw highlights once a page's text exists |
| `child.getPage(n)` | page view, `div.dataset.loaded` when rendered | Page container to draw into |
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
- Append absolutely positioned divs to a `.vault-scope-pdf-highlights` layer inside the page div, under the text layer so selection still works. `mix-blend-mode: multiply` in light theme, `screen` in dark.

PDF.js throws the text layer away and rebuilds it on zoom and when a page scrolls far off and back. The event fires again each time, so we simply redraw. Nothing is cached in pixel units.

Before the text layer exists, a comment still needs a vertical position for its card. Use a zero-height marker at the top of its page div. The page div exists at full size even when unrendered. Swap to the real highlight when the page renders, then `rail.layout()`.

### 4. Margin rail

Reuse `CommentRail` unchanged if possible. It needs a scrolling wrapper and a content element:

- wrapper: the viewer's `.pdf-viewer-container` (the scroller).
- content: the `.pdfViewer` element inside it.

That requires scoped CSS: `.pdf-viewer-container.has-rail` gets the same right padding as `.vault-scope-wrapper.has-rail`. PDF.js centres pages, so padding the scroller shifts them left, which is what we want.

**This is the riskiest part.** PDF.js sizes pages from the container width on "page-fit" zoom. Adding padding may trigger a re-fit loop, or the viewer's own `ResizeObserver` may fight us. Spike this first (step 1 below). The fallback is the rail as a separate right-sidebar leaf listing the PDF's comments, without connectors. It is uglier but has no layout coupling.

### 5. Glue

New `src/pdf/PdfCommentController.ts`, one per open PDF leaf. It owns the store, rail, layer and event subscriptions, and implements `RailDelegate`. Most of `ScopeView`'s comment methods (`commitDraft`, `saveBody`, `setStatus`, `deleteComment`, `openSidecar`, `reloadComments`) move into a shared base or helper so both classes use them. Do that extraction as its own commit, with existing tests green, before adding PDF code.

`main.ts`:

- On `layout-change` and `file-open`, attach a controller to every `"pdf"` leaf that lacks one. Poll briefly for `viewer.child.pdfViewer`, because it appears after the file loads.
- Detach on leaf close or file change.
- The `comment-on-selection`, `open-comment-note` and `reload-comments` commands accept either a `ScopeView` or a PDF controller for the active leaf.
- Setting "Comments on PDFs" (default on). Off means no attachment at all.

`NEVER_REGISTER` keeps `pdf`. We never take the extension from Obsidian.

## Build order

Each step ends with `npm run build`, `npm test`, and a manual check on a real course PDF.

1. **Spike (half a day).** Attach to an open PDF leaf, log `textlayerrendered`, draw one hard-coded highlight box, add `has-rail` padding, then zoom and scroll. Answers the two open risks: re-fit loop, and highlights surviving re-render. Stop and reassess if the padding fights PDF.js.
2. Extract shared comment logic out of `ScopeView`. No behaviour change.
3. `PdfAnchor` + `pdfAnchoring.ts` + tests on synthetic `getTextContent` items: exact indices, shifted indices, moved page, whitespace drift, orphan.
4. `PdfHighlightLayer` + controller, create and display comments.
5. Rail wiring, connectors, click-highlight-to-focus.
6. Version guard and notices, the PDF++ conflict check, settings toggle, README.

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
