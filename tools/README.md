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
| `render.probe.ts` | Renders a deck to one standalone HTML per slide through the plugin's own pipeline (`src/pptx/postProcess.ts`), its real `styles.css`, and its layout passes bundled from source. |
| `audit.probe.ts` | Per slide, counts `<a:blip>` references in the XML against `<img>` elements emitted. Catches images dropped during extraction. |
| `bytes.probe.ts` | Compares the bytes the renderer embeds against the originals in `ppt/media`. Catches truncation and re-encoding. |
| `inspect.mjs` | Measures rendered slides in Chrome: clipped text, overlapping text boxes, broken images, images resized by outside CSS, and text that blends into what is painted behind it. Given PowerPoint's export, labels text PowerPoint also draws illegibly as "authored". |
| `diff.mjs` | Scores every slide against PowerPoint's export (share of pixels that differ) and ranks the deck worst-first. Optional heatmaps. |
| `realdom.mjs` | Re-wraps one probe slide in the plugin's real DOM chain and stylesheet. Use it when a fault reproduces in Obsidian but not in a bare page. |
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
node tools/inspect.mjs /tmp/ours /tmp/report.json /tmp/truth
node tools/diff.mjs /tmp/ours /tmp/truth /tmp/diff.json /tmp/heat
node tools/compare.mjs /tmp/ours /tmp/truth /tmp/cmp 11
```

`playwright` is a dev dependency; `npm install` is all the setup there is. It
drives the installed Chrome (`channel: "chrome"`), so no browser download.
`export-slides.ps1` follows the deck's own aspect ratio; a 4:3 deck exports at
1280x960.

**The probe must never carry its own copy of plugin logic.** On 2026-09-26 it
had a hand-copied CSS rule and skipped a layout pass, so it passed slides the
plugin broke (week 5 slide 11) and failed lines the plugin drew. Anything the
plugin does to a slide belongs in `fixSlide()` or a layout pass the probe
bundles, never pasted into a tool.

## Reading a diff score

`badPct` below about 1.5% is font hinting and subpixel wrap noise. Above
about 3%, open `compare.mjs` on the worst slides: something structural is
wrong. A change that lowers the average but raises a few slides is still a
regression on those slides; compare per slide, not only the mean. Line spacing
from each font's CSS `normal` metrics was tried and rejected this way: it
scored worse on 11 of 12 decks than PowerPoint's flat 1.2x.

## What each check has actually caught

- **clipped text**: text boxes laid out tighter than their own line boxes, on
  41 of 172 slides across three decks.
- **images resized by outside CSS**: Obsidian's `img { max-width: 100% }`
  undoing a `<a:srcRect>` crop, so a cropped photo renders as blank space.
- **overlapping text boxes**: added to prove that relaxing `overflow` did not
  make text collide. It did not.
- **broken images**: EMF and WMF emitted under an `image/png` MIME type.
- **low contrast**: white header text on a cell whose navy fill the
  unstyled-table reset stripped (week 5 slide 11), and every dark title and
  section slide in CYBR 226 weeks 1-3, whose background layer painted behind
  the slide's white. Nothing else in the harness saw either.
- **pixel diff**: all of CYBR 310's Facet theme art (freeforms, transparency,
  diagonal connectors), per-run text formatting, theme table styles, picture
  transparency, and slide numbers the renderer dropped. Twelve decks went from
  2-27% different to under 1.5% for ten of them.

Always copy the deck before pointing PowerPoint at it, and check the source
hash afterwards. Coursework decks are not replaceable.
