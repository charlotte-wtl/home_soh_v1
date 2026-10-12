// Item detail: how much is left, the buttons, then history, prices and cost.

import * as M from "./model.js";
import { doc, change, undo, getMe } from "./store.js";
import { shortDate, todayStr } from "./dates.js";
import { esc, openSheet, toast, formData } from "./ui.js";
import { leftText, statusTag } from "./rows.js";
import { stockText, openNow, finishNow, boughtSheet, pauseSheet, resumeNow, editUnitSheet } from "./forms.js";

export function mountItem(el, { onBack }) {
  let itemId = null;

  function render() {
    const d = doc();
    const item = itemId && M.findItem(d, itemId);
    if (!item) { el.innerHTML = `<button type="button" class="back" data-back>‹ Back</button><p class="empty">This product was deleted.</p>`; return; }
    const st = M.itemState(d, item);
    const rate = st.rate;
    const unitLabel = item.unit || "ml";
    const units = M.liveUnits(item).slice().sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
    const prices = M.pricesCheapestFirst(d, item.id);
    const cost = M.itemCost(d, st);
    const spent = M.spentInYear(d, new Date().getFullYear(), item.id).total;
    const consumable = item.consumable !== false;
    const pausedUnit = st.pausedOpen[0];
    const onList = M.liveList(d).some((s) => !s.done && s.itemId === item.id);

    el.innerHTML = `
      <button type="button" class="back" data-back>‹ Back</button>
      <p class="crumb">${esc(item.category)} › ${esc(item.type)}${item.owner ? ` · ${esc(M.people(d)[item.owner])}'s` : ""}</p>
      <h1 style="margin-top:4px">${esc(M.itemName(item))}</h1>

      ${consumable ? `<div class="hero">
        ${statusTag(st.status)}
        <p class="big" style="margin-top:8px">${esc(leftText(st))}</p>
        ${st.current ? `<div class="level" data-status="${st.status}" aria-hidden="true"><i style="width:${Math.round(st.current.pct * 100)}%"></i></div>` : ""}
        <dl class="facts" style="margin-top:14px">
          ${st.current && !st.current.overdue ? `<dt>This one finishes</dt><dd>~${shortDate(st.current.finishDate)}</dd>` : ""}
          ${st.runOutDate && st.spares ? `<dt>All stock gone</dt><dd>~${shortDate(st.runOutDate)}</dd>` : ""}
          ${st.remindDate ? `<dt>Reminder</dt><dd>~${shortDate(st.remindDate)}</dd>` : ""}
          ${item.pctLeft ? `<dt>Reminder</dt><dd>at ${Math.round(d.settings.pctLeft * 100)}% left</dd>` : ""}
          <dt>Stock</dt><dd>${esc(stockText(st))}</dd>
        </dl>
        <div class="btn-grid">
          <button type="button" class="btn" data-a="open">Opened one</button>
          <button type="button" class="btn" data-a="finish" ${st.active.length ? "" : "disabled"}>Finished one</button>
          <button type="button" class="btn primary" data-a="bought">Bought</button>
          ${pausedUnit ? `<button type="button" class="btn" data-a="resume">Resume</button>` : `<button type="button" class="btn" data-a="pause" ${st.active.length ? "" : "disabled"}>Pause</button>`}
        </div>
      </div>

      <section class="section">
        <div class="section-head"><h2>Usage</h2><span class="count">${rate?.mode === "size" ? `${M.round(rate.perDay, 1)} ${unitLabel} a day, from ${rate.n} finished` : rate ? `${Math.round(rate.daysPerUnit)} days each, from ${rate.n} finished` : "Learning"}</span></div>
        ${units.length ? `<table class="data"><thead><tr><th>Opened → finished</th><th class="r">Days</th><th class="r">${unitLabel}/day</th></tr></thead><tbody>
          ${units.map((u) => {
            const days = M.activeDays(u, todayStr());
            const per = u.finishedAt && (u.size || item.size) && days ? M.round((u.size || item.size) / days, 1) : "–";
            const paused = M.isPausedUnit(u) ? " (paused)" : "";
            return `<tr class="tap" data-unit="${u.id}" tabindex="0" aria-label="Edit dates"><td>${shortDate(u.openedAt)} → ${u.finishedAt ? shortDate(u.finishedAt) : "now"}${paused}</td><td class="r">${days}</td><td class="r">${per}</td></tr>`;
          }).join("")}</tbody></table><p class="hint">Tap a row to change its dates.</p>` : `<p class="empty">Not opened yet.</p>`}
      </section>` : `<div class="hero"><p class="soft">Kept for price and history. No reminders for ${esc(item.category)}.</p>
        <div class="btn-row"><button type="button" class="btn primary" data-a="bought">Bought</button></div></div>`}

      ${onList ? `<p class="soft small" style="margin-top:16px">On your shopping list.</p>` : `<button type="button" class="btn quiet" data-a="list" style="margin-top:12px">Add to shopping list</button>`}

      <section class="section">
        <div class="section-head"><h2>Prices</h2><span class="count">cheapest first</span></div>
        ${prices.length ? `<table class="data"><thead><tr><th>Date, shop</th><th class="r">Price</th><th class="r">per ${unitLabel}</th></tr></thead><tbody>
          ${prices.map((p) => `<tr class="tap" data-purchase="${p.id}" tabindex="0" aria-label="Delete or keep this price"><td>${p.date ? shortDate(p.date) : "–"}${p.shop ? `, ${esc(p.shop)}` : ""}${p.qty > 1 ? ` (×${p.qty})` : ""}</td>
            <td class="r">${M.money(p.price, p.currency)}</td><td class="r">${p.perUnit != null ? M.money(p.perUnit) : "–"}</td></tr>`).join("")}
        </tbody></table>` : `<p class="empty">No prices yet. They're added when you log Bought.</p>`}
      </section>

      <section class="section">
        <div class="section-head"><h2>Cost</h2></div>
        <dl class="facts">
          ${cost ? `<dt>Per day</dt><dd>${M.money(cost.perDay)}</dd><dt>Per month</dt><dd>${M.money(cost.perMonth)}</dd><dt>Per year</dt><dd>${M.money(cost.perYear)}</dd>` : consumable ? `<dt>Per month</dt><dd>Needs a price and one finished</dd>` : ""}
          <dt>Spent this year</dt><dd>${M.money(spent)}</dd>
        </dl>
      </section>

      <section class="section">
        <div class="section-head"><h2>Settings</h2></div>
        <form id="itemSettings">
          ${consumable ? `<div class="field"><label for="sr">Remind me</label><select id="sr" name="rule">
            <option value="days" ${item.pctLeft ? "" : "selected"}>${item.warnDays ?? d.settings.warnDays} days before it runs out</option>
            <option value="pct" ${item.pctLeft ? "selected" : ""}>When about ${Math.round(d.settings.pctLeft * 100)}% is left</option></select></div>` : ""}
          <div class="field"><label for="so">Who uses it</label><select id="so" name="owner">
            <option value="">Shared</option>${Object.entries(M.people(d)).map(([k, v]) => `<option value="${k}" ${item.owner === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
          <div class="field-pair">
            <div class="field"><label for="sb">Brand</label><input id="sb" name="brand" value="${esc(item.brand)}"></div>
            <div class="field"><label for="sp">Product</label><input id="sp" name="product" value="${esc(item.product)}"></div>
          </div>
          <div class="btn-row"><button type="submit" class="btn">Save settings</button>
            <button type="button" class="btn quiet" data-archive>${item.archived ? "Move back to current" : "Not buying again"}</button>
            <button type="button" class="btn quiet" data-delete>Delete product</button></div>
        </form>
      </section>`;
  }

  function purchaseSheet(pid) {
    const p = doc().purchases.find((x) => x.id === pid);
    openSheet((s, close) => {
      s.innerHTML = `<h2>${M.money(p.price, p.currency)}${p.shop ? ` at ${esc(p.shop)}` : ""}</h2><p class="hint">${p.date ? shortDate(p.date) : ""}</p>
        <div class="btn-row"><button type="button" class="btn" data-x="keep">Keep</button><button type="button" class="btn primary" data-x="del">Delete price</button></div>`;
      s.addEventListener("click", async (e) => {
        const x = e.target.closest("[data-x]")?.dataset.x;
        if (!x) return;
        close();
        if (x === "del") { await change((d) => M.deletePurchase(d, pid)); toast("Price deleted", [{ label: "Undo", run: undo }]); }
      });
    }, { label: "Price" });
  }

  el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-back]")) return onBack();
    const a = t.closest("[data-a]")?.dataset.a;
    if (a) {
      const st = M.itemState(doc(), M.findItem(doc(), itemId));
      if (a === "open") return openNow(itemId);
      if (a === "finish") return finishNow(itemId);
      if (a === "bought") return boughtSheet(itemId);
      if (a === "list") {
        const me = await getMe();
        await change((d) => M.addToList(d, { itemId, by: me }));
        return toast("Added to the shopping list", [{ label: "Undo", run: undo }]);
      }
      if (a === "pause") return pauseSheet(itemId, st.active[0].id);
      if (a === "resume") return resumeNow(itemId, st.pausedOpen[0].id);
    }
    const row = t.closest("[data-unit]"); if (row) return editUnitSheet(itemId, row.dataset.unit);
    const pr = t.closest("[data-purchase]"); if (pr) return purchaseSheet(pr.dataset.purchase);
    if (t.closest("[data-archive]")) {
      const item = M.findItem(doc(), itemId);
      await change((d) => M.updateItem(d, itemId, { archived: !item.archived }));
      return toast(item.archived ? "Moved back to current" : "Moved to past products", [{ label: "Undo", run: undo }]);
    }
    if (t.closest("[data-delete]")) {
      const name = M.itemName(M.findItem(doc(), itemId));
      await change((d) => M.updateItem(d, itemId, { deleted: true }));
      onBack();
      return toast(`Deleted ${name}`, [{ label: "Undo", run: undo }]);
    }
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr.tap")) e.target.click(); });
  el.addEventListener("submit", async (e) => {
    if (e.target.id !== "itemSettings") return;
    e.preventDefault();
    const f = formData(e.target);
    await change((d) => M.updateItem(d, itemId, {
      owner: f.owner || null, brand: f.brand.trim(), product: f.product.trim() || M.findItem(d, itemId).product,
      ...(f.rule ? { pctLeft: f.rule === "pct" ? (M.findItem(d, itemId).pctLeft || d.settings.pctLeft) : null } : {}),
    }));
    toast("Settings saved", [{ label: "Undo", run: undo }]);
  });

  return { show(id) { itemId = id; render(); }, render, get id() { return itemId; } };
}
