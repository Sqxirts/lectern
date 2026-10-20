import { App, TFile } from "obsidian";
import type { LecternSettings } from "../settings";

export interface RenderContext {
	app: App;
	file: TFile;
	/** The zoomable content area. Renderers own everything inside it. */
	container: HTMLElement;
	settings: LecternSettings;
	/** Renderers call this when their own state changes the toolbar. */
	refreshToolbar: () => void;
}

export interface ToolbarItem {
	id: string;
	/** Tooltip text. English only. */
	label: string;
	/** Short glyph shown on the button. */
	text: string;
	onClick: () => void | Promise<void>;
	/** Rendered in a pressed state when true. */
	active?: boolean;
	disabled?: boolean;
}

/**
 * One renderer per file kind. The view owns the chrome (toolbar, zoom, comment
 * rail); a renderer only fills the content area and says how to address the
 * things inside it.
 *
 * Anchor scoping contract: any element a comment can be anchored *within*
 * carries `data-scope-kind` ("pptx" | "docx" | "code" | "xlsx") and
 * `data-scope-index` (slide number, page number, line number, or sheet name).
 * anchoring.ts reads those attributes and needs to know nothing else about the
 * renderer that produced them.
 */
export abstract class Renderer {
	protected ctx: RenderContext;

	constructor(ctx: RenderContext) {
		this.ctx = ctx;
	}

	abstract render(): Promise<void>;

	/** Buttons this renderer adds to the shared toolbar. */
	toolbarItems(): ToolbarItem[] {
		return [];
	}

	/** Extra CSS class applied to the zoom wrapper for renderer-specific layout. */
	wrapperClass(): string | null {
		return null;
	}

	/** True when the current state blocks commenting, e.g. a code file being edited. */
	commentingBlocked(): string | null {
		return null;
	}

	/** Release listeners, workers, object URLs. */
	destroy(): void {
		/* nothing by default */
	}
}
