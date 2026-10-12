// Bottom-sheet forms and the one-tap actions behind the buttons.
// Words stay the same through each flow: "Bought" saves a purchase and the
// toast says "Bought …"; "Finished" saves and the toast says "Finished …".

import * as M from "./model.js";
import { doc, change, undo, getMe } from "./store.js";
import { todayStr, shortDate } from "./dates.js";
import { esc, openSheet, toast, formData } from "./ui.js";

const undoAction = { label: "Undo", run: async () => { if (await undo()) toast("Undone"); } };

/* ---------------- One-tap actions ---------------- */

export async function finishNow(itemId, unitId = null) {
  const unit = await change((d) => M.finishOne(d, itemId, { unitId }));
  if (!unit) { toast("Nothing open to finish."); return; }
  const item = M.findItem(doc(), itemId);
  toast(`Finished ${M.itemName(item)}`, [
    { label: "Change date", run: () => editUnitSheet(itemId, unit.id) },
    undoAction,
  ]);
}

export async function openNow(itemId) {
  const me = await getMe();
  await change((d) => M.openOne(d, itemId, { by: me }));
  toast(`Opened ${M.itemName(M.findItem(doc(), itemId))}`, [undoAction]);
}

export async function stillGoing(itemId, unitId) {
  await change((d) => M.snoozeCheck(d, itemId, unitId));
  toast("Noted. I'll ask again in 2 weeks.", [undoAction]);
}

export async function resumeNow(itemId, unitId) {
  await change((d) => M.resumeUnit(d, itemId, unitId));
  toast(`Resumed ${M.itemName(M.findItem(doc(), itemId))}`, [undoAction]);
}

/* ---------------- Bought ---------------- */

