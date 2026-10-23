import { afterEach, describe, expect, it } from "vitest";
import { collectText, findMatches, rangeFor } from "../src/find/findText";

const SKIP = ".lectern-code-ln";
const OPTIONS = { matchCase: false, limit: 5000 };

function dom(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.appendChild(root);
	return root;
}

/** The text each match's Range covers, which is what the user sees highlighted. */
function found(root: HTMLElement, query: string, options = OPTIONS): string[] {
	const map = collectText(root, SKIP);
	return findMatches(map.text, query, options)
		.map((match) => rangeFor(map, match))
		.filter((range): range is Range => range !== null)
		.map((range) => range.toString());
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("findMatches", () => {
	it("ignores case unless asked not to", () => {
		expect(findMatches("Ring of Gyges, ring", "ring", OPTIONS)).toHaveLength(2);
		expect(findMatches("Ring of Gyges, ring", "ring", { ...OPTIONS, matchCase: true })).toEqual([{ start: 15, end: 19 }]);
	});

	it("treats regex characters as plain text", () => {
		expect(findMatches("a.b axb (c) [d]", "a.b", OPTIONS)).toEqual([{ start: 0, end: 3 }]);
		expect(findMatches("a.b axb (c) [d]", "(c) [d]", OPTIONS)).toEqual([{ start: 8, end: 15 }]);
	});

	it("lets a space match any run of whitespace", () => {
		expect(findMatches("Plato's\n   Republic", "plato's republic", OPTIONS)).toEqual([{ start: 0, end: 19 }]);
	});

	it("returns nothing for an empty or blank query", () => {
		expect(findMatches("anything", "", OPTIONS)).toEqual([]);
		expect(findMatches("anything", "   ", OPTIONS)).toEqual([]);
	});

	it("stops at the limit", () => {
		expect(findMatches("a".repeat(100), "a", { ...OPTIONS, limit: 10 })).toHaveLength(10);
	});
});

describe("collectText + rangeFor", () => {
	it("matches across inline elements, like a highlighted token or a comment span", () => {
		const root = dom(`<p><b>Gla</b>ucon <span class="lectern-highlight">argues</span> that</p>`);
		expect(found(root, "glaucon argues")).toEqual(["Glaucon argues"]);
	});

	it("does not match across two separate lines", () => {
		const root = dom(`<div>ends with ring</div><div>of Gyges starts here</div>`);
		expect(found(root, "ringof")).toEqual([]);
		// A space still bridges them, because the line break counts as whitespace.
		expect(found(root, "ring of")).toEqual(["ringof"]);
	});

	it("skips chrome like code line numbers", () => {
		const root = dom(`
			<div class="lectern-code-row"><span class="lectern-code-ln">12</span><code>let x = 12;</code></div>
		`);
		expect(found(root, "12")).toEqual(["12"]);
		const map = collectText(root, SKIP);
		expect(map.text).not.toContain("12let");
	});

	it("skips script, style and textarea content", () => {
		const root = dom(`<style>.needle{}</style><textarea>needle</textarea><p>one needle</p>`);
		expect(found(root, "needle")).toEqual(["needle"]);
	});

	it("finds every occurrence in document order", () => {
		const root = dom(`<p>justice</p><ul><li>Justice as fear</li><li>no justice</li></ul>`);
		expect(found(root, "justice")).toEqual(["justice", "Justice", "justice"]);
	});
});
