// Shop: anything you want to buy. Type anything (tracked or not); running-low
// products are suggested underneath. Ticking a tracked product opens Bought,
// so buying it also restocks it.

import * as M from "./model.js";
import { doc, change, undo, getMe } from "./store.js";
import { esc, toast } from "./ui.js";
import { boughtSheet, newProductSheet } from "./forms.js";
import { shortDate } from "./dates.js";

export function mountShop(el, { onOpenItem }) {
  function meta(entry) {
    const d = doc();
    if (entry.itemId && M.findItem(d, entry.itemId)) {
      const last = M.purchasesFor(d, entry.itemId).find((p) => p.price != null);
      const best = M.pricesCheapestFirst(d, entry.itemId)[0];
      const parts = [];
      if (last) parts.push(`Last ${M.money(last.price, last.currency)}${last.shop ? ` at ${last.shop}` : ""}`);
      if (best && best.id !== last?.id) parts.push(`best ${M.money(best.price, best.currency)}${best.shop ? ` at ${best.shop}` : ""}`);
      return parts.join(", ") || "Tracked product";
    }
    const who = entry.by && M.people(d)[entry.by];
    return who ? `Added by ${who}` : "";
  }

  function render() {
    const d = doc();
    const { toBuy, done } = M.shoppingList(d);
    const suggest = M.listSuggestions(d);
    const names = M.liveItems(d).filter((i) => !i.archived).map((i) => M.itemName(i));

    el.innerHTML = `
      <header class="screen-head"><h1>Shopping list</h1>
        ${toBuy.length ? `<button type="button" class="btn quiet" data-share>Share</button>` : ""}</header>

      <form class="add-row" data-add autocomplete="off">
        <label for="addText" class="sr-only">Add something to buy</label>
        <input id="addText" class="search" name="text" placeholder="Add something to buy" list="trackedNames" enterkeyhint="done" lang="zh-Hant">
        <datalist id="trackedNames">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <button type="submit" class="btn primary">Add</button>
      </form>

      <section class="section" aria-labelledby="buyH">
        <div class="section-head"><h2 id="buyH">To buy <span class="count">${toBuy.length}</span></h2></div>
        ${toBuy.length ? `<ul class="list">${toBuy.map((e) => `
          <li class="row">
            <button type="button" class="tick" data-tick="${e.id}" aria-label="Got ${esc(e.text)}"><span></span></button>
            <div class="row-main">
              ${e.itemId ? `<button type="button" class="row-link" data-item="${e.itemId}"><span class="name">${esc(e.text)}</span></button>` : `<span class="name">${esc(e.text)}</span>`}
              <span class="meta"><span>${esc(meta(e))}</span></span>
            </div>
            <button type="button" class="btn quiet" data-remove="${e.id}" aria-label="Remove ${esc(e.text)}">Remove</button>
          </li>`).join("")}</ul>` : `<p class="empty">Nothing on the list. Type above, or add from Running low.</p>`}
      </section>

      ${suggest.length ? `<section class="section" aria-labelledby="sugH">
        <div class="section-head"><h2 id="sugH">Running low <span class="count">${suggest.length}</span></h2></div>
        <ul class="list">${suggest.map((st) => `
          <li class="row"><button type="button" class="row-link" data-item="${st.item.id}">
            <span class="name">${esc(M.itemName(st.item))}</span>
            <span class="meta"><span><span class="status ${st.status}">${M.STATUS_LABEL[st.status]}</span></span></span></button>
            <button type="button" class="btn" data-suggest="${st.item.id}" aria-label="Add ${esc(M.itemName(st.item))} to the list">Add</button></li>`).join("")}</ul>
        <button type="button" class="btn quiet" data-suggest-all style="margin-top:8px">Add all ${suggest.length}</button>
      </section>` : ""}

      ${done.length ? `<section class="section"><details class="fold"><summary><h2>Got <span class="count">${done.length}</span></h2></summary>
        <ul class="list">${done.map((e) => `<li class="row">
          <button type="button" class="tick" data-untick="${e.id}" aria-label="Put ${esc(e.text)} back on the list" aria-pressed="true"><span></span></button>
          <div class="row-main"><span class="name done">${esc(e.text)}</span><span class="meta"><span>${e.doneAt ? shortDate(new Date(e.doneAt).toLocaleDateString("en-CA")) : ""}</span></span></div></li>`).join("")}</ul>
        <button type="button" class="btn quiet" data-clear>Clear got items</button></details></section>` : ""}`;
  }

  async function tick(entryId) {
    const entry = doc().shopping.find((s) => s.id === entryId);
    if (entry.itemId && M.findItem(doc(), entry.itemId)) {
      // Tracked: log the purchase; the entry is ticked only once it's saved.
      boughtSheet(entry.itemId, { onDone: () => change((d) => M.setListDone(d, entryId, true)) });
      return;
    }
    await change((d) => M.setListDone(d, entryId, true));
    toast(`Got ${entry.text}`, [
      { label: "Track it", run: () => newProductSheet({ onOpenItem }) },
      { label: "Undo", run: undo },
    ]);
  }

  el.addEventListener("submit", async (e) => {
    if (!e.target.matches("[data-add]")) return;
    e.preventDefault();
    const text = e.target.text.value;
    if (!text.trim()) { e.target.text.focus(); return; }
    const me = await getMe();
    await change((d) => M.addToList(d, { text, by: me }));
    render();
    el.querySelector("#addText").focus();
  });

  el.addEventListener("click", async (e) => {
    const t = e.target;
    let b;
    if ((b = t.closest("[data-tick]"))) return tick(b.dataset.tick);
    if ((b = t.closest("[data-untick]"))) return change((d) => M.setListDone(d, b.dataset.untick, false));
    if ((b = t.closest("[data-remove]"))) {
      await change((d) => M.removeFromList(d, b.dataset.remove));
      return toast("Removed", [{ label: "Undo", run: undo }]);
    }
    if ((b = t.closest("[data-suggest]"))) { const me = await getMe(); return change((d) => M.addToList(d, { itemId: b.dataset.suggest, by: me })); }
    if (t.closest("[data-suggest-all]")) {
      const me = await getMe();
      return change((d) => M.listSuggestions(d).forEach((st) => M.addToList(d, { itemId: st.item.id, by: me })));
    }
    if (t.closest("[data-clear]")) { await change((d) => M.clearDone(d)); return toast("Cleared", [{ label: "Undo", run: undo }]); }
    if (t.closest("[data-share]")) return shareList();
    if ((b = t.closest("[data-item]"))) return onOpenItem(b.dataset.item);
  });

  return { render };
}

export async function shareList() {
  const { toBuy } = M.shoppingList(doc());
  const text = "To buy:\n" + toBuy.map((e) => `- ${e.text}`).join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Shopping list", text });
    else { await navigator.clipboard.writeText(text); toast("List copied"); }
  } catch (e) { /* share sheet dismissed */ }
}
