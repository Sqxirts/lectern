import { describe, expect, it } from "vitest";
import { commentIndexBase } from "../src/comments/commentIndex";
import { countComments, parseSidecar, serialiseSidecar } from "../src/comments/sidecarFormat";
import type { ScopeComment } from "../src/comments/types";

const anchor = { kind: "code" as const, line: 1, quote: "x", prefix: "", suffix: "" };
const make = (id: string, status: "open" | "resolved"): ScopeComment => ({ id, anchor, status, created: "2026-10-27T10:00", body: "n" });

describe("comment counts", () => {
	it("counts open and resolved separately", () => {
		expect(countComments([make("a", "open"), make("b", "resolved"), make("c", "open")])).toEqual({
			open_comments: 2,
			resolved_comments: 1,
		});
	});

	it("writes the counts into the sidecar frontmatter and still parses back", () => {
		const comments = [make("a", "open"), make("b", "resolved")];
		const markdown = serialiseSidecar({ preamble: "", comments, foreign: [] }, { title: "t", area: "meta", source: "a.py" });
		expect(markdown).toContain("open_comments: 1\n");
		expect(markdown).toContain("resolved_comments: 1\n");
		expect(parseSidecar(markdown).comments).toEqual(comments);
	});
});

describe("comment index base", () => {
	it("is valid YAML that sorts by the properties the sidecars carry", async () => {
		const { parse } = await import("yaml");
		const base = parse(commentIndexBase());
		expect(base.views.map((v: { name: string }) => v.name)).toEqual(["Needs attention", "All annotated files"]);
		expect(base.filters.and).toContain('file.hasTag("annotation")');
		// file.name is not a plain string in Bases, so endsWith on it matches nothing; file.path is.
		expect(base.filters.and).toContain('file.path.endsWith(".comments.md")');
		// Bases only applies displayName to frontmatter properties under the note. prefix.
		expect(Object.keys(base.properties)).toEqual(["note.source", "note.open_comments", "note.resolved_comments", "note.area"]);
		for (const view of base.views) expect(view.order).toContain("open_comments");
	});
});
