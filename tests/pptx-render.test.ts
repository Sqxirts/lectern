import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pptxToHtml } from "@jvmr/pptx-to-html";
import { parseUntrustedHtml } from "../src/util/safeHtml";

const NEEDLE = "the CIA triad is not a checklist";

function fixture(name: string): ArrayBuffer {
	const buffer = readFileSync(join(__dirname, "..", "fixtures", "out", name));
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

describe("pptx rendered as HTML", () => {
	it("returns one HTML slide per slide in the deck", async () => {
		const slides = await pptxToHtml(fixture("fixture-deck.pptx"));
		expect(slides).toHaveLength(5);
	});

	it("puts slide text in real text nodes, which is the whole point", async () => {
		const slides = await pptxToHtml(fixture("fixture-deck.pptx"));
		const host = document.createElement("div");
		host.appendChild(parseUntrustedHtml(slides[3]));

		// textContent only sees real text nodes. A canvas renderer would give "".
		expect(host.textContent).toContain(NEEDLE);
		expect(host.querySelector("canvas")).toBeNull();
	});

	it("keeps the inline styles the layout depends on", async () => {
		const slides = await pptxToHtml(fixture("fixture-deck.pptx"));
		const host = document.createElement("div");
		host.appendChild(parseUntrustedHtml(slides[0]));

		const styled = host.querySelectorAll("[style]");
		expect(styled.length).toBeGreaterThan(0);
	});
});

describe("safeHtml", () => {
	it("drops scripts, iframes and inline event handlers", () => {
		const fragment = parseUntrustedHtml(
			`<div style="color: red" onclick="steal()">keep me</div>` +
				`<script>window.pwned = true</script>` +
				`<iframe src="https://example.com"></iframe>` +
				`<a href="javascript:alert(1)">bad link</a>`
		);
		const host = document.createElement("div");
		host.appendChild(fragment);

		expect(host.querySelector("script")).toBeNull();
		expect(host.querySelector("iframe")).toBeNull();
		expect(host.querySelector("div")?.hasAttribute("onclick")).toBe(false);
		expect(host.querySelector("a")?.hasAttribute("href")).toBe(false);

		// The things the renderer actually needs must survive.
		expect(host.querySelector("div")?.getAttribute("style")).toBe("color: red");
		expect(host.textContent).toContain("keep me");
	});

	it("keeps image sources the renderer inlines as data URIs", () => {
		const host = document.createElement("div");
		host.appendChild(
			parseUntrustedHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">')
		);

		expect(host.querySelector("img")?.getAttribute("src")).toContain("data:image/png");
	});
});
