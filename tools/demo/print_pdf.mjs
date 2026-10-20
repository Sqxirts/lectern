// Print an HTML file to PDF with installed Chrome. Usage: node print_pdf.mjs <in.html> <out.pdf>
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(pathToFileURL(process.argv[2]).href);
await page.pdf({ path: process.argv[3], format: "Letter" });
await browser.close();
