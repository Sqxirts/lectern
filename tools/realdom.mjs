/**
 * Rebuild the plugin's actual DOM chain and stylesheet around one slide.
 *
 * Takes a page written by render.probe.ts and re-wraps its slide in the
 * wrapper/sizer/content/card chain Obsidian uses, with Obsidian's CSS
 * variables, so a fault that only shows inside the plugin can be reproduced
 * in a plain browser. The layout passes come from the probe page's own
 * bundled script (the plugin's real source), not a copy kept here: a copy is
 * exactly what drifted before.
 *
 * Usage: node tools/realdom.mjs <probe slide.html> <styles.css> <out.html>
 */
import { readFileSync, writeFileSync } from "fs";

const [slideHtmlFile, stylesFile, out] = process.argv.slice(2);

const raw = readFileSync(slideHtmlFile, "utf-8");
const open = raw.match(/<div class="lectern-slide"[^>]*>/);
if (!open) throw new Error(`no .lectern-slide in ${slideHtmlFile}`);
const start = open.index + open[0].length;
const scriptAt = raw.indexOf("<script>", start);
const end = raw.lastIndexOf("</div>", scriptAt >= 0 ? scriptAt : raw.length);
const inner = raw.slice(start, end);
const script = scriptAt >= 0 ? raw.slice(scriptAt) : "";
const styles = readFileSync(stylesFile, "utf-8");
const n = (slideHtmlFile.match(/(\d+)\.html$/) ?? [])[1] ?? "?";

const page = `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;height:100%;background:#fff}
body{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ddd;
  --text-normal:#222;--text-muted:#666;--text-faint:#999;--text-error:#c00;--font-interface:system-ui;--font-monospace:monospace}
${styles}
</style>
<div class="lectern-container">
  <div class="lectern-wrapper lectern-pptx-active">
    <div class="lectern-sizer">
      <div class="lectern-content">
        <div class="lectern-slide-card">
          <div class="lectern-slide-header"><span class="lectern-slide-number">Slide ${Number(n)}</span></div>
          ${open[0]}${inner}</div>
        </div>
      </div>
    </div>
  </div>
</div>
${script}`;

writeFileSync(out, page, "utf-8");
console.log("written", out);
