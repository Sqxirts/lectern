/**
 * Drive the real ZoomController in Chrome, wired the way ScopeView wires it
 * (ResizeObserver -> measure), with the real stylesheet and slide-sized cards.
 * Catches the feedback loop where one click of + inflated the "natural" width
 * on every re-measure and the slides drifted off screen.
 *
 * Usage: node tools/zoom.check.mjs [ZoomController.ts] [styles.css]
 */
import { chromium } from "playwright";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? join(root, "src/view/ZoomController.ts"));

const bundle = execFileSync("npx", ["esbuild", "--bundle", "--format=iife", "--global-name=Z", "--loader=ts"], {
	cwd: root,
	input: `export { ZoomController } from ${JSON.stringify(source.replace(/\\/g, "/"))};`,
	shell: true,
	encoding: "utf-8",
});
// A second argument swaps in another stylesheet, to reproduce a regression.
const styles = readFileSync(resolve(process.argv[3] ?? join(root, "styles.css")), "utf-8");

const page = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
${styles}
</style>
<div class="vault-scope-container" style="height:100vh;display:flex;flex-direction:column">
  <div class="vault-scope-wrapper vault-scope-pptx-active" style="flex:1">
    <div class="vault-scope-sizer"><div class="vault-scope-content">
      ${[1, 2, 3].map((n) => `<div class="vault-scope-slide-card"><div class="vault-scope-slide" style="width:1280px;height:720px">Slide ${n}</div></div>`).join("")}
    </div></div>
  </div>
  <div class="ind"></div>
</div>
<script>
// Obsidian's HTMLElement helpers, which the controller uses.
HTMLElement.prototype.setText = function (t) { this.textContent = t; };
HTMLElement.prototype.addClass = function (c) { this.classList.add(c); };
HTMLElement.prototype.removeClass = function (c) { this.classList.remove(c); };
${bundle}
const q = (s) => document.querySelector(s);
window.zoom = new Z.ZoomController(q(".vault-scope-wrapper"), q(".vault-scope-sizer"), q(".vault-scope-content"), q(".ind"), () => {});
new ResizeObserver(() => zoom.measure()).observe(q(".vault-scope-content"));
zoom.measure();
</script>`;

const browser = await chromium.launch({ channel: "chrome" });
// Wide, like a maximised Obsidian pane, where the off-centre zoom showed.
const tab = await browser.newPage({ viewport: { width: 2000, height: 1200 } });
await tab.setContent(page);
const settle = () => tab.waitForTimeout(250);
const state = () =>
	tab.evaluate(() => {
		const sizer = document.querySelector(".vault-scope-sizer").getBoundingClientRect();
		const wrap = document.querySelector(".vault-scope-wrapper").getBoundingClientRect();
		const slide = document.querySelector(".vault-scope-slide").getBoundingClientRect();
		const onScreen = slide.right > wrap.left && slide.left < wrap.right && slide.bottom > wrap.top && slide.top < wrap.bottom;
		const w = document.querySelector(".vault-scope-wrapper");
		const cs = getComputedStyle(w);
		const usableCenter = wrap.left + parseFloat(cs.paddingLeft) + (w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / 2;
		return {
			level: +zoom.value.toFixed(2),
			sizerW: Math.round(sizer.width),
			slideW: Math.round(slide.width),
			slideLeft: Math.round(slide.left),
			// How far the slide's middle sits from the middle of the usable area.
			offCentre: Math.round((slide.left + slide.right) / 2 - usableCenter),
			// Can the slide's left edge be scrolled back into view?
			leftReachable: slide.left + w.scrollLeft >= wrap.left - 1,
			onScreen,
		};
	});

await settle();
const results = {};
results.start = await state();
for (let i = 0; i < 3; i++) await tab.evaluate(() => zoom.in());
await settle();
results.plus3 = await state();
// Past the pane width: the slide must stay centred on the view and both
// edges must stay reachable by scrolling.
for (let i = 0; i < 3; i++) await tab.evaluate(() => zoom.in());
await settle();
results.plus6 = await state();
await tab.evaluate(() => zoom.reset());
await settle();
results.reset = await state();
await tab.evaluate(() => zoom.fitToWidth());
await settle();
results.fit = await state();
await browser.close();

console.log(JSON.stringify(results, null, 1));

// Expectations: the slide stays 1280 x zoom wide, stays centred and on
// screen, its left edge stays reachable, Reset returns to 1280, and Fit makes
// it fit the pane.
const fails = [];
for (const [k, r] of Object.entries(results)) {
	if (Math.abs(r.offCentre) > 3) fails.push(`${k}: slide is ${r.offCentre}px off centre`);
	if (!r.leftReachable) fails.push(`${k}: slide's left edge cannot be scrolled to`);
}
if (results.plus3.level !== 1.3 || Math.abs(results.plus3.slideW - 1664) > 2) fails.push("+ x3 should give a 1664px slide at 130%");
if (!results.plus3.onScreen) fails.push("slide left the screen after +");
if (results.reset.level !== 1 || Math.abs(results.reset.slideW - 1280) > 2) fails.push("Reset should return to a 1280px slide");
if (results.fit.slideW > 2000 - 290 || results.fit.slideW < 1300) fails.push("Fit should make the slide fill the usable width");
if (!results.fit.onScreen) fails.push("slide off screen after Fit");
console.log(fails.length ? `FAIL:\n- ${fails.join("\n- ")}` : "PASS");
process.exit(fails.length ? 1 : 0);
