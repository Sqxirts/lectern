/**
 * Measure each rendered slide in a real browser:
 *   - text clipped by an overflow:hidden box
 *   - text boxes that overlap each other
 *   - the visible text, for comparison against the deck's own text
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
    const boxes = [];

    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || "").trim();

      // Does this element's own content spill past its clipped box?
      const hidden = style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden";
      if (hidden && text) {
        const dw = el.scrollWidth - el.clientWidth;
        const dh = el.scrollHeight - el.clientHeight;
        if (dw > 1 || dh > 1) {
          clipped.push({ text: text.slice(0, 60), dw, dh });
        }
      }

      // Candidate text boxes: positioned, has direct text, reasonable size.
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue || "").trim());
      if (direct && rect.width > 2 && rect.height > 2) {
        boxes.push({
          text: text.slice(0, 40),
          x: rect.x, y: rect.y, w: rect.width, h: rect.height,
          tag: el.tagName,
        });
      }
    }

    // Pairwise overlap between text boxes that are not nested in each other.
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 2 && oy > 2) {
          const area = ox * oy;
          const smaller = Math.min(a.w * a.h, b.w * b.h);
          // Ignore table cells sharing a border and trivial grazes.
          if (area / smaller > 0.25 && a.tag !== "TD" && b.tag !== "TD") {
            overlaps.push({ a: a.text, b: b.text, area: Math.round(area), frac: +(area / smaller).toFixed(2) });
          }
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

  // Which images actually decoded?
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
console.log(`overlaps on: ${over.map((r) => `${r.slide}(${r.overlaps.length})`).join(", ") || "none"}`);
console.log(`images resized by outside css on: ${rsz.map((r) => `${r.slide}(${r.resized.length})`).join(", ") || "none"}`);
