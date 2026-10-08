// Tiny helper: run a JS snippet inside the running Obsidian (started with
// --remote-debugging-port=9229) and print the JSON result.
// Usage: node tools/pdf-spike/cdp.mjs <snippet.js> [screenshot.png]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const body = readFileSync(process.argv[2], "utf8");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
if (!page) throw new Error("Obsidian window not found");
const result = await page.evaluate(`(async () => { ${body} })()`);
console.log(JSON.stringify(result, null, 2));
if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
await browser.close().catch(() => {});
process.exit(0);
