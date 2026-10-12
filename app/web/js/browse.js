// Browse: everything you own or have owned. Category → Type → Brand / product.

import * as M from "./model.js";
import { doc } from "./store.js";
import { esc } from "./ui.js";
import { itemRow } from "./rows.js";
import { logSheet } from "./forms.js";

export function mountBrowse(el, { onOpenItem }) {
  const f = { q: "", cat: "All", past: false };

  function render() {
    const d = doc();
    const items = M.liveItems(d);
    const cats = ["All", ...M.categories(d).filter((c) => items.some((i) => i.category === c))];
    const shown = items.filter((i) =>
      (f.cat === "All" || i.category === f.cat) &&
      (f.past || !i.archived) &&
      (!f.q || `${i.brand} ${i.product} ${i.type} ${i.category}`.toLowerCase().includes(f.q)));
    const pastCount = items.filter((i) => i.archived && (f.cat === "All" || i.category === f.cat)).length;

    const groups = new Map();
    shown.forEach((i) => {
      const key = `${i.category}|${i.type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    const keys = [...groups.keys()].sort((a, b) =>
      M.categories(d).indexOf(a.split("|")[0]) - M.categories(d).indexOf(b.split("|")[0]) || a.localeCompare(b));

    el.innerHTML = `
      <header class="screen-head"><h1>Browse</h1><button type="button" class="btn primary" data-log>Log / Add</button></header>
      <input class="search" type="search" placeholder="Search brand, product or type" aria-label="Search brand, product or type" value="${esc(f.q)}">
      <div class="chips" role="group" aria-label="Category">${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === f.cat}">${esc(c)}</button>`).join("")}</div>
      ${keys.length ? keys.map((k) => {
        const [cat, type] = k.split("|");
        const rate = M.typeRate(d, type);
        const rateText = rate?.mode === "size" ? `${M.round(rate.perDay, 1)} ${groups.get(k)[0].unit || "ml"} a day` : rate ? `${Math.round(rate.daysPerUnit)} days each` : "";
        return `<section class="section">
          <div class="section-head"><h2>${esc(type)}${f.cat === "All" ? ` <span class="count">${esc(cat)}</span>` : ""}</h2><span class="count">${esc(rateText)}</span></div>
          <ul class="list">${groups.get(k).map((i) => itemRow(M.itemState(d, i), { tag: true })).join("")}</ul>
        </section>`;
      }).join("") : `<p class="empty">Nothing matches. Try another word or category.</p>`}
      ${pastCount ? `<button type="button" class="btn quiet" data-past style="margin-top:20px">${f.past ? "Hide" : "Show"} past products (${pastCount})</button>` : ""}`;
  }

  el.addEventListener("click", (e) => {
    let b;
    if (e.target.closest("[data-log]")) return logSheet({ onOpenItem });
    if (e.target.closest("[data-past]")) { f.past = !f.past; return render(); }
    if ((b = e.target.closest("[data-cat]"))) { f.cat = b.dataset.cat; return render(); }
    if ((b = e.target.closest("[data-item]"))) return onOpenItem(b.dataset.item);
  });
  el.addEventListener("input", (e) => {
    if (!e.target.matches(".search")) return;
    f.q = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    render();
    const s = el.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos);
  });

  return { render };
}
