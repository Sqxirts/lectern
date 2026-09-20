/** Build a PowerPoint-vs-VaultScope image for the given slides. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const oursDir = process.argv[2];
const truthDir = process.argv[3];
const outDir = process.argv[4];
const slides = process.argv.slice(5).map(Number);

const browser = await chromium.launch({ channel: "chrome" });

for (const n of slides) {
  const nn = String(n).padStart(2, "0");
  const ourHtml = readFileSync(join(oursDir, `slide-${nn}.html`), "utf-8")
    .replace("</style>", ".vault-scope-slide *:not(:has(img)){overflow:visible !important}</style>");
  const truth = readFileSync(join(truthDir, `slide-${nn}.png`)).toString("base64");

  const page = await browser.newPage({ viewport: { width: 1320, height: 800 } });
  // Render our slide alone first, at full size, and capture it.
  writeFileSync(join(outDir, `tmp-${nn}.html`), ourHtml, "utf-8");
  await page.goto(pathToFileURL(join(outDir, `tmp-${nn}.html`)).href);
  await page.waitForTimeout(150);
  const shot = await page.locator(".vault-scope-slide").screenshot();
  await page.close();

  // Stack PowerPoint's export above ours, labelled.
  const combo = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#222;font:13px system-ui;color:#fff}
    .row{padding:8px 10px}
    .lab{padding:4px 0;font-weight:600;letter-spacing:.04em}
    img{display:block;width:1280px;border:1px solid #555}
  </style>
  <div class="row"><div class="lab">POWERPOINT (ground truth) - slide ${n}</div>
    <img src="data:image/png;base64,${truth}"></div>
  <div class="row"><div class="lab">VAULT SCOPE (html renderer) - slide ${n}</div>
    <img src="data:image/png;base64,${shot.toString("base64")}"></div>`;

  const cmp = await browser.newPage({ viewport: { width: 1320, height: 1560 } });
  writeFileSync(join(outDir, `cmp-${nn}.html`), combo, "utf-8");
  await cmp.goto(pathToFileURL(join(outDir, `cmp-${nn}.html`)).href);
  await cmp.waitForTimeout(150);
  await cmp.screenshot({ path: join(outDir, `compare-${nn}.png`), fullPage: true });
  await cmp.close();
  console.log(`wrote compare-${nn}.png`);
}

await browser.close();
