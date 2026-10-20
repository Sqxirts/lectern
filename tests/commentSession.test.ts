import { beforeEach, describe, expect, it } from "vitest";
import {
	CommentSession,
	type CommentHost,
	type CommentRailLike,
	type CommentStoreLike,
} from "../src/comments/CommentSession";
import type { Anchor, PlacedComment, ScopeComment } from "../src/comments/types";

const ANCHOR: Anchor = { kind: "code", line: 2, quote: "world", prefix: "hello ", suffix: "" };

class FakeStore implements CommentStoreLike<string> {
	comments: ScopeComment[] = [];
	onDisk: ScopeComment[] = [];
	loads = 0;
	file: string | null = null;

	async load() { this.loads++; this.comments = [...this.onDisk]; return this.comments; }
	async add(c: ScopeComment) { this.comments.push(c); }
	async update(id: string, changes: Partial<Pick<ScopeComment, "body" | "status">>) {
		Object.assign(this.comments.find((c) => c.id === id)!, changes);
	}
	async remove(id: string) { this.comments = this.comments.filter((c) => c.id !== id); }
	sidecarFile() { return this.file; }
}

class FakeRail implements CommentRailLike {
	placed: PlacedComment[] = [];
	draftTop: number | null = null;
	layouts = 0;
	destroyed = false;
	setComments(p: PlacedComment[]) { this.placed = p; }
	openDraft(top: number) { this.draftTop = top; }
	closeDraft() { this.draftTop = null; }
	layout() { this.layouts++; }
	onScroll() {}
	focus() {}
	resolvedVisible = false;
	setShowResolved(v: boolean) { this.resolvedVisible = v; }
	destroy() { this.destroyed = true; }
}

function comment(id: string, status: "open" | "resolved" = "open"): ScopeComment {
	return { id, anchor: ANCHOR, status, created: "2026-10-07T12:00", body: `note ${id}` };
}

describe("CommentSession", () => {
	let root: HTMLElement;
	let outside: HTMLElement;
	let store: FakeStore;
	let rail: FakeRail;
	let notices: string[];
	let opened: string[];
	let changed: number;
	let blocked: string | null;
	let anchorable: boolean;
	let session: CommentSession<string>;

	function select(el: HTMLElement): void {
		const range = document.createRange();
		range.selectNodeContents(el);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	beforeEach(async () => {
		document.body.innerHTML = `<div id="root"><p id="line">hello world</p></div><p id="out">elsewhere</p>`;
		root = document.getElementById("root")!;
		outside = document.getElementById("out")!;
		store = new FakeStore();
		store.onDisk = [comment("a"), comment("b", "resolved")];
		rail = new FakeRail();
		notices = [];
		opened = [];
		changed = 0;
		blocked = null;
		anchorable = true;

		const host: CommentHost = {
			root,
			blockedReason: () => blocked,
			buildAnchor: () => (anchorable ? ANCHOR : null),
			place: (cs) => cs.map((c) => ({ comment: c, elements: [], orphaned: false })),
			draftTop: () => 42,
			changed: () => changed++,
		};

		session = new CommentSession<string>(host, store, () => rail, {
			notify: (m) => notices.push(m),
			openNote: async (f) => { opened.push(f); },
			getSelection: () => window.getSelection(),
		});
		await session.start();
	});

	it("loads the sidecar and places every comment on start", () => {
		expect(store.loads).toBe(1);
		expect(rail.placed.map((p) => p.comment.id)).toEqual(["a", "b"]);
		expect(session.total).toBe(2);
		expect(session.openCount).toBe(1);
	});

	it("shows and hides resolved comments, and says so when there are none", async () => {
		expect(session.resolvedCount).toBe(1);
		expect(session.resolvedVisible).toBe(false);

		session.toggleResolved();
		expect(rail.resolvedVisible).toBe(true);
		expect(session.resolvedVisible).toBe(true);
		expect(changed).toBe(1);

		session.toggleResolved();
		expect(rail.resolvedVisible).toBe(false);

		// Reopen the only resolved comment: showing nothing is not a toggle.
		await session.setStatus("b", "open");
		const before = changed;
		session.toggleResolved();
		expect(rail.resolvedVisible).toBe(false);
		expect(notices).toEqual(["No resolved comments on this file."]);
		expect(changed).toBe(before);
	});

	it("opens a draft level with the selection", () => {
		select(document.getElementById("line")!);
		session.startComment();
		expect(rail.draftTop).toBe(42);
		expect(notices).toEqual([]);
	});

	it("refuses when the host blocks commenting", () => {
		blocked = "Switch to read mode to comment.";
		select(document.getElementById("line")!);
		session.startComment();
		expect(notices).toEqual(["Switch to read mode to comment."]);
		expect(rail.draftTop).toBeNull();
	});

	it("refuses an empty selection", () => {
		window.getSelection()!.removeAllRanges();
		session.startComment();
		expect(notices[0]).toMatch(/Select some text first/);
	});

	it("refuses a selection outside the document", () => {
		select(outside);
		session.startComment();
		expect(notices[0]).toMatch(/inside the document/);
	});

	it("refuses a selection the host cannot anchor", () => {
		anchorable = false;
		select(document.getElementById("line")!);
		session.startComment();
		expect(notices[0]).toMatch(/cannot be anchored/);
		expect(rail.draftTop).toBeNull();
	});

	it("saves a draft with the anchor, then clears selection and refreshes", async () => {
		select(document.getElementById("line")!);
		session.startComment();
		await session.commitDraft("my note");

		const added = store.comments[2];
		expect(added.anchor).toEqual(ANCHOR);
		expect(added.body).toBe("my note");
		expect(added.status).toBe("open");
		expect(rail.draftTop).toBeNull();
		expect(window.getSelection()!.rangeCount).toBe(0);
		expect(rail.placed).toHaveLength(3);
		expect(changed).toBe(1);
	});

	it("does nothing on commit when no draft is open", async () => {
		await session.commitDraft("stray");
		expect(store.comments).toHaveLength(2);
		expect(changed).toBe(0);
	});

	it("drops the draft on cancel", async () => {
		select(document.getElementById("line")!);
		session.startComment();
		session.cancelDraft();
		await session.commitDraft("too late");
		expect(rail.draftTop).toBeNull();
		expect(store.comments).toHaveLength(2);
	});

	it("resolve and delete refresh the toolbar; editing a body does not", async () => {
		await session.saveBody("a", "edited");
		expect(store.comments[0].body).toBe("edited");
		expect(changed).toBe(0);

		await session.setStatus("a", "resolved");
		expect(session.openCount).toBe(0);
		expect(changed).toBe(1);

		await session.deleteComment("b");
		expect(rail.placed.map((p) => p.comment.id)).toEqual(["a"]);
		expect(changed).toBe(2);
	});

	it("says so when there is no sidecar to open", async () => {
		await session.openSidecar();
		expect(notices).toEqual(["No comments on this file yet."]);
		store.file = "File-Notes/x.pdf.comments.md";
		await session.openSidecar();
		expect(opened).toEqual(["File-Notes/x.pdf.comments.md"]);
	});

	it("reloads hand edits from disk", async () => {
		store.onDisk = [comment("c")];
		await session.reload();
		expect(rail.placed.map((p) => p.comment.id)).toEqual(["c"]);
		expect(notices).toEqual(["Comments reloaded."]);
	});

	it("tears the rail down and ignores later calls", () => {
		session.destroy();
		expect(rail.destroyed).toBe(true);
		select(document.getElementById("line")!);
		session.startComment();
		expect(notices).toEqual([]);
	});
});
