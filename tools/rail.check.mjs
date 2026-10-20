/**
 * Drive the real CommentRail and ZoomController in Chrome, wired the way
 * LecternView wires them, with the real stylesheet and slide-sized cards.
 *
 * Catches two regressions seen 2026-10-12 on a narrow pane:
 * - connectors that ended at the wrong x (card.offsetLeft is relative to the
 *   rail, not the wrapper), so the line ran off the wrong way, and were never
 *   redrawn when the pane was resized;
 * - slides pushed left by a reserved rail strip even when the margins around a
 *   centred slide had room for the cards.
 *
 * Usage: node tools/rail.check.mjs [shot-prefix]
 *   With a prefix, saves <prefix>-wide.png and <prefix>-narrow.png.
 */
import { chromium } from "playwright";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => JSON.stringify(join(root, p).replace(/\\/g, "/"));
const bundle = execFileSync("npx", ["esbuild", "--bundle", "--format=iife", "--global-name=V", "--loader=ts"], {
	cwd: root,
	input: `export { ZoomController } from ${src("src/view/ZoomController.ts")};
export { CommentRail } from ${src("src/comments/CommentRail.ts")};`,
	shell: true,
	encoding: "utf-8",
});
const styles = readFileSync(join(root, "styles.css"), "utf-8");

