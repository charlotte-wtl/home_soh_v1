// More: spending, this phone's settings, account and import/export.

import * as M from "./model.js";
import { doc, change, undo, getMe, setMe } from "./store.js";
import { esc, toast, formData } from "./ui.js";
import { parseCSV, importRows, exportJSON, download } from "./import.js";
import { getUserId, configState } from "./sync.js";
import { todayStr } from "./dates.js";

export function mountMore(el, { onConnect, onDisconnect }) {
  async function render() {
    const d = doc();
    const year = new Date().getFullYear();
    const spent = M.spentInYear(d, year);
    const cost = M.costByCategory(d);
    const cats = M.CATEGORIES.filter((c) => spent.byCategory[c] || cost.byCategory[c]);
    const me = await getMe();
    const userId = await getUserId();
    const state = await configState();

    el.innerHTML = `
      <header class="screen-head"><h1>More</h1></header>

      <section class="section" aria-labelledby="spH" style="margin-top:0">
        <div class="section-head"><h2 id="spH">Spending ${year}</h2></div>
        <dl class="facts">
          <dt>Spent this year</dt><dd>${M.money(spent.total)}</dd>
          <dt>Estimated cost a month</dt><dd>${M.money(cost.total)}</dd>
          <dt>Estimated cost a year</dt><dd>${M.money(cost.total * 365 / 30)}</dd>
        </dl>
        ${cats.length ? `<table class="data" style="margin-top:16px"><thead><tr><th>Category</th><th class="r">Spent</th><th class="r">A month</th></tr></thead><tbody>
          ${cats.map((c) => `<tr><td>${esc(c)}</td><td class="r">${spent.byCategory[c] ? M.money(spent.byCategory[c]) : "–"}</td><td class="r">${cost.byCategory[c] ? M.money(cost.byCategory[c]) : "–"}</td></tr>`).join("")}
        </tbody></table>` : ""}
        <p class="hint">Spent is what you paid since 1 Jan. Cost is your usage times the price, spread over time. All in AUD.</p>
      </section>

      <section class="section" aria-labelledby="stH">
        <div class="section-head"><h2 id="stH">Settings</h2></div>
        <div class="field"><span class="label">Who's using this phone</span>
          <div class="seg" role="group">${Object.entries(M.people(d)).map(([k, v]) => `<button type="button" data-me="${k}" aria-pressed="${me === k}">${esc(v)}</button>`).join("")}</div></div>
        <form id="prefs">
          <div class="field-pair">
            <div class="field"><label for="n1">Name 1</label><input id="n1" name="p1" value="${esc(M.people(d).p1)}" autocomplete="off"></div>
            <div class="field"><label for="n2">Name 2</label><input id="n2" name="p2" value="${esc(M.people(d).p2)}" autocomplete="off"></div>
          </div>
          <p class="hint">Saved in your private data, not in the app.</p>
          <div class="field-pair">
            <div class="field"><label for="hk">HKD per 1 AUD</label><input id="hk" name="hkdRate" type="number" inputmode="decimal" step="0.01" min="0.1" value="${d.settings.hkdRate}"></div>
            <div class="field"><label for="cu">Default currency</label><select id="cu" name="currency">${["AUD", "HKD"].map((c) => `<option ${d.settings.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          </div>
          <div class="field-pair">
            <div class="field"><label for="wd">Remind days before empty</label><input id="wd" name="warnDays" type="number" inputmode="numeric" min="1" value="${d.settings.warnDays}"></div>
            <div class="field"><label for="pl">Groceries: remind at % left</label><input id="pl" name="pctLeft" type="number" inputmode="numeric" min="5" max="90" value="${Math.round(d.settings.pctLeft * 100)}"></div>
          </div>
          <button type="submit" class="btn" style="margin-top:16px">Save settings</button>
        </form>
      </section>

      <section class="section" aria-labelledby="acH">
        <div class="section-head"><h2 id="acH">Account</h2></div>
        <dl class="facts"><dt>User ID</dt><dd>${esc(userId || "Not connected")}</dd><dt>Sync</dt><dd>${state === "ready" ? "Connected" : state === "needs-token" ? "Token needed this session" : "Not connected"}</dd></dl>
        <div class="btn-row">
          <button type="button" class="btn" data-connect>${userId ? "Change ID or token" : "Connect"}</button>
          ${state === "ready" ? `<button type="button" class="btn quiet" data-disconnect>Sign out on this phone</button>` : ""}
        </div>
      </section>

      <section class="section" aria-labelledby="imH">
        <div class="section-head"><h2 id="imH">Import and export</h2></div>
        <p class="soft small">Import the cleaned spreadsheet (soh_cleaned.csv) once. Products already in the list are skipped.</p>
        <div class="btn-row">
          <label class="btn"><input type="file" accept=".csv,text/csv" hidden data-file>Import spreadsheet</label>
          <button type="button" class="btn" data-export>Export backup</button>
        </div>
      </section>`;
  }

  el.addEventListener("click", async (e) => {
    const t = e.target;
    const meBtn = t.closest("[data-me]");
    if (meBtn) { await setMe(meBtn.dataset.me); toast(`This phone is ${M.people(doc())[meBtn.dataset.me]}'s`); return render(); }
    if (t.closest("[data-connect]")) return onConnect();
    if (t.closest("[data-disconnect]")) return onDisconnect();
    if (t.closest("[data-export]")) return download(`home-soh-${todayStr()}.json`, exportJSON(doc()));
  });

  el.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-file]")) return;
    const file = e.target.files[0];
    if (!file) return;
    const rows = parseCSV(await file.text());
    if (!rows.length || !("category" in rows[0])) { toast("That file doesn't look like the cleaned spreadsheet."); return; }
    const res = await change((d) => importRows(d, rows));
    toast(`Imported ${res.added} products${res.skipped ? `, skipped ${res.skipped} already here` : ""}`, [{ label: "Undo", run: undo }]);
    e.target.value = "";
  });

  el.addEventListener("submit", async (e) => {
    if (e.target.id !== "prefs") return;
    e.preventDefault();
    const f = formData(e.target);
    await change((d) => {
      d.settings = {
        ...d.settings,
        people: { p1: f.p1.trim() || "Person 1", p2: f.p2.trim() || "Person 2" },
        hkdRate: Number(f.hkdRate) || 5.3, currency: f.currency,
        warnDays: Math.max(1, Number(f.warnDays) || 14), pctLeft: Math.min(0.9, Math.max(0.05, (Number(f.pctLeft) || 30) / 100)),
      };
    });
    toast("Settings saved", [{ label: "Undo", run: undo }]);
  });

  return { render };
}
