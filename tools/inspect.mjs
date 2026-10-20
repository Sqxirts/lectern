/**
 * Measure each rendered slide in a real browser:
 *   - text clipped by an overflow:hidden box
 *   - text that visually collides with other text
 *   - images that failed to decode
 *   - images resized by CSS outside the renderer, which breaks picture crops
 *   - text that blends into whatever is painted behind it
 *
 * Usage: node tools/inspect.mjs <slides-dir> <out.json> [powerpoint-truth-dir]
 *
 * With the truth directory, low-contrast text is checked against PowerPoint's
 * own export too. Text PowerPoint also draws illegibly (dark on navy, CYBR 226
 * week 1 slide 6) is labelled "authored": a fault in the deck, not in us.
 */
import { chromium } from "playwright";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const dir = process.argv[2];
const outJson = process.argv[3];
const truthDir = process.argv[4];

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
          runs.push({ text: text.slice(0, 40), x: rect.x, y: rect.y, w: rect.width, h: rect.height, tag: el.tagName, color: style.color });
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
    return { clipped, overlaps, resized, visible, imgs: document.querySelectorAll("img").length, runs };
  });

  // Contrast: hide every glyph, photograph what is left, and sample the pixels
  // behind each text run. Walking ancestors for a background-color misses
  // shapes, images and SVG drawn *beside* the text rather than around it.
  // White header text on a cell whose navy fill a stylesheet stripped (week 5
  // slide 11) scores 1.0 here and passed every other check.
  await page.addStyleTag({ content: "*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important}" });
  const bare = (await page.screenshot({ fullPage: true })).toString("base64");
  const truthPath = truthDir ? join(truthDir, file.replace(/\.html$/, ".png")) : "";
  const truth = truthPath && existsSync(truthPath) ? readFileSync(truthPath).toString("base64") : null;
  const lowContrast = await page.evaluate(async ({ bare, runs, truth }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${bare}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const lum = ([r, g, b]) => {
      const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const out = [];
    for (const run of runs) {
      const m = run.color.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const parts = m[1].split(",").map(parseFloat);
      if (parts.length === 4 && parts[3] === 0) continue; // text meant to be invisible
      const fg = parts.slice(0, 3);

      const x = Math.max(0, Math.floor(run.x)), y = Math.max(0, Math.floor(run.y));
      const w = Math.min(canvas.width - x, Math.ceil(run.w)), h = Math.min(canvas.height - y, Math.ceil(run.h));
      if (w < 2 || h < 2) continue;
      const data = ctx.getImageData(x, y, w, h).data;

      // Median background luminance, so one stray icon pixel does not decide.
      const px = [];
      for (let i = 0; i < data.length; i += 16) px.push([data[i], data[i + 1], data[i + 2]]);
      px.sort((a, b) => lum(a) - lum(b));
      const bg = px[Math.floor(px.length / 2)];
      const r = ratio(fg, bg);
      if (r < 1.6) out.push({ text: run.text, fg: run.color, bg: `rgb(${bg.join(", ")})`, ratio: +r.toFixed(2), rect: [x, y, w, h] });
    }

    // Same spot in PowerPoint's export: if nothing there stands out from its
    // own background either, PowerPoint draws it illegibly too.
    if (truth && out.length) {
      const t = new Image();
      t.src = `data:image/png;base64,${truth}`;
      await t.decode();
      const slide = document.querySelector(".lectern-slide").getBoundingClientRect();
      const tc = document.createElement("canvas");
      tc.width = t.naturalWidth;
      tc.height = t.naturalHeight;
      const tctx = tc.getContext("2d", { willReadFrequently: true });
      tctx.drawImage(t, 0, 0);
      const k = t.naturalWidth / slide.width;
      for (const o of out) {
        const [x, y, w, h] = o.rect;
        const d = tctx.getImageData(Math.floor((x - slide.x) * k), Math.floor((y - slide.y) * k), Math.max(2, Math.ceil(w * k)), Math.max(2, Math.ceil(h * k))).data;
        const px = [];
        for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
        px.sort((a, b) => lum(a) - lum(b));
        const med = px[Math.floor(px.length / 2)];
        const spread = Math.max(ratio(med, px[0]), ratio(med, px[px.length - 1]));
        o.authored = spread < 1.6;
      }
    }
    for (const o of out) delete o.rect;
    return out;
  }, { bare, runs: data.runs, truth });
  delete data.runs;

  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((i) => !i.complete || i.naturalWidth === 0).length
  );

  report.push({ slide: Number(file.match(/\d+/)[0]), ...data, broken, lowContrast });
}

await browser.close();
writeFileSync(outJson, JSON.stringify(report, null, 1), "utf-8");

const clip = report.filter((r) => r.clipped.length);
const over = report.filter((r) => r.overlaps.length);
const brk = report.filter((r) => r.broken);
const rsz = report.filter((r) => r.resized && r.resized.length);
const low = report.filter((r) => r.lowContrast.some((x) => !x.authored));
const authored = report.filter((r) => r.lowContrast.some((x) => x.authored));
console.log(`slides: ${report.length}`);
console.log(`broken images on: ${brk.map((r) => `${r.slide}(${r.broken})`).join(", ") || "none"}`);
console.log(`clipped text on: ${clip.map((r) => `${r.slide}(${r.clipped.length})`).join(", ") || "none"}`);
console.log(`overlapping text on: ${over.map((r) => `${r.slide}(${r.overlaps.length})`).join(", ") || "none"}`);
console.log(`low-contrast text on: ${low.map((r) => `${r.slide}(${r.lowContrast.filter((x) => !x.authored).length})`).join(", ") || "none"}`);
if (truthDir) console.log(`  illegible in PowerPoint too (authored): ${authored.map((r) => r.slide).join(", ") || "none"}`);
console.log(`images resized by outside css on: ${rsz.map((r) => `${r.slide}(${r.resized.length})`).join(", ") || "none"}`);
