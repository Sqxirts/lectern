import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField } from "obsidian";
import { findScopeBlocks, type ScopeBlock } from "./sidecarFormat";
import { anchorLabel, type Anchor } from "./types";

/**
 * Live Preview shows `%% %%` blocks as dimmed text, so a sidecar opened there
 * is a wall of anchor JSON. This swaps each `%%scope` block for a small chip
 * that jumps to the comment's place in the source file. The file on disk is
 * untouched. Source mode shows the raw JSON for editing. The arrow keys skip a
 * chip, but a selection that reaches one (select all, say) shows its block, so
 * copy and delete never act on text you can't see.
 */

export type OpenAnchor = (sidecarPath: string, anchor: Anchor) => void;

const SIDECAR_SUFFIX = ".comments.md";

class ScopeChip extends WidgetType {
	constructor(
		private readonly meta: NonNullable<ScopeBlock["meta"]>,
		private readonly sidecarPath: string,
		private readonly open: OpenAnchor,
	) {
		super();
	}

	private get label(): string {
		return anchorLabel(this.meta.anchor);
	}

	eq(other: ScopeChip): boolean {
		return (
			other.label === this.label &&
			other.meta.status === this.meta.status &&
			other.sidecarPath === this.sidecarPath &&
			JSON.stringify(other.meta.anchor) === JSON.stringify(this.meta.anchor)
		);
	}

	toDOM(): HTMLElement {
		const wrap = createDiv({ cls: "lectern-scope-chip" });
		const link = wrap.createEl("button", {
			cls: "lectern-scope-chip-link",
			text: `${this.label} ↗`,
			attr: { "aria-label": `Open ${this.label} in the source file` },
		});
		// mousedown would otherwise move the cursor into the block and reveal it
		link.addEventListener("mousedown", (event) => event.preventDefault());
		link.addEventListener("click", (event) => {
			event.preventDefault();
			this.open(this.sidecarPath, this.meta.anchor);
		});
		if (this.meta.status === "resolved") {
			wrap.createSpan({ cls: "lectern-scope-chip-status", text: "Resolved" });
		}
		return wrap;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function buildDecorations(state: EditorState, open: OpenAnchor): DecorationSet {
	if (!state.field(editorLivePreviewField, false)) return Decoration.none;
	const path = state.field(editorInfoField, false)?.file?.path;
	if (!path?.endsWith(SIDECAR_SUFFIX)) return Decoration.none;

	const ranges = [];
	for (const block of findScopeBlocks(state.doc.toString())) {
		if (!block.meta) continue;
		// selection reaches the block: show the JSON it would copy or delete
		const touched = state.selection.ranges.some((r) => r.from <= block.to && r.to >= block.from);
		if (touched) continue;
		ranges.push(
			Decoration.replace({ block: true, widget: new ScopeChip(block.meta, path, open) }).range(block.from, block.to),
		);
	}
	return Decoration.set(ranges);
}

/** The editor extension main.ts registers. */
export function sidecarEditorExtension(open: OpenAnchor): Extension {
	// Block decorations have to come from a state field, not a view plugin.
	return StateField.define<DecorationSet>({
		create: (state) => buildDecorations(state, open),
		// Sidecars are small, so rebuilding on every transaction is cheap and
		// catches mode switches and file swaps without tracking them.
		update: (_value, tr) => buildDecorations(tr.state, open),
		provide: (field) => EditorView.decorations.from(field),
	});
}
