# How comments are stored

One markdown sidecar per source file, in `File-Notes/` by default:

```
File-Notes/lecture-3.pptx.comments.md
```

Your `.pptx` is never rewritten. Rewriting an OOXML zip risks corrupting a file you did not author, and a sidecar is the only version Obsidian's global search can see.

Machine-readable data sits in a `%%scope` block. Search still indexes it, and Reading view hides it. Live Preview would show it as dimmed JSON, so Lectern draws each block as a small chip instead, such as **Page 1 ↗**, that opens the source file at that spot (PDFs jump to the exact selection). To see and edit the raw block, run **Toggle Live Preview/Source mode**. The file on disk is never changed:

```markdown
## Slide 4: "the CIA triad is not a checklist"

%%scope
{"id":"c3","anchor":{"kind":"pptx","slide":4,"quote":"...","prefix":"Remember ","suffix":". Instead"},"status":"open","created":"2026-09-17T14:02"}
%%

Check whether this is on the midterm.
```

A highlight with no note gets the body `_No note yet._`, so the section never looks broken. Lectern reads that line back as an empty note, and the card offers **Add note**.

## Frontmatter

Lectern rewrites the frontmatter on every save:

```yaml
---
title: Comments on lecture-3.pptx
type: reference
area: meta
source: Courses/lecture-3.pptx
open_comments: 4
resolved_comments: 1
tags:
  - annotation
---
```

`area` comes from the source file's top-level folder. The counts are there for the comment index: `Comments.base` lists every note tagged `annotation` whose name ends in `.comments.md`, and sorts by `open_comments`. Edits you make to the frontmatter by hand are overwritten on the next save; the body below it is yours.

## Anchors

Anchors follow the W3C Web Annotation TextQuoteSelector pattern: the exact quote plus about 30 characters either side. On open, resolution tries, in order:

1. prefix + quote + suffix inside the right slide, page or line
2. the quote alone inside that same scope
3. the quote anywhere in the file
4. otherwise the comment is badged **orphaned** in the margin

A comment is never silently dropped.

## PDF anchors

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