const page = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
*{box-sizing:border-box} /* Obsidian's app.css does this globally */
.lectern-slide{background:#eef;position:relative;font:32px monospace}
.lectern-highlight{background:#fc8}
${styles}
</style>
<div class="lectern-container" style="height:100vh;display:flex;flex-direction:column">
  <div class="lectern-wrapper lectern-pptx-active" style="flex:1">
    <div class="lectern-sizer"><div class="lectern-content">
      ${[1, 2, 3].map((n) => `<div class="lectern-slide-card"><div class="lectern-slide" style="width:1280px;height:720px">
        <span style="position:absolute;left:80px;top:${n === 2 ? 120 : 400}px">${n === 2 ? '<span class="lectern-highlight" id="hl">#include &lt;string.h&gt;</span>' : "Slide " + n}</span>
      </div></div>`).join("")}
    </div></div>
  </div>
  <div class="ind"></div>
</div>
<script>
// Obsidian's DOM helpers, the subset the rail and zoom use.
const P = Node.prototype;
P.addClass = function (c) { this.classList.add(c); };
P.removeClass = function (c) { this.classList.remove(c); };
P.hasClass = function (c) { return this.classList.contains(c); };
P.toggleClass =function (c, on) { this.classList.toggle(c, on); };
P.setText = function (t) { this.textContent = t; };
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
P.createEl = function (tag, o = {}) {
  const el = document.createElement(tag);
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
  if (o.text) el.textContent = o.text;
  for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
  this.appendChild(el);
  return el;
};
P.createDiv = function (o) { return this.createEl("div", o); };
P.createSpan = function (o) { return this.createEl("span", o); };
P.createSvg = function (tag, o = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (o.cls) for (const c of [].concat(o.cls)) el.classList.add(c);
  this.appendChild(el);
  return el;
};
${bundle}
const q = (s) => document.querySelector(s);
const wrapper = q(".lectern-wrapper"), content = q(".lectern-content");
window.rail = new V.CommentRail(wrapper, content, {}, false);
window.zoom = new V.ZoomController(wrapper, q(".lectern-sizer"), content, q(".ind"), () => rail.layout());
// Same observers as LecternView.watchLayout.
const ro = new ResizeObserver(() => { zoom.measure(); rail.layout(); });
ro.observe(content);
ro.observe(wrapper);
wrapper.addEventListener("scroll", () => rail.onScroll(), { passive: true });
zoom.measure();
rail.setComments([{ comment: { id: "c1", body: "Needed for assignment #5", status: "open", created: "2026-10-08T12:46" }, elements: [q("#hl")], orphaned: false }]);
// LecternView fits once the rail has taken (or declined) its strip.
if (zoom.overflowsWidth) zoom.fitToWidth();
q("#hl").scrollIntoView({ block: "center" });
</script>`;

const state = (tab) =>
	tab.evaluate(() => {
		const w = document.querySelector(".lectern-wrapper");
		const wrap = w.getBoundingClientRect();
		const slide = document.querySelector(".lectern-slide").getBoundingClientRect();
		const hl = document.querySelector("#hl").getBoundingClientRect();
		const card = document.querySelector(".lectern-card").getBoundingClientRect();
		const svg = document.querySelector(".lectern-connectors").getBoundingClientRect();
		const path = document.querySelector(".lectern-connector");
		let line = null;
		if (path) {
			const n = path.getAttribute("d").match(/-?[\d.]+/g).map(Number);
			line = { fromX: svg.left + n[0], fromY: svg.top + n[1], toX: svg.left + n[6], toY: svg.top + n[7] };
		}
		const cs = getComputedStyle(w);
		const usableLeft = wrap.left + parseFloat(cs.paddingLeft);
		const usableRight = wrap.left + w.clientWidth - parseFloat(cs.paddingRight);
		const r = Math.round;
		return {
			pane: r(wrap.width),
			zoom: +zoom.value.toFixed(2),
			hasRail: w.classList.contains("has-rail"),
			slideW: r(slide.width),
			paths: document.querySelectorAll(".lectern-connector").length,
			slideCentreOffPane: r((slide.left + slide.right) / 2 - (wrap.left + w.clientWidth / 2)),
			slideCentreOffUsable: r((slide.left + slide.right) / 2 - (usableLeft + usableRight) / 2),
			cardOverlapsSlide: card.left < slide.right - 1 && card.right > slide.left + 1,
			cardOnScreen: card.left >= wrap.left - 1 && card.right <= wrap.right + 1,
			hl: { right: r(hl.right), midY: r(hl.top + hl.height / 2) },
			card: { left: r(card.left), right: r(card.right), top: r(card.top) },
			line: line && Object.fromEntries(Object.entries(line).map(([k, v]) => [k, r(v)])),
		};
	});

const prefix = process.argv[2];
const browser = await chromium.launch({ channel: "chrome" });
const tab = await browser.newPage({ viewport: { width: 2000, height: 1000 } });
const pageErrors = [];
tab.on("pageerror", (e) => pageErrors.push(e.message));
await tab.setContent(page);
await tab.waitForTimeout(300);
const results = { wide: await state(tab) };
if (prefix) await tab.screenshot({ path: `${prefix}-wide.png` });
// Shrink the pane the way dragging the Obsidian split does: no reload, no refit.
await tab.setViewportSize({ width: 700, height: 1000 });
await tab.waitForTimeout(300);
results.narrow = await state(tab);
// Then press Fit, as the user did (46% in the report).
await tab.evaluate(() => zoom.fitToWidth());
await tab.waitForTimeout(300);
results.narrowFit = await state(tab);
if (prefix) await tab.screenshot({ path: `${prefix}-narrow.png` });
// And back out again.
await tab.setViewportSize({ width: 2000, height: 1000 });
await tab.waitForTimeout(300);
results.wideAgain = await state(tab);
await browser.close();

console.log(JSON.stringify(results, null, 1));

const fails = pageErrors.map((e) => `page error: ${e}`);
for (const [k, s] of Object.entries(results)) {
	if (!s.cardOnScreen) fails.push(`${k}: card is off screen`);
	if (s.line) {
		// The line must leave the highlight and land on the card, never run the other way.
		if (Math.abs(s.line.toX - s.card.left) > 2 && Math.abs(s.line.toX - s.card.right) > 2)
			fails.push(`${k}: line ends at x=${s.line.toX}, card spans ${s.card.left}-${s.card.right}`);
		if (Math.abs(s.line.toY - (s.card.top + 14)) > 2) fails.push(`${k}: line ends at y=${s.line.toY}, card top+14 is ${s.card.top + 14}`);
		if (Math.abs(s.line.fromY - s.hl.midY) > 2) fails.push(`${k}: line starts at y=${s.line.fromY}, highlight middle is ${s.hl.midY}`);
	} else if (!s.cardOverlapsSlide) {
		fails.push(`${k}: no connector although the card sits beside the slide`);
	}
	// Centred in the whole pane unless the strip had to be reserved to keep the card off the slide.
	// A slide wider than the pane cannot be centred; it scrolls from the left edge.
	if (s.slideW > s.pane - 32) continue;
	if (!s.hasRail && Math.abs(s.slideCentreOffPane) > 3) fails.push(`${k}: slide ${s.slideCentreOffPane}px off the pane centre`);
	if (s.hasRail && Math.abs(s.slideCentreOffUsable) > 3) fails.push(`${k}: slide ${s.slideCentreOffUsable}px off the usable centre`);
}
if (results.wide.hasRail) fails.push("wide: a centred slide had room for the card in its margin, but the strip was still reserved");
console.log(fails.length ? `FAIL:\n- ${fails.join("\n- ")}` : "PASS");
process.exit(fails.length ? 1 : 0);
