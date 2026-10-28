import { anchorLabel, type Anchor, type CommentStatus, type ScopeComment } from "./types";

/**
 * Reading and writing the comment sidecar. Kept free of Obsidian imports so it
 * stays a pure string-in, string-out module that can be tested on its own.
 *
 * The machine-readable part sits in a `%% %%` block. Reading view renders it as
 * nothing, search still indexes it, and Live Preview would show it dimmed, so
 * sidecarEditor.ts swaps each block for a chip there. The note reads cleanly in
 * both modes and nothing is hidden from global search.
 *
 * That block holds JSON rather than YAML: quotes, colons and newlines all turn
 * up inside quoted slide text, and JSON escapes them without needing a parser.
 */

const BLOCK_OPEN = "%%scope";
const BLOCK_CLOSE = "%%";
const EMPTY_BODY = "_No note yet._";

interface StoredMeta {
	id: string;
	anchor: Anchor;
	status: CommentStatus;
	created: string;
}

/** Where a `%%scope` block sits in a sidecar, whole lines from `%%scope` to `%%`. */
export interface ScopeBlock {
	from: number;
	to: number;
	/** Null when the JSON doesn't parse; the editor then leaves the block alone. */
	meta: { anchor: Anchor; status: CommentStatus } | null;
}

const SCOPE_BLOCK = /^%%scope[ \t]*\r?\n([\s\S]*?)\r?\n%%[ \t]*$/gm;

/** Every scope block in a sidecar, for the editor to hide. */
export function findScopeBlocks(markdown: string): ScopeBlock[] {
	const blocks: ScopeBlock[] = [];
	for (const match of markdown.matchAll(SCOPE_BLOCK)) {
		let meta: ScopeBlock["meta"] = null;
		try {
			const parsed = JSON.parse(match[1]) as Partial<StoredMeta>;
			if (parsed?.anchor?.kind) {
				meta = { anchor: parsed.anchor, status: parsed.status === "resolved" ? "resolved" : "open" };
			}
		} catch {
			// hand-edited into invalid JSON: show it raw so it can be fixed
		}
		blocks.push({ from: match.index, to: match.index + match[0].length, meta });
	}
	return blocks;
}

/** A `## ` section we could not parse. Kept verbatim so hand edits survive. */
export interface ForeignSection {
	raw: string;
}

export interface ParsedSidecar {
	preamble: string;
	comments: ScopeComment[];
	foreign: ForeignSection[];
}

export interface SidecarFrontmatter {
	title: string;
	area: string;
	source: string;
}

/** Comment counts, kept in the frontmatter so a Base can list and sort sidecars by them. */
export interface CommentCounts {
	open_comments: number;
	resolved_comments: number;
}

export function countComments(comments: readonly ScopeComment[]): CommentCounts {
	const resolved = comments.filter((c) => c.status === "resolved").length;
	return { open_comments: comments.length - resolved, resolved_comments: resolved };
}

export function serialiseSidecar(parsed: ParsedSidecar, frontmatter: SidecarFrontmatter): string {
	const counts = countComments(parsed.comments);
	const head = [
		"---",
		`title: ${frontmatter.title}`,
		"type: reference",
		`area: ${frontmatter.area}`,
		`source: ${frontmatter.source}`,
		`open_comments: ${counts.open_comments}`,
		`resolved_comments: ${counts.resolved_comments}`,
		"tags:",
		"  - annotation",
		"---",
	].join("\n");

	const sections = parsed.comments.map((comment) => {
		const meta: StoredMeta = {
			id: comment.id,
			anchor: comment.anchor,
			status: comment.status,
			created: comment.created,
		};
		return [
			`## ${anchorLabel(comment.anchor)}: ${headingQuote(comment.anchor)}`,
			"",
			BLOCK_OPEN,
			JSON.stringify(meta),
			BLOCK_CLOSE,
			"",
			comment.body.trim() || EMPTY_BODY,
		].join("\n");
	});

	const foreign = parsed.foreign.map((section) => section.raw.trim());

	return [head, parsed.preamble.trim(), ...sections, ...foreign]
		.filter((part) => part.length > 0)
		.join("\n\n")
		.concat("\n");
}

/** Split a sidecar back into comments, keeping anything we did not write. */
export function parseSidecar(markdown: string): ParsedSidecar {
	const body = stripFrontmatter(markdown);
	const sections = body.split(/^(?=## )/m);
	const result: ParsedSidecar = { preamble: "", comments: [], foreign: [] };

	for (const section of sections) {
		if (!section.trim()) continue;

		if (!section.startsWith("## ")) {
			result.preamble = section.trim();
			continue;
		}

		const parsed = parseSection(section);
		if (parsed) result.comments.push(parsed);
		else result.foreign.push({ raw: section });
	}

	return result;
}

function headingQuote(anchor: Anchor): string {
	if (anchor.kind === "xlsx") return "cell comment";
	const quote = anchor.quote.replace(/\s+/g, " ").trim();
	const clipped = quote.length > 60 ? `${quote.slice(0, 57)}...` : quote;
	return `"${clipped}"`;
}

function parseSection(section: string): ScopeComment | null {
	const start = section.indexOf(BLOCK_OPEN);
	if (start < 0) return null;

	const jsonStart = start + BLOCK_OPEN.length;
	const end = section.indexOf(`\n${BLOCK_CLOSE}`, jsonStart);
	if (end < 0) return null;

	let meta: StoredMeta;
	try {
		meta = JSON.parse(section.slice(jsonStart, end).trim()) as StoredMeta;
	} catch {
		return null;
	}

	if (!meta?.id || !meta?.anchor?.kind) return null;

	const body = section.slice(end + 1 + BLOCK_CLOSE.length).trim();

	return {
		id: meta.id,
		anchor: meta.anchor,
		status: meta.status === "resolved" ? "resolved" : "open",
		created: meta.created ?? "",
		body: body === EMPTY_BODY ? "" : body,
	};
}

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---")) return markdown;
	const end = markdown.indexOf("\n---", 3);
	if (end < 0) return markdown;
	return markdown.slice(end + 4);
}