export function boughtSheet(itemId, { onDone } = {}) {
  const item = M.findItem(doc(), itemId);
  const last = M.purchasesFor(doc(), itemId)[0];
  const best = M.pricesCheapestFirst(doc(), itemId)[0];
  const v = {
    size: last?.size ?? item.size ?? "", unit: last?.unit || item.unit || "ml",
    price: last?.price ?? "", currency: last?.currency || doc().settings.currency || "AUD", shop: last?.shop || "",
  };
  openSheet((el, close) => {
    el.innerHTML = `
      <h2>Bought: ${esc(M.itemName(item))}</h2>
      <p class="hint">${last ? `Filled in from ${esc(shortDate(last.date))}. Change anything that's different.` : "First purchase of this product."}</p>
      <form novalidate>
        ${sizeFields(v)}
        ${priceFields(v)}
        <div class="field"><label for="f-shop">Shop</label><input id="f-shop" name="shop" value="${esc(v.shop)}" autocomplete="off"></div>
        <div class="field-pair">
          <div class="field"><label for="f-date">Date</label><input id="f-date" name="date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
          <div class="field"><span class="label" id="qty-l">Quantity</span>
            <div class="stepper" role="group" aria-labelledby="qty-l">
              <button type="button" class="btn" data-q="-1" aria-label="One less">−</button>
              <output id="f-qty">1</output>
              <button type="button" class="btn" data-q="1" aria-label="One more">+</button>
            </div></div>
        </div>
        <div class="field"><span class="label">Open one now?</span>
          <div class="seg" role="group"><button type="button" data-open="1" aria-pressed="false">Yes</button><button type="button" data-open="0" aria-pressed="true">No</button></div></div>
        <p class="note" id="f-unit" aria-live="polite"></p>
        <button type="submit" class="btn primary block" style="margin-top:16px">Save purchase</button>
      </form>`;
    const form = el.querySelector("form");
    let qty = 1, openNow = false;
    const unitNote = () => {
      const f = formData(form);
      const aud = M.toAUD(Number(f.price), f.currency, doc().settings);
      const per = f.price && f.size ? aud / Number(f.size) : null;
      let text = per ? `${M.money(per, "AUD")} per ${f.unit}` : "Add a price and size to see the unit price.";
      if (f.currency === "HKD" && f.price) text = `≈ ${M.money(aud)} (HK$${f.price} ÷ ${doc().settings.hkdRate}). ` + text;
      if (per && best?.perUnit) text += per <= best.perUnit + 1e-9 ? ". Your best price so far." : `. Best so far ${M.money(best.perUnit)} at ${best.shop || "—"}.`;
      el.querySelector("#f-unit").textContent = text;
    };
    unitNote();
    form.addEventListener("input", unitNote);
    form.addEventListener("click", (e) => {
      const q = e.target.closest("[data-q]");
      if (q) { qty = Math.max(1, qty + Number(q.dataset.q)); el.querySelector("#f-qty").textContent = qty; }
      const o = e.target.closest("[data-open]");
      if (o) { openNow = o.dataset.open === "1"; form.querySelectorAll("[data-open]").forEach((b) => b.setAttribute("aria-pressed", String(b === o))); }
      const c = e.target.closest("[data-cur]");
      if (c) { form.querySelector("[name=currency]").value = c.dataset.cur; form.querySelectorAll("[data-cur]").forEach((b) => b.setAttribute("aria-pressed", String(b === c))); unitNote(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = formData(form);
      const me = await getMe();
      await change((d) => M.recordPurchase(d, itemId, { ...f, qty, openNow, by: me }));
      close();
      toast(`Bought ${M.itemName(item)}`, [undoAction]);
      onDone?.();
    });
  }, { label: "Bought" });
}

function sizeFields(v) {
  return `<div class="field-pair">
    <div class="field"><label for="f-size">Size</label><input id="f-size" name="size" type="number" inputmode="decimal" min="0" step="any" value="${esc(v.size)}"></div>
    <div class="field"><label for="f-unitsel">Unit</label><select id="f-unitsel" name="unit">
      ${["ml", "g", "pcs"].map((u) => `<option ${u === v.unit ? "selected" : ""}>${u}</option>`).join("")}</select></div>
  </div>`;
}

function priceFields(v) {
  return `<div class="field"><label for="f-price">Price (each)</label>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="f-price" name="price" type="number" inputmode="decimal" min="0" step="any" value="${esc(v.price)}" style="flex:1">
      <input type="hidden" name="currency" value="${esc(v.currency)}">
      <div class="seg" role="group" aria-label="Currency">
        <button type="button" data-cur="AUD" aria-pressed="${v.currency !== "HKD"}">AUD</button>
        <button type="button" data-cur="HKD" aria-pressed="${v.currency === "HKD"}">HKD</button>
      </div></div></div>`;
}

/* ---------------- Log / Add picker ---------------- */

export function logSheet({ onOpenItem }) {
  openSheet((el, close) => {
    const all = M.itemsByRecent(doc());
    el.innerHTML = `
      <div class="sheet-head"><h2>Log / Add</h2><button type="button" class="btn quiet" data-new>New product</button></div>
      <input class="search" type="search" placeholder="Search your products" aria-label="Search your products" style="margin-top:12px">
      <ul class="list" id="pick" style="margin-top:8px"></ul>`;
    const list = el.querySelector("#pick");
    const draw = (q = "") => {
      const needle = q.trim().toLowerCase();
      const hits = all.filter((i) => !needle || `${i.brand} ${i.product} ${i.type} ${i.category}`.toLowerCase().includes(needle)).slice(0, 30);
      list.innerHTML = hits.map((i) => {
        const st = M.itemState(doc(), i);
        return `<li class="row"><button type="button" class="row-link" data-id="${i.id}">
          <span class="name">${esc(M.itemName(i))}</span>
          <span class="meta"><span>${esc(i.category)} › ${esc(i.type)}</span><span>${stockText(st)}</span></span></button></li>`;
      }).join("") || `<li class="empty">No match. Add it as a new product.</li>`;
    };
    draw();
    el.querySelector(".search").addEventListener("input", (e) => draw(e.target.value));
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-new]")) { close(); newProductSheet({ onOpenItem }); return; }
      const pick = e.target.closest("[data-id]");
      if (pick) { close(); actionSheet(pick.dataset.id, { onOpenItem }); }
    });
  }, { label: "Log or add" });
}

export function stockText(st) {
  const parts = [];
  if (st.active?.length) parts.push(`${st.active.length} open`);
  if (st.pausedOpen?.length) parts.push(`${st.pausedOpen.length} paused`);
  if (st.spares) parts.push(`${st.spares} spare`);
  return parts.join(", ") || M.STATUS_LABEL[st.status];
}

// Step 2: what happened to this product.
export function actionSheet(itemId, { onOpenItem }) {
  const item = M.findItem(doc(), itemId);
  const st = M.itemState(doc(), item);
  openSheet((el, close) => {
    const pausedUnit = st.pausedOpen[0];
    el.innerHTML = `
      <h2>${esc(M.itemName(item))}</h2>
      <p class="hint">${esc(item.category)} › ${esc(item.type)}. ${esc(stockText(st))}.</p>
      <div class="btn-grid">
        <button type="button" class="btn" data-a="open">Opened one</button>
        <button type="button" class="btn" data-a="finish" ${st.active.length ? "" : "disabled"}>Finished one</button>
        <button type="button" class="btn primary" data-a="bought">Bought</button>
        ${pausedUnit ? `<button type="button" class="btn" data-a="resume">Resume</button>`
          : `<button type="button" class="btn" data-a="pause" ${st.active.length ? "" : "disabled"}>Pause</button>`}
      </div>
      <button type="button" class="btn quiet" data-a="detail" style="margin-top:12px">See details</button>`;
    el.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      close();
      if (a === "open") openNow(itemId);
      if (a === "finish") finishNow(itemId);
      if (a === "bought") boughtSheet(itemId);
      if (a === "pause") pauseSheet(itemId, st.active[0].id);
      if (a === "resume") resumeNow(itemId, pausedUnit.id);
      if (a === "detail") onOpenItem(itemId);
    });
  }, { label: M.itemName(item) });
}

/* ---------------- New product ---------------- */

export function newProductSheet({ onOpenItem } = {}) {
  const s = { category: "", type: "", brand: "", step: 1 };
  openSheet((el, close) => {
    const draw = () => {
      if (s.step === 1) {
        el.innerHTML = `<h2>New product</h2><p class="hint">Which category?</p>
          <ul class="list" style="margin-top:8px">${M.categories(doc()).map((c) => `<li class="row"><button type="button" class="row-link" data-cat="${esc(c)}"><span class="name">${esc(c)}</span></button></li>`).join("")}</ul>
          <form class="field" data-newcat><label for="nc">New category</label><div style="display:flex;gap:8px"><input id="nc" name="c" placeholder="e.g. Baby, Pet, Car" style="flex:1"><button class="btn">Next</button></div></form>`;
      } else if (s.step === 2) {
        const types = M.typesIn(doc(), s.category);
        el.innerHTML = `<button type="button" class="back" data-back>‹ ${esc(s.category)}</button><h2>What type?</h2>
          <ul class="list" style="margin-top:8px">${types.map((t) => `<li class="row"><button type="button" class="row-link" data-type="${esc(t)}"><span class="name">${esc(t)}</span></button></li>`).join("")}</ul>
          <form class="field" data-newtype><label for="nt">New type</label><div style="display:flex;gap:8px"><input id="nt" name="t" placeholder="e.g. Body lotion" style="flex:1"><button class="btn">Next</button></div></form>`;
      } else if (s.step === 3) {
        const { recent, other } = M.brandsFor(doc(), s.type);
        const when = (b) => (b.using ? "Using now" : b.when ? `Last used ${shortDate(b.when)}` : "");
        el.innerHTML = `<button type="button" class="back" data-back>‹ ${esc(s.category)} › ${esc(s.type)}</button><h2>Which brand?</h2>
          ${recent.length ? `<p class="hint">Most recently used first.</p><ul class="list">${recent.map((b) => `<li class="row"><button type="button" class="row-link" data-brand="${esc(b.brand)}"><span class="name">${esc(b.brand)}</span><span class="meta"><span>${esc(when(b))}</span></span></button></li>`).join("")}</ul>` : ""}
          <form class="field" data-newbrand><label for="nb">New brand</label><div style="display:flex;gap:8px"><input id="nb" name="b" placeholder="e.g. Laneige" style="flex:1" list="otherBrands"><button class="btn">Next</button></div>
          <datalist id="otherBrands">${other.map((b) => `<option value="${esc(b.brand)}">`).join("")}</datalist></form>`;
      } else {
        const rate = M.typeRate(doc(), s.type);
        el.innerHTML = `<button type="button" class="back" data-back>‹ ${esc(s.brand)}</button><h2>${esc(s.brand)}: ${esc(s.type)}</h2>
          <form novalidate>
            <div class="field"><label for="np">Product name</label><input id="np" name="product" value="${esc(s.type)}" required></div>
            ${sizeFields({ size: "", unit: M.isPctCategory(s.category) ? "g" : "ml" })}
            ${priceFields({ price: "", currency: doc().settings.currency || "AUD" })}
            <div class="field"><label for="ns">Shop</label><input id="ns" name="shop" autocomplete="off"></div>
            <div class="field-pair">
              <div class="field"><label for="nd">Date bought</label><input id="nd" name="date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
              <div class="field"><label for="nq">Quantity</label><input id="nq" name="qty" type="number" inputmode="numeric" min="1" value="1"></div>
            </div>
            <div class="field"><label for="no">Who uses it</label><select id="no" name="owner"><option value="">Shared</option>${Object.entries(M.people(doc())).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
            ${M.NON_CONSUMABLE.has(s.category) ? "" : `<div class="field"><span class="label">Open one now?</span><div class="seg" role="group"><button type="button" data-open="1" aria-pressed="true">Yes</button><button type="button" data-open="0" aria-pressed="false">No</button></div></div>`}
            ${rate ? "" : M.NON_CONSUMABLE.has(s.category) ? "" : `<div class="field"><label for="ng">About how many days does one last?</label><input id="ng" name="guessDays" type="number" inputmode="numeric" min="1" placeholder="e.g. 60"><p class="hint">Only needed until you finish the first one.</p></div>`}
            <p class="note" id="np-note" aria-live="polite"></p>
            <button type="submit" class="btn primary block" style="margin-top:16px">Add ${esc(s.brand)}</button>
          </form>`;
        const form = el.querySelector("form");
        let openIt = !M.NON_CONSUMABLE.has(s.category);
        const note = () => {
          const f = formData(form);
          const parts = [];
          if (f.price) {
            const aud = M.toAUD(Number(f.price), f.currency, doc().settings);
            if (f.currency === "HKD") parts.push(`≈ ${M.money(aud)} (HK$${f.price} ÷ ${doc().settings.hkdRate})`);
            if (f.size) parts.push(`${M.money(aud / Number(f.size))} per ${f.unit}`);
          }
          if (rate?.mode === "size" && f.size) parts.push(`${s.type} averages ${M.round(rate.perDay, 1)} ${f.unit}/day, so this should last about ${Math.round(Number(f.size) / rate.perDay)} days.`);
          el.querySelector("#np-note").textContent = parts.join(". ") || (M.NON_CONSUMABLE.has(s.category) ? "Kept in your list with its price. No reminders." : "Add the size to see how long it should last.");
        };
        note();
        form.addEventListener("input", note);
        form.addEventListener("click", (e) => {
          const o = e.target.closest("[data-open]");
          if (o) { openIt = o.dataset.open === "1"; form.querySelectorAll("[data-open]").forEach((b) => b.setAttribute("aria-pressed", String(b === o))); }
          const c = e.target.closest("[data-cur]");
          if (c) { form.querySelector("[name=currency]").value = c.dataset.cur; form.querySelectorAll("[data-cur]").forEach((b) => b.setAttribute("aria-pressed", String(b === c))); note(); }
        });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const f = formData(form);
          if (!f.product.trim()) { form.querySelector("#np").focus(); return; }
          const me = await getMe();
          const item = await change((d) => {
            const it = M.addItem(d, { category: s.category, type: s.type, brand: s.brand, product: f.product, size: f.size, unit: f.unit, owner: f.owner, guessDays: f.guessDays });
            if (f.price || f.size || Number(f.qty) > 0) M.recordPurchase(d, it.id, { ...f, by: me, openNow: openIt });
            return it;
          });
          close();
          toast(`Added ${M.itemName(item)}`, [undoAction]);
          onOpenItem?.(item.id);
        });
      }
    };
    el.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("[data-back]")) { s.step -= 1; draw(); return; }
      const cat = t.closest("[data-cat]"); if (cat) { s.category = cat.dataset.cat; s.step = 2; draw(); return; }
      const ty = t.closest("[data-type]"); if (ty) { s.type = ty.dataset.type; s.step = 3; draw(); return; }
      const br = t.closest("[data-brand]"); if (br) { s.brand = br.dataset.brand; s.step = 4; draw(); }
    });
    el.addEventListener("submit", (e) => {
      const nc = e.target.closest("[data-newcat]");
      if (nc) {
        e.preventDefault();
        const v = nc.c.value.trim();
        if (v) change((d) => M.addCategory(d, v)).then((name) => { s.category = name; s.step = 2; draw(); });
        return;
      }
      const nt = e.target.closest("[data-newtype]");
      if (nt) { e.preventDefault(); const v = nt.t.value.trim(); if (v) { s.type = v.charAt(0).toUpperCase() + v.slice(1); s.step = 3; draw(); } }
      const nb = e.target.closest("[data-newbrand]");
      if (nb) { e.preventDefault(); const v = nb.b.value.trim(); if (v) { s.brand = v; s.step = 4; draw(); } }
    });
    draw();
  }, { label: "New product" });
}

/* ---------------- Pause, dates ---------------- */

export function pauseSheet(itemId, unitId) {
  const item = M.findItem(doc(), itemId);
  const candidates = M.liveItems(doc()).filter((i) => i.id !== itemId && i.category === item.category && i.consumable !== false && !i.archived);
  openSheet((el, close) => {
    el.innerHTML = `<h2>Pause ${esc(M.itemName(item))}</h2>
      <p class="hint">Stops the clock while you're not using it. No reminders until you resume.</p>
      <form>
        <div class="field"><label for="pb">Use it when this runs out (optional)</label>
          <select id="pb" name="backupFor"><option value="">Nothing in particular</option>
          ${candidates.map((c) => `<option value="${c.id}">${esc(M.itemName(c))}</option>`).join("")}</select></div>
        <div class="field"><label for="pd">Paused since</label><input id="pd" name="date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
        <button type="submit" class="btn primary block" style="margin-top:16px">Pause</button>
      </form>`;
    el.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      await change((d) => M.pauseUnit(d, itemId, unitId, { date: f.date, backupFor: f.backupFor }));
      close();
      toast(`Paused ${M.itemName(item)}`, [undoAction]);
    });
  }, { label: "Pause" });
}

export function editUnitSheet(itemId, unitId) {
  const item = M.findItem(doc(), itemId);
  const unit = item.units.find((u) => u.id === unitId);
  openSheet((el, close) => {
    el.innerHTML = `<h2>${esc(M.itemName(item))}</h2>
      <form>
        <div class="field-pair">
          <div class="field"><label for="uo">Opened</label><input id="uo" name="openedAt" type="date" value="${unit.openedAt}" max="${todayStr()}" required></div>
          <div class="field"><label for="uf">Finished</label><input id="uf" name="finishedAt" type="date" value="${unit.finishedAt || ""}" max="${todayStr()}"></div>
        </div>
        <div class="field"><label for="us">Size (${esc(item.unit || "ml")})</label><input id="us" name="size" type="number" inputmode="decimal" step="any" value="${unit.size ?? ""}"></div>
        <p class="hint">Leave Finished empty if it's still in use.</p>
        <div class="btn-row"><button type="submit" class="btn primary">Save dates</button><button type="button" class="btn quiet" data-del>Delete this record</button></div>
      </form>`;
    el.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      await change((d) => M.editUnit(d, itemId, unitId, f));
      close();
      toast("Dates saved", [undoAction]);
    });
    el.querySelector("[data-del]").addEventListener("click", async () => {
      await change((d) => M.editUnit(d, itemId, unitId, { deleted: true }));
      close();
      toast("Record deleted", [undoAction]);
    });
  }, { label: "Edit dates" });
}
