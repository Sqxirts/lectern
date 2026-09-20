# Fidelity harness

Tools for checking what the pptx renderer actually draws against what
PowerPoint draws. Not part of `npm test`: they need PowerPoint, a real Chrome,
and a deck to point at.

They exist because three separate image faults on one slide reached the user
before being caught. Eyeballing a deck does not scale to 50 slides, and a green
unit suite says nothing about layout.

## The pieces

| File | What it does |
|---|---|
| `export-slides.ps1` | Exports every slide to PNG through PowerPoint over COM. Ground truth. Opens the deck read-only. |
| `emf.ps1` | Rasterises one EMF/WMF to PNG through GDI+. The same conversion the plugin does, as a standalone script. |
| `render.probe.ts` | Renders a deck to one standalone HTML per slide, with metafiles converted. |
| `audit.probe.ts` | Per slide, counts `<a:blip>` references in the XML against `<img>` elements emitted. Catches images dropped during extraction. |
| `bytes.probe.ts` | Compares the bytes the renderer embeds against the originals in `ppt/media`. Catches truncation and re-encoding. |
| `inspect.mjs` | Measures rendered slides in Chrome: clipped text, overlapping text boxes, broken images, and images resized by outside CSS. |
| `realdom.mjs` | Wraps one slide in the plugin's real DOM chain and real stylesheet. Use it when a fault reproduces in Obsidian but not in a bare page. |
| `compare.mjs` | Stacks PowerPoint's export above our render for a given slide, as one PNG. |

## Running them

The `.probe.ts` files are vitest tests kept outside `tests/` so the suite does
not pick them up. Copy one in to run it:

```sh
cp tools/render.probe.ts tests/render.test.ts
RENDER_DECK="/path/to/deck.pptx" RENDER_OUT=/tmp/ours RENDER_PS=tools/emf.ps1 \
  npx vitest run tests/render.test.ts
rm tests/render.test.ts
```

Then measure and compare:

```sh
powershell -File tools/export-slides.ps1 -Deck /tmp/copy.pptx -OutDir /tmp/truth
node tools/inspect.mjs /tmp/ours /tmp/report.json
node tools/compare.mjs /tmp/ours /tmp/truth /tmp/cmp 11
```

`inspect.mjs` launches Chrome via `channel: "chrome"` rather than a downloaded
browser, because the Playwright build installed for the MCP server is usually a
different revision than the npm package expects.

## What each check has actually caught

- **clipped text**: text boxes laid out tighter than their own line boxes, on
  41 of 172 slides across three decks.
- **images resized by outside CSS**: Obsidian's `img { max-width: 100% }`
  undoing a `<a:srcRect>` crop, so a cropped photo renders as blank space.
- **overlapping text boxes**: added to prove that relaxing `overflow` did not
  make text collide. It did not.
- **broken images**: EMF and WMF emitted under an `image/png` MIME type.

Always copy the deck before pointing PowerPoint at it, and check the source
hash afterwards. Coursework decks are not replaceable.
