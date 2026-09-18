# Vault Scope

An Obsidian plugin that previews Office and code files, lets you **copy text out of PowerPoint slides**, and adds **Word-style margin comments** stored as plain markdown in your vault.

## Why

Existing preview plugins render `.pptx` slides to an HTML5 canvas. Canvas output is pixels: there are no text nodes, so nothing can be selected, Ctrl+F finds nothing, and screen readers read nothing.

Vault Scope renders slides to real DOM instead. Selection and copy then work with no special handling, because the text is actually text.

## Features

**Preview**
- `.docx`, `.xlsx`, `.xls`, `.pptx`, and 60 code and text extensions
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
- Resolve to hide, toggle to bring resolved ones back

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

## Install

No release builds yet, so build it yourself.

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
npm test           # 27 vitest tests
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
  util/safeHtml.ts        sanitise renderer HTML before inserting it
```

Renderers sit behind an interface, so swapping the pptx engine is a one-file change.

Anchor scoping contract: any element a comment can attach inside carries `data-scope-kind` (`pptx` / `docx` / `code` / `xlsx`) and `data-scope-index` (slide, page, line, or sheet name). `anchoring.ts` reads those and needs to know nothing else about the renderer.

## Security

`pptx-to-html` returns HTML strings built from a file you may not have authored, so everything goes through `util/safeHtml.ts` first: `<script>`, `<iframe>`, `<object>`, `javascript:` URLs and all `on*` attributes are stripped in a detached document before insertion. Inline `style` attributes are kept deliberately, because the renderer positions every shape with them, which is why Obsidian's own `sanitizeHTMLToDom()` is not used here.

## Known limits

- `@jvmr/pptx-to-html` describes its own fidelity as practical, not pixel-perfect. No SmartArt, animations, embedded media or 3D, and fonts are not embedded. That is the trade for selectable text.
- Commenting on code files is read-mode only. A highlight span cannot live inside a `<textarea>`.
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
