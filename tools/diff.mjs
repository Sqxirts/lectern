/**
 * Score every rendered slide against PowerPoint's own export of it.
 *
 * compare.mjs makes a picture a person has to look at. This makes a number for
 * every slide, so a whole deck can be ranked worst-first and a fix can be
 * shown to move the score rather than just look better on the slide you
 * happened to open.
 *
 * Usage: node tools/diff.mjs <ours-dir> <truth-dir> <out-json> [heatmap-dir]
 *
 * Both images are scaled to the same size and blurred slightly first, so
 * font hinting and a pixel of anti-aliasing do not dominate the score. What is
 * left is layout, colour and missing content.
 *   meanDiff  average per-channel difference, 0-255
 *   badPct    share of pixels whose summed channel difference exceeds 96
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const [oursDir, truthDir, outJson, heatDir] = process.argv.slice(2);
if (heatDir) mkdirSync(heatDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 2000, height: 1200 } });
const scorer = await browser.newPage();

const files = readdirSync(oursDir).filter((f) => /^slide-\d+\.html$/.test(f)).sort();
const report = [];

for (const file of files) {
  const nn = file.match(/\d+/)[0];
  const truthPath = join(truthDir, `slide-${nn}.png`);
  let truth;
  try {
    truth = readFileSync(truthPath).toString("base64");
  } catch {
    console.log(`no truth for slide ${nn}, skipped`);
    continue;
  }

  await page.goto(pathToFileURL(join(oursDir, file)).href);
  await page.waitForTimeout(80);
  const ours = (await page.locator(".lectern-slide").screenshot()).toString("base64");

  const result = await scorer.evaluate(
    async ({ ours, truth, wantHeat }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        return img;
      };
      const [a, b] = await Promise.all([load(truth), load(ours)]);

      // Compare at a fixed working width so decks of any size score alike.
      const W = 640;
      const H = Math.round((a.naturalHeight / a.naturalWidth) * W);
      const draw = (img) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.filter = "blur(1px)";
        ctx.drawImage(img, 0, 0, W, H);
        return ctx.getImageData(0, 0, W, H).data;
      };
      const pa = draw(a);
      const pb = draw(b);

      let sum = 0;
      let bad = 0;
      const heat = new Uint8ClampedArray(pa.length);
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
        sum += d;
        const isBad = d > 96;
        if (isBad) bad++;
        // Heatmap: the PowerPoint slide faded to grey, differences in red.
        const g = (pa[i] + pa[i + 1] + pa[i + 2]) / 3;
        heat[i] = isBad ? 230 : 180 + g * 0.25;
        heat[i + 1] = isBad ? 30 : 180 + g * 0.25;
        heat[i + 2] = isBad ? 30 : 180 + g * 0.25;
        heat[i + 3] = 255;
      }

      let heatPng = null;
      if (wantHeat) {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        c.getContext("2d").putImageData(new ImageData(heat, W, H), 0, 0);
        heatPng = c.toDataURL("image/png").split(",")[1];
      }

      const px = pa.length / 4;
      return { meanDiff: +(sum / (px * 3)).toFixed(2), badPct: +((bad / px) * 100).toFixed(2), heatPng };
    },
    { ours, truth, wantHeat: Boolean(heatDir) }
  );

  if (heatDir && result.heatPng) writeFileSync(join(heatDir, `heat-${nn}.png`), Buffer.from(result.heatPng, "base64"));
  report.push({ slide: Number(nn), meanDiff: result.meanDiff, badPct: result.badPct });
}

await browser.close();
report.sort((x, y) => y.badPct - x.badPct);
writeFileSync(outJson, JSON.stringify(report, null, 1), "utf-8");

const avg = report.reduce((s, r) => s + r.badPct, 0) / (report.length || 1);
console.log(`slides scored: ${report.length}; mean badPct ${avg.toFixed(2)}%`);
console.log("worst 10:");
for (const r of report.slice(0, 10)) console.log(`  slide ${r.slide}: badPct ${r.badPct}%  meanDiff ${r.meanDiff}`);
