// Home: reminders first, then filters, then what's in use, then paused.

import * as M from "./model.js";
import { doc, getMe, change, undo } from "./store.js";
import { esc, toast, openSheet } from "./ui.js";
import { shortDate } from "./dates.js";
import { itemRow } from "./rows.js";
import { boughtSheet, finishNow, resumeNow, stillGoing, pauseSheet, editUnitSheet, logSheet, newProductSheet } from "./forms.js";

export function mountHome(el, { onOpenItem, onImport, syncText }) {
  const f = { q: "", cat: "All", who: "all" };
  let me = "p1";

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return `${part}, ${M.people(doc())[me]}`;
  }

  function matches(item) {
    if (f.cat !== "All" && item.category !== f.cat) return false;
    if (f.who !== "all" && item.owner !== f.who) return false;
    if (f.q && !`${item.brand} ${item.product} ${item.type}`.toLowerCase().includes(f.q)) return false;
    return true;
  }

  function reminderAction(st) {
    if (st.status === "switch" && st.backup) return `<button type="button" class="btn" data-resume="${st.backup.id}">Switch</button>`;
    if (st.status === "check") return `<button type="button" class="btn" data-check="${st.item.id}">Check</button>`;
    return `<button type="button" class="btn primary" data-bought="${st.item.id}">Bought</button>`;
  }

  async function render() {
    me = await getMe();
    const d = doc();
    if (!M.liveItems(d).length) {
      el.innerHTML = `${head()}
        <div class="empty"><h2>Nothing tracked yet</h2>
          <p style="margin-top:8px">Import your cleaned spreadsheet to start with your history, or add your first product.</p>
          <div class="btn-row"><button type="button" class="btn primary" data-import>Import spreadsheet</button><button type="button" class="btn" data-newprod>Add a product</button></div></div>`;
      return;
    }
    const rem = M.reminders(d);
    const using = M.inUse(d).filter((s) => matches(s.item));
    const paused = M.pausedItems(d).filter((s) => matches(s.item));
    const cats = ["All", ...M.categories(d).filter((c) => M.inUse(d).some((s) => s.item.category === c))];
    const remCats = new Set(rem.map((r) => r.item.category));

    el.innerHTML = `${head()}
      ${rem.length ? `<section class="section" aria-labelledby="remH" style="margin-top:8px">
        <div class="section-head"><h2 id="remH">Reminders <span class="count">${rem.length}</span></h2>
          ${M.listSuggestions(d).length ? `<button type="button" class="btn quiet" data-tolist>Add to shopping list</button>` : ""}</div>
        <ul class="list panel">${rem.map((st) => itemRow(st, { tag: true, action: reminderAction(st) })).join("")}</ul>
      </section>` : `<p class="soft" style="margin-top:8px">Nothing to buy. ${nextLow(d)}</p>`}

      <section class="section" aria-label="Filter">
        <input class="search" type="search" placeholder="Search what you're using" aria-label="Search what you're using" value="${esc(f.q)}">
        <div class="chips" role="group" aria-label="Category">${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === f.cat}">${esc(c)}${remCats.has(c) ? '<span class="sr-only"> (has reminders)</span>' : ""}</button>`).join("")}</div>
        <div class="seg" role="group" aria-label="Whose" style="margin-top:12px">
          ${[["all", "Everyone"], ...Object.entries(M.people(d))].map(([v, l]) => `<button type="button" data-who="${v}" aria-pressed="${f.who === v}">${esc(l)}</button>`).join("")}
        </div>
      </section>

      <section class="section" aria-labelledby="useH">
        <div class="section-head"><h2 id="useH">In use <span class="count">${using.length}</span></h2></div>
        ${using.length ? `<ul class="list">${using.map((st) => itemRow(st, { action: `<button type="button" class="btn" data-finish="${st.item.id}">Finished</button>` })).join("")}</ul>`
          : `<p class="empty">Nothing open${f.q || f.cat !== "All" || f.who !== "all" ? " matches these filters" : ""}.</p>`}
      </section>

      ${paused.length ? `<section class="section"><details class="fold"><summary><h2>Paused <span class="count">${paused.length}</span></h2></summary>
        <ul class="list">${paused.map((st) => {
          const u = st.pausedOpen[0];
          const backupFor = st.item.backupFor && M.findItem(d, st.item.backupFor);
          return `<li class="row"><button type="button" class="row-link" data-item="${st.item.id}">
            <span class="name">${esc(M.itemName(st.item))}</span>
            <span class="meta"><span>${backupFor ? `Backup for ${esc(M.itemName(backupFor))}` : "Paused"}</span></span></button>
            <button type="button" class="btn" data-resume-unit="${st.item.id}|${u.id}">Resume</button></li>`;
        }).join("")}</ul></details></section>` : ""}`;
  }

  function head() {
    return `<header class="screen-head">
      <div><h1>${esc(greeting())}</h1><p class="sync" id="syncLine">${syncText()}</p></div>
      <button type="button" class="btn primary" data-log>Log / Add</button>
    </header>`;
  }

  function nextLow(d) {
    const next = M.inUse(d).find((s) => s.remindDate);
    return next ? `Next to run low: ${M.itemName(next.item)}, around ${shortDate(next.remindDate)}.` : "";
  }

  function checkSheet(itemId) {
    const st = M.itemState(doc(), M.findItem(doc(), itemId));
    const u = st.checkUnit;
    openSheet((s, close) => {
      s.innerHTML = `<h2>${esc(M.itemName(st.item))}</h2>
        <p class="hint">By your usual rate this should have run out. What's happening with it?</p>
        <div class="btn-grid">
          <button type="button" class="btn" data-c="going">Still going</button>
          <button type="button" class="btn" data-c="pause">I've paused it</button>
          <button type="button" class="btn primary" data-c="done">Finished</button>
        </div>`;
      s.addEventListener("click", (e) => {
        const c = e.target.closest("[data-c]")?.dataset.c;
        if (!c) return;
        close();
        if (c === "going") stillGoing(itemId, u.id);
        if (c === "pause") pauseSheet(itemId, u.id);
        if (c === "done") editUnitSheet(itemId, u.id);
      });
    }, { label: "Check" });
  }

  async function addRemindersToList() {
    const me = await getMe();
    const n = M.listSuggestions(doc()).length;
    await change((d) => M.listSuggestions(d).forEach((st) => M.addToList(d, { itemId: st.item.id, by: me })));
    toast(`Added ${n} to the shopping list`, [{ label: "Undo", run: undo }]);
  }

  el.addEventListener("click", (e) => {
    const t = e.target;
    const btn = (sel) => t.closest(sel);
    if (btn("[data-log]")) return logSheet({ onOpenItem });
    if (btn("[data-import]")) return onImport();
    if (btn("[data-newprod]")) return newProductSheet({ onOpenItem });
    if (btn("[data-tolist]")) return addRemindersToList();
    let b;
    if ((b = btn("[data-bought]"))) return boughtSheet(b.dataset.bought);
    if ((b = btn("[data-finish]"))) return finishNow(b.dataset.finish);
    if ((b = btn("[data-check]"))) return checkSheet(b.dataset.check);
    if ((b = btn("[data-resume]"))) {
      const backup = M.findItem(doc(), b.dataset.resume);
      const u = M.liveUnits(backup).find((x) => M.isOpenUnit(x) && M.isPausedUnit(x));
      return resumeNow(backup.id, u.id);
    }
    if ((b = btn("[data-resume-unit]"))) { const [i, u] = b.dataset.resumeUnit.split("|"); return resumeNow(i, u); }
    if ((b = btn("[data-cat]"))) { f.cat = b.dataset.cat; return render(); }
    if ((b = btn("[data-who]"))) { f.who = b.dataset.who; return render(); }
    if ((b = btn("[data-item]"))) return onOpenItem(b.dataset.item);
  });
  el.addEventListener("input", (e) => {
    if (!e.target.matches(".search")) return;
    f.q = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    render().then(() => { const s = el.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos); });
  });

  return { render, setSync: (html) => { const s = el.querySelector("#syncLine"); if (s) s.innerHTML = html; } };
}
