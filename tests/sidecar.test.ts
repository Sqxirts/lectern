import { describe, expect, it } from "vitest";
import { findScopeBlocks, parseSidecar, serialiseSidecar, type ParsedSidecar } from "../src/comments/sidecarFormat";
import type { ScopeComment } from "../src/comments/types";

const FRONTMATTER = {
	title: "Comments on fixture-deck.pptx",
	area: "degree",
	source: "Attachments/fixture-deck.pptx",
};

function comment(overrides: Partial<ScopeComment> = {}): ScopeComment {
	return {
		id: "c1",
		anchor: {
			kind: "pptx",
			slide: 4,
			quote: 'a quote with "double quotes", a colon: and a newline\nin it',
			prefix: "Remember ",
			suffix: ". Instead",
		},
		status: "open",
		created: "2026-09-17T14:02",
		body: "Check whether this is on the midterm.",
		...overrides,
	};
}

function sidecar(comments: ScopeComment[], extra: Partial<ParsedSidecar> = {}): ParsedSidecar {
	return { preamble: "", comments, foreign: [], ...extra };
}

describe("sidecar round trip", () => {
	it("survives quotes, colons and newlines inside the quoted text", () => {
		const original = comment();
		const markdown = serialiseSidecar(sidecar([original]), FRONTMATTER);
		const parsed = parseSidecar(markdown);

		expect(parsed.comments).toHaveLength(1);
		expect(parsed.comments[0]).toEqual(original);
	});

	it("writes frontmatter the vault's conventions expect", () => {
		const markdown = serialiseSidecar(sidecar([comment()]), FRONTMATTER);

		expect(markdown.startsWith("---\n")).toBe(true);
		expect(markdown).toContain("type: reference");
		expect(markdown).toContain("area: degree");
		expect(markdown).toContain("source: Attachments/fixture-deck.pptx");
		expect(markdown).toContain("  - annotation");
	});

	it("hides its metadata in an Obsidian comment block", () => {
		const markdown = serialiseSidecar(sidecar([comment()]), FRONTMATTER);

		expect(markdown).toContain("%%scope");
		// The heading and the body stay visible prose.
		expect(markdown).toContain('## Slide 4: "');
		expect(markdown).toContain("Check whether this is on the midterm.");
	});

	it("keeps every anchor kind intact", () => {
		const comments: ScopeComment[] = [
			comment({ id: "a", anchor: { kind: "xlsx", sheet: "Controls", cell: "B7" } }),
			comment({ id: "b", anchor: { kind: "code", line: 42, quote: "x = 1", prefix: "", suffix: "" } }),
			comment({ id: "c", anchor: { kind: "docx", page: 2, quote: "body text", prefix: "", suffix: "" } }),
		];

		const parsed = parseSidecar(serialiseSidecar(sidecar(comments), FRONTMATTER));
		expect(parsed.comments.map((c) => c.anchor.kind)).toEqual(["xlsx", "code", "docx"]);
	});

	it("round trips a resolved comment and an empty body", () => {
		const comments = [comment({ id: "r", status: "resolved", body: "" })];
		const parsed = parseSidecar(serialiseSidecar(sidecar(comments), FRONTMATTER));

		expect(parsed.comments[0].status).toBe("resolved");
		expect(parsed.comments[0].body).toBe("");
	});

	it("keeps hand-written sections it did not author", () => {
		const markdown = serialiseSidecar(sidecar([comment()]), FRONTMATTER);
		const edited = `${markdown}\n## My own heading\n\nSomething I typed by hand.\n`;

		const parsed = parseSidecar(edited);
		expect(parsed.comments).toHaveLength(1);
		expect(parsed.foreign).toHaveLength(1);
		expect(parsed.foreign[0].raw).toContain("Something I typed by hand.");

		// And writing it back out must not lose that section.
		expect(serialiseSidecar(parsed, FRONTMATTER)).toContain("Something I typed by hand.");
	});

	it("picks up a body the user edited by hand", () => {
		const markdown = serialiseSidecar(sidecar([comment()]), FRONTMATTER);
		const edited = markdown.replace(
			"Check whether this is on the midterm.",
			"Rewritten by hand in Obsidian."
		);

		expect(parseSidecar(edited).comments[0].body).toBe("Rewritten by hand in Obsidian.");
	});

	it("reads an empty file as no comments", () => {
		expect(parseSidecar("").comments).toHaveLength(0);
	});
});

describe("findScopeBlocks", () => {
	it("finds each block as whole lines, from %%scope to the closing %%", () => {
		const markdown = serialiseSidecar(
			sidecar([comment(), comment({ id: "c2", status: "resolved" })]),
			FRONTMATTER,
		);
		const blocks = findScopeBlocks(markdown);

		expect(blocks).toHaveLength(2);
		for (const block of blocks) {
			const text = markdown.slice(block.from, block.to);
			expect(text.startsWith("%%scope\n")).toBe(true);
			expect(text.endsWith("\n%%")).toBe(true);
			// the comment body is outside the block, so it stays on screen
			expect(text).not.toContain("Check whether this is on the midterm.");
		}
		expect(blocks[0].meta).toEqual({ anchor: comment().anchor, status: "open" });
		expect(blocks[1].meta?.status).toBe("resolved");
	});

	it("still finds a block with Windows line endings", () => {
		const markdown = serialiseSidecar(sidecar([comment()]), FRONTMATTER).replace(/\n/g, "\r\n");
		const [block] = findScopeBlocks(markdown);

		expect(block.meta?.anchor.kind).toBe("pptx");
		expect(markdown.slice(block.from, block.to).endsWith("%%")).toBe(true);
	});

	it("returns null meta for hand-broken JSON instead of throwing", () => {
		const blocks = findScopeBlocks("## Slide 1\n\n%%scope\n{not json\n%%\n\nNote.");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].meta).toBeNull();
	});

	it("ignores ordinary Obsidian comments", () => {
		expect(findScopeBlocks("%%\nmy own comment\n%%\n\n%% inline %%")).toEqual([]);
	});
});
