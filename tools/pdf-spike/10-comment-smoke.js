// End-to-end check of the comment flow through CommentSession, on the real plugin build.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
for (const [name, path, selector] of [
  ["code", "Attachments/lectern-test/fixture-code.py", '[data-scope-kind="code"]'],
  ["pptx", "Attachments/lectern-test/fixture-deck.pptx", '[data-scope-kind="pptx"]'],
]) {
  const r = (results[name] = {});
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(app.vault.getAbstractFileByPath(path));
  app.workspace.setActiveLeaf(leaf, { focus: true });
  for (let i = 0; i < 50 && !leaf.view.containerEl.querySelector(selector); i++) await sleep(200);
  const view = leaf.view;
  r.viewType = view.getViewType();

  // Select a word inside the first scope element that has some text.
  const scope = [...view.containerEl.querySelectorAll(selector)].find((e) => (e.textContent ?? "").trim().length > 8);
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node; while ((node = walker.nextNode()) && node.nodeValue.trim().length < 5);
  const m = /\S{3,}/.exec(node.nodeValue);
  const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  r.selected = sel.toString();

  r.commandRan = app.commands.executeCommandById("lectern:comment-on-selection");
  await sleep(300);
  const draft = view.containerEl.querySelector(".lectern-card.is-draft textarea");
  r.draftOpened = !!draft;
  draft.value = `smoke ${name}`;
  view.containerEl.querySelector(".lectern-card.is-draft button.mod-cta").click();
  await sleep(800);

  const hl = view.containerEl.querySelectorAll(".lectern-highlight");
  r.highlightText = [...hl].map((h) => h.textContent).join("");
  r.cards = view.containerEl.querySelectorAll(".lectern-card:not(.is-draft)").length;
  r.selectionCleared = window.getSelection().rangeCount === 0;
  const notesBtn = [...view.containerEl.querySelectorAll("button")].find((b) => /^Notes/.test(b.textContent));
  r.toolbarNotes = notesBtn?.textContent;
  const sidecar = app.vault.getAbstractFileByPath(`File-Notes/${path.split("/").pop()}.comments.md`);
  const md = sidecar ? await app.vault.read(sidecar) : "";
  r.sidecarHasComment = md.includes(`smoke ${name}`);
  r.sidecarAnchorKind = /"kind":"(\w+)"/.exec(md)?.[1];

  // Resolve: card hides (resolved hidden by default), toolbar count drops.
  [...view.containerEl.querySelectorAll(".lectern-card button")].find((b) => b.textContent === "Resolve").click();
  await sleep(600);
  r.cardsAfterResolve = view.containerEl.querySelectorAll(".lectern-card").length;
  r.toolbarAfterResolve = [...view.containerEl.querySelectorAll("button")].find((b) => /^Notes/.test(b.textContent))?.textContent;

  // Reload from disk: still resolved, still placed.
  app.commands.executeCommandById("lectern:reload-comments");
  await sleep(600);
  r.highlightsAfterReload = view.containerEl.querySelectorAll(".lectern-highlight").length;

  // Show it again by reopening (status open) through the store path: delete instead.
  const md2 = await app.vault.read(sidecar);
  r.sidecarResolved = md2.includes('"status":"resolved"');
  leaf.detach();
}
// Clean up what the smoke test created.
for (const f of ["File-Notes/fixture-code.py.comments.md", "File-Notes/fixture-deck.pptx.comments.md"]) {
  const t = app.vault.getAbstractFileByPath(f); if (t) await app.vault.delete(t);
}
const folder = app.vault.getAbstractFileByPath("File-Notes");
// Folder removal is done from the shell: vault.delete on a folder throws EISDIR here.
results.sidecarsLeft = folder ? folder.children.map((c) => c.path) : [];
return results;
