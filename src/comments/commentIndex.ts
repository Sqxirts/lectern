/**
 * The vault-wide comment index is an ordinary Obsidian Base over the sidecar
 * notes, so it is searchable, editable and embeddable like any other Base. This
 * module only holds the Base's text; creating and opening it is in main.ts.
 *
 * It lists one row per annotated file with its open and resolved counts. A
 * Base lists notes, not the sections inside them, so the comments themselves
 * are one click away in each sidecar.
 */

export const INDEX_FILE_NAME = "Comments.base";

/**
 * Filters on the tag and the file name rather than the comment folder, so the
 * Base keeps working if the folder setting changes. Property names match the
 * frontmatter written by serialiseSidecar.
 */
export function commentIndexBase(): string {
	return [
		"filters:",
		"  and:",
		"    - 'file.hasTag(\"annotation\")'",
		"    - 'file.path.endsWith(\".comments.md\")'",
		"properties:",
		"  note.source:",
		"    displayName: Source file",
		"  note.open_comments:",
		"    displayName: Open",
		"  note.resolved_comments:",
		"    displayName: Resolved",
		"  note.area:",
		"    displayName: Area",
		"views:",
		"  - type: table",
		"    name: Needs attention",
		"    filters:",
		"      and:",
		"        - 'open_comments > 0'",
		"    order:",
		"      - file.name",
		"      - source",
		"      - open_comments",
		"      - resolved_comments",
		"      - file.mtime",
		"    sort:",
		"      - property: open_comments",
		"        direction: DESC",
		"  - type: table",
		"    name: All annotated files",
		"    order:",
		"      - file.name",
		"      - source",
		"      - area",
		"      - open_comments",
		"      - resolved_comments",
		"      - file.mtime",
		"    sort:",
		"      - property: file.mtime",
		"        direction: DESC",
		"",
	].join("\n");
}
