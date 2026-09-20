/** Rebuild the plugin's actual DOM chain and stylesheet around one slide. */
import { readFileSync, writeFileSync } from "fs";

const slideHtmlFile = process.argv[2];
const stylesFile = process.argv[3];
const out = process.argv[4];

const raw = readFileSync(slideHtmlFile, "utf-8");
const inner = raw.slice(raw.indexOf('<div class="vault-scope-slide">') + '<div class="vault-scope-slide">'.length, raw.lastIndexOf("</div>"));
const styles = readFileSync(stylesFile, "utf-8");

const page = `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;height:100%;background:#fff}
body{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ddd;
  --text-normal:#222;--text-muted:#666;--text-faint:#999;--text-error:#c00;--font-interface:system-ui;--font-monospace:monospace}
${styles}
</style>
<div class="vault-scope-container">
  <div class="vault-scope-wrapper vault-scope-pptx-active">
    <div class="vault-scope-sizer">
      <div class="vault-scope-content">
        <div class="vault-scope-slide-card">
          <div class="vault-scope-slide-header"><span class="vault-scope-slide-number">Slide 11</span></div>
          <div class="vault-scope-slide" style="width:1280px;height:720px">${inner}</div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
  const COLLAPSED_PX = 1;
  for (const svg of Array.from(document.querySelectorAll('svg'))) {
    const box = svg.getBoundingClientRect();
    const stroked = svg.querySelector('[stroke-width]');
    const raw = stroked ? stroked.getAttribute('stroke-width') : null;
    const n = raw ? parseFloat(raw) : NaN;
    const thickness = (isFinite(n) && n > 0) ? n : 1;
    const flatH = box.height < COLLAPSED_PX && box.width >= COLLAPSED_PX;
    const flatV = box.width < COLLAPSED_PX && box.height >= COLLAPSED_PX;
    if (!flatH && !flatV) continue;
    svg.setAttribute('preserveAspectRatio','none');
    if (flatH) { svg.style.height = thickness+'px'; svg.style.top = ((parseFloat(svg.style.top)||0)-thickness/2)+'px'; }
    else { svg.style.width = thickness+'px'; svg.style.left = ((parseFloat(svg.style.left)||0)-thickness/2)+'px'; }
  }
})();
</script>`;

writeFileSync(out, page, "utf-8");
console.log("written", out);
