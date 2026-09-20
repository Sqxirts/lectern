/**
 * Measure each rendered slide in a real browser:
 *   - text clipped by an overflow:hidden box
 *   - text that visually collides with other text
 *   - images that failed to decode
 *   - images resized by CSS outside the renderer, which breaks picture crops
 */
import { chromium } from "playwright";
import { readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const dir = process.argv[2];
const outJson = process.argv[3];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

const files = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
const report = [];

for (const file of files) {
  await page.goto(pathToFileURL(join(dir, file)).href);
  await page.waitForTimeout(60);

  const data = await page.evaluate(() => {
    const clipped = [];
    const runs = [];

    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      const text = (el.textContent || "").trim();

      // Does this element's own content spill past its clipped box?
      const hidden = style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden";
      if (hidden && text) {
        const dw = el.scrollWidth - el.clientWidth;
        const dh = el.scrollHeight - el.clientHeight;
        if (dw > 1 || dh > 1) clipped.push({ text: text.slice(0, 60), dw, dh });
      }

      // Collect the *painted* extent of the text, not the element box. A
      // PowerPoint text box is routinely far taller than the words inside it,
      // so comparing element boxes reports collisions that are not visible.
      // Week 2 slide 3 has a paragraph whose box is 149px tall around 54px of
      // text; its empty lower half sits over two cards below.
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue || "").trim());
      if (!direct) continue;

      const range = document.createRange();
      range.selectNodeContents(el);
      for (const rect of range.getClientRects()) {
        if (rect.width > 1 && rect.height > 1) {
          runs.push({ text: text.slice(0, 40), x: rect.x, y: rect.y, w: rect.width, h: rect.height, tag: el.tagName });
        }
      }
    }

    // Pairwise overlap between painted text runs from different elements.
    const overlaps = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i], b = runs[j];
        if (a.text === b.text) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox <= 1 || oy <= 1) continue;

        const area = ox * oy;
        const smaller = Math.min(a.w * a.h, b.w * b.h);
        // Table cells legitimately share borders; ignore grazes.
        if (area / smaller > 0.25 && a.tag !== "TD" && b.tag !== "TD") {
          overlaps.push({ a: a.text, b: b.text, area: Math.round(area), frac: +(area / smaller).toFixed(2) });
        }
      }
    }

    // An image the renderer sized explicitly must render at that size. If it
    // does not, something outside the renderer (Obsidian, a theme) is
    // constraining it, and a cropped picture will land on the wrong region.
    const resized = [];
    for (const img of document.querySelectorAll("img")) {
      const want = { w: parseFloat(img.style.width), h: parseFloat(img.style.height) };
      if (!isFinite(want.w) || !isFinite(want.h)) continue;
      const got = img.getBoundingClientRect();
      if (Math.abs(got.width - want.w) > 1 || Math.abs(got.height - want.h) > 1) {
        resized.push({ want: `${Math.round(want.w)}x${Math.round(want.h)}`, got: `${Math.round(got.width)}x${Math.round(got.height)}` });
      }
    }

    const visible = (document.body.innerText || "").replace(/\s+/g, " ").trim();
    return { clipped, overlaps, resized, visible, imgs: document.querySelectorAll("img").length };
  });

  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((i) => !i.complete || i.naturalWidth === 0).length
  );

  report.push({ slide: Number(file.match(/\d+/)[0]), ...data, broken });
}

await browser.close();
writeFileSync(outJson, JSON.stringify(report, null, 1), "utf-8");

const clip = report.filter((r) => r.clipped.length);
const over = report.filter((r) => r.overlaps.length);
const brk = report.filter((r) => r.broken);
const rsz = report.filter((r) => r.resized && r.resized.length);
console.log(`slides: ${report.length}`);
console.log(`broken images on: ${brk.map((r) => `${r.slide}(${r.broken})`).join(", ") || "none"}`);
console.log(`clipped text on: ${clip.map((r) => `${r.slide}(${r.clipped.length})`).join(", ") || "none"}`);
console.log(`overlapping text on: ${over.map((r) => `${r.slide}(${r.overlaps.length})`).join(", ") || "none"}`);
console.log(`images resized by outside css on: ${rsz.map((r) => `${r.slide}(${r.resized.length})`).join(", ") || "none"}`);
