# How comments are stored

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
