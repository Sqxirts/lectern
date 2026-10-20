import { describe, expect, it } from "vitest";
// Resolves to tests/helpers/obsidian.ts via the alias in vitest.config.ts.
import { TFile } from "obsidian";
import { CommentStore } from "../src/comments/CommentStore";
import { CommentSession, type CommentHost, type CommentRailLike, type CommentStoreLike } from "../src/comments/CommentSession";
import type { Anchor, ScopeComment } from "../src/comments/types";

const ANCHOR: Anchor = { kind: "code", line: 2, quote: "world", prefix: "hello ", suffix: "" };
const tick = () => new Promise((r) => setTimeout(r, 0));

function comment(id: string): ScopeComment {
	return { id, anchor: ANCHOR, status: "open", created: "2026-10-12T23:00", body: `note ${id}` };
}

/** An in-memory vault whose writes take a tick, like a real disk. */
class FakeVault {
	files = new Map<string, string>();
	folders = new Set<string>();
	creates = 0;
	getAbstractFileByPath(path: string) {
		if (this.files.has(path)) return new (TFile as any)(path);
		if (this.folders.has(path)) return { path };
		return null;
	}
	async read(file: { path: string }) { await tick(); return this.files.get(file.path) ?? ""; }
	async modify(file: { path: string }, data: string) { await tick(); this.files.set(file.path, data); }
	async create(path: string, data: string) {
		await tick();
		if (this.files.has(path)) throw new Error("File already exists.");
		this.creates++;
		this.files.set(path, data);
	}
	async createFolder(path: string) { await tick(); this.folders.add(path); }
}

function stores(n: number) {
	const vault = new FakeVault();
	const app = { vault } as any;
	const source = new (TFile as any)("Degree/deck.pptx");
	return { vault, list: Array.from({ length: n }, () => new CommentStore(app, source, "File-Notes")) };
}

describe("CommentStore: two panes on one file", () => {
	it("keeps both panes' comments instead of the last writer's", async () => {
		const { vault, list: [a, b] } = stores(2);
		await a.load();
		await b.load();
		await a.add(comment("from-a"));
		await b.add(comment("from-b")); // b's copy predates a's save
		const check = new CommentStore({ vault } as any, new (TFile as any)("Degree/deck.pptx"), "File-Notes");
		expect((await check.load()).map((c) => c.id)).toEqual(["from-a", "from-b"]);
	});

	it("creates a new sidecar once when both panes save at the same moment", async () => {
		const { vault, list: [a, b] } = stores(2);
		await Promise.all([a.load(), b.load()]);
		await Promise.all([a.add(comment("x")), b.add(comment("y"))]);
		expect(vault.creates).toBe(1);
		expect([...vault.files.values()][0]).toContain("x");
		expect([...vault.files.values()][0]).toContain("y");
	});

	it("does not resurrect a comment another pane deleted", async () => {
		const { vault, list: [a, b] } = stores(2);
		await a.add(comment("gone"));
		await b.load();
		await a.remove("gone");
		await b.update("gone", { body: "late edit" }); // b still shows it
		expect([...vault.files.values()][0]).not.toContain("late edit");
	});

	it("keeps writing after one write fails", async () => {
		const { vault, list: [a] } = stores(1);
		await a.add(comment("first"));
		const modify = vault.modify.bind(vault);
		vault.modify = async () => { throw new Error("disk full"); };
		await expect(a.add(comment("lost"))).rejects.toThrow("disk full");
		vault.modify = modify;
		await a.add(comment("third"));
		expect((await a.load()).map((c) => c.id)).toEqual(["first", "third"]);
	});
});

class SlowStore implements CommentStoreLike<string> {
	comments: ScopeComment[] = [];
	loadGate: Promise<void> = Promise.resolve();
	fail = false;
	async load() { await this.loadGate; return this.comments; }
	async add(c: ScopeComment) {
		await tick();
		if (this.fail) throw new Error("write failed");
		this.comments.push(c);
	}
	async update() {}
	async remove() {}
	sidecarFile() { return null; }
}

function session(store: SlowStore, notices: string[] = []) {
	document.body.innerHTML = `<div id="root"><p id="line">hello world</p></div>`;
	const root = document.getElementById("root")!;
	const host: CommentHost = {
		root,
		blockedReason: () => null,
		buildAnchor: () => ANCHOR,
		place: (cs) => cs.map((c) => ({ comment: c, elements: [], orphaned: false })),
		draftTop: () => 0,
		changed: () => {},
	};
	let rails = 0;
	const rail: CommentRailLike = {
		setComments() {}, openDraft() {}, closeDraft() {}, layout() {}, onScroll() {}, focus() {}, destroy() {},
	};
	const s = new CommentSession<string>(host, store, () => { rails++; return rail; }, {
		notify: (m) => notices.push(m),
		openNote: async () => {},
		getSelection: () => window.getSelection(),
	});
	const select = () => {
		const range = document.createRange();
		range.selectNodeContents(document.getElementById("line")!);
		window.getSelection()!.removeAllRanges();
		window.getSelection()!.addRange(range);
	};
	return { s, rails: () => rails, select };
}

describe("CommentSession races", () => {
	it("builds no rail when torn down while the sidecar loads (file switched)", async () => {
		const store = new SlowStore();
		let release!: () => void;
		store.loadGate = new Promise((r) => (release = r));
		const { s, rails } = session(store);
		const started = s.start();
		s.destroy();
		release();
		await started;
		expect(rails()).toBe(0);
	});

	it("adds a draft once when Save fires twice during a slow write", async () => {
		const store = new SlowStore();
		const { s, select } = session(store);
		await s.start();
		select();
		s.startComment();
		await Promise.all([s.commitDraft("once"), s.commitDraft("once")]);
		expect(store.comments).toHaveLength(1);
	});

	it("keeps the draft open after a failed save so Save can retry", async () => {
		const store = new SlowStore();
		const notices: string[] = [];
		const { s, select } = session(store, notices);
		await s.start();
		select();
		s.startComment();
		store.fail = true;
		await s.commitDraft("retry me");
		expect(notices.some((n) => n.includes("Could not save"))).toBe(true);
		store.fail = false;
		await s.commitDraft("retry me");
		expect(store.comments.map((c) => c.body)).toEqual(["retry me"]);
	});
});
