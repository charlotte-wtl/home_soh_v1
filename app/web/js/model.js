// The stock list and all its maths. Pure functions over one document:
//   { items: [...], purchases: [...], settings: {...} }
// Nothing here touches the DOM, storage or the network, so it can be tested
// on its own (see tests/model.test.mjs).

import { todayStr, shiftDate, daysBetween } from "./dates.js";

export const CATEGORIES = [
  "Skincare", "Make up", "Daily Essentials", "Home Essentials", "Health & Supplements",
  "Pantry", "Groceries", "Fashion", "Electric Appliances",
];
// Food you use up a scoop at a time: remind at "% left" instead of days.
export const PCT_CATEGORIES = new Set(["Pantry", "Groceries"]);
export const isPctCategory = (c) => PCT_CATEGORIES.has(c);

// Built-in categories, then ones you added (settings.categories), then any
// category an item already uses.
export function categories(doc) {
  const out = [...CATEGORIES];
  [...(doc?.settings?.categories || []), ...(doc?.items || []).filter((i) => !i.deleted).map((i) => i.category)]
    .forEach((c) => { if (c && !out.includes(c)) out.push(c); });
  return out;
}

export function addCategory(doc, name) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return null;
  const existing = categories(doc).find((c) => c.toLowerCase() === n.toLowerCase());
  if (existing) return existing;
  doc.settings.categories = [...(doc.settings.categories || []), n];
  return n;
}
export const NON_CONSUMABLE = new Set(["Fashion", "Electric Appliances"]);
// Names are personal, so they live in the private data file (settings.people),
// never in this public code. These placeholders show until you connect.
export const DEFAULT_PEOPLE = { p1: "Person 1", p2: "Person 2" };
export const DEFAULT_SETTINGS = { hkdRate: 5.3, warnDays: 14, pctLeft: 0.3, currency: "AUD" };
export const people = (doc) => ({ ...DEFAULT_PEOPLE, ...(doc.settings?.people || {}) });
const RATE_SAMPLE = 5;      // last N finished units make the average
const CHECK_AFTER_DAYS = 7; // "should be empty" this many days ago → ask

export function emptyDoc() {
  return { items: [], purchases: [], shopping: [], settings: { ...DEFAULT_SETTINGS } };
}

export function uid(prefix) {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return prefix + "_" + [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 9);
}

const now = () => Date.now();
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------------- Lookups ---------------- */

export const liveItems = (doc) => doc.items.filter((i) => !i.deleted);
export const liveUnits = (item) => (item.units || []).filter((u) => !u.deleted);
export const livePurchases = (doc) => doc.purchases.filter((p) => !p.deleted);
export const findItem = (doc, id) => doc.items.find((i) => i.id === id && !i.deleted);
export const itemName = (item) => (item.brand && item.brand !== "(unknown)" ? `${item.brand} · ${item.product}` : item.product);
export const isPausedUnit = (u) => (u.paused || []).some((p) => !p.to);
export const isOpenUnit = (u) => !u.finishedAt;

// Days a unit was actually in use between opening and `until`, minus pauses.
export function activeDays(unit, until) {
  const end = unit.finishedAt || until;
  let days = daysBetween(unit.openedAt, end);
  (unit.paused || []).forEach((p) => {
    const from = p.from < unit.openedAt ? unit.openedAt : p.from;
    const to = p.to && p.to < end ? p.to : end;
    if (to > from) days -= daysBetween(from, to);
  });
  return Math.max(days, 0);
}

/* ---------------- Usage rate per type ---------------- */

// Average of the last few finished units of this type, across brands.
// Sized units give ml or g per day; unsized ones give days per unit.
export function typeRate(doc, type) {
  const finished = [];
  liveItems(doc).forEach((item) => {
    if (item.type !== type) return;
    liveUnits(item).forEach((u) => {
      if (!u.finishedAt || !u.openedAt) return;
      const days = activeDays(u, u.finishedAt);
      if (days < 1) return;
      finished.push({ size: u.size || item.size || null, days, finishedAt: u.finishedAt });
    });
  });
  finished.sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
  const sized = finished.filter((f) => f.size).slice(0, RATE_SAMPLE);
  if (sized.length) {
    const perDay = sized.reduce((s, f) => s + f.size / f.days, 0) / sized.length;
    return { mode: "size", perDay, n: sized.length };
  }
  const plain = finished.slice(0, RATE_SAMPLE);
  if (plain.length) return { mode: "unit", daysPerUnit: plain.reduce((s, f) => s + f.days, 0) / plain.length, n: plain.length };
  return null;
}

// How long one full unit of this item lasts, in days.
function fullUnitDays(item, rate, size) {
  if (rate?.mode === "size" && size) return size / rate.perDay;
  if (rate?.mode === "unit") return rate.daysPerUnit;
  if (item.guessDays) return item.guessDays;
  return null;
}

export function unitForecast(item, unit, rate, today = todayStr()) {
  const size = unit.size || item.size || null;
  if (isPausedUnit(unit)) return { unit, paused: true };
  const used = activeDays(unit, today);
  const full = fullUnitDays(item, rate, size);
  if (!full) return { unit, learning: true, usedDays: used };
  const daysLeft = full - used;
  return {
    unit,
    usedDays: used,
    daysLeft,
    pct: Math.max(0, Math.min(1, daysLeft / full)),
    finishDate: shiftDate(today, Math.max(daysLeft, 0)),
    overdue: daysLeft < 0,
  };
}

/* ---------------- Item status ---------------- */

// status: out | low | switch | check | ok | learning | paused | spare | none | past | owned
export function itemState(doc, item, today = todayStr()) {
  const units = liveUnits(item);
  const open = units.filter(isOpenUnit);
  const active = open.filter((u) => !isPausedUnit(u));
  const pausedOpen = open.filter(isPausedUnit);
  const rate = typeRate(doc, item.type);
  const forecasts = active.map((u) => unitForecast(item, u, rate, today));
  const spares = item.spares || 0;
  const backup = liveItems(doc).find((b) => b.backupFor === item.id && liveUnits(b).some((u) => isOpenUnit(u) && isPausedUnit(u)));
  const base = { item, rate, forecasts, open, active, pausedOpen, spares, backup };

  if (item.consumable === false) return { ...base, status: "owned" };
  if (item.archived) return { ...base, status: "past" };

  if (active.length) {
    const known = forecasts.filter((f) => !f.learning);
    if (!known.length) return { ...base, status: "learning" };
    const check = known.find((f) => f.daysLeft < -CHECK_AFTER_DAYS && !(f.unit.snoozeUntil && f.unit.snoozeUntil > today));
    // The last open unit to finish decides when the current stock ends.
    const current = known.reduce((a, b) => (b.daysLeft > a.daysLeft ? b : a));
    const full = fullUnitDays(item, rate, item.size) || 0;
    const runOutDays = Math.max(current.daysLeft, 0) + spares * full;
    const runOutDate = shiftDate(today, runOutDays);
    const warnDays = item.warnDays ?? doc.settings?.warnDays ?? DEFAULT_SETTINGS.warnDays;
    // pctLeft on an item switches it to the "% left" rule; the threshold is the shared setting.
    const pctRule = item.pctLeft ? (doc.settings?.pctLeft ?? item.pctLeft) : null;
    const remindDate = pctRule ? null : shiftDate(runOutDate, -warnDays);
    const out = { ...base, current, runOutDays, runOutDate, remindDate, pct: current.pct };
    if (check) return { ...out, status: "check", checkUnit: check.unit };
    const low = pctRule ? spares === 0 && current.pct <= pctRule : runOutDays <= warnDays;
    if (low) return { ...out, status: backup ? "switch" : "low" };
    return { ...out, status: "ok" };
  }
  if (pausedOpen.length) return { ...base, status: "paused" };
  if (spares > 0) return { ...base, status: "spare" };
  if (units.length) return { ...base, status: backup ? "switch" : "out" };
  return { ...base, status: "none" };
}

export const STATUS_LABEL = {
  out: "Out", low: "Low", switch: "Switch", check: "Check", ok: "In stock", learning: "Learning",
  paused: "Paused", spare: "Spare only", none: "Not opened", past: "Past", owned: "Owned",
};
const REMINDER_ORDER = { out: 0, check: 1, low: 2, switch: 3 };
export const isReminder = (s) => s.status in REMINDER_ORDER;

export function reminders(doc, today = todayStr()) {
  return liveItems(doc)
    .map((i) => itemState(doc, i, today))
    .filter(isReminder)
    .sort((a, b) => REMINDER_ORDER[a.status] - REMINDER_ORDER[b.status] || (a.runOutDays ?? 0) - (b.runOutDays ?? 0));
}

export function inUse(doc, today = todayStr()) {
  return liveItems(doc)
    .filter((i) => i.consumable !== false && !i.archived && liveUnits(i).some((u) => isOpenUnit(u) && !isPausedUnit(u)))
    .map((i) => itemState(doc, i, today))
    .sort((a, b) => (a.current?.daysLeft ?? 1e9) - (b.current?.daysLeft ?? 1e9));
}

export function pausedItems(doc, today = todayStr()) {
  return liveItems(doc).filter((i) => liveUnits(i).some((u) => isOpenUnit(u) && isPausedUnit(u))).map((i) => itemState(doc, i, today));
}

/* ---------------- Money ---------------- */

export function toAUD(amount, currency, settings) {
  if (amount == null || amount === "") return null;
  return currency === "HKD" ? amount / (settings?.hkdRate || DEFAULT_SETTINGS.hkdRate) : amount;
}

export function money(n, currency = "AUD") {
  if (n == null || Number.isNaN(n)) return "–";
  const sym = currency === "HKD" ? "HK$" : "A$";
  // Per-ml prices are tiny, so small amounts keep a third decimal.
  return sym + (n >= 100 ? n.toFixed(0) : n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2));
}

export const purchasesFor = (doc, itemId) =>
  livePurchases(doc).filter((p) => p.itemId === itemId).sort((a, b) => (a.date < b.date ? 1 : -1));

export function unitPriceAUD(doc, p) {
  const aud = toAUD(p.price, p.currency, doc.settings);
  return aud != null && p.size ? aud / p.size : null;
}

export function pricesCheapestFirst(doc, itemId) {
  return purchasesFor(doc, itemId)
    .filter((p) => p.price != null)
    .map((p) => ({ ...p, aud: toAUD(p.price, p.currency, doc.settings), perUnit: unitPriceAUD(doc, p) }))
    .sort((a, b) => (a.perUnit ?? a.aud) - (b.perUnit ?? b.aud));
}

// Cost of using this item, spread evenly over time (A$).
export function itemCost(doc, state) {
  const { item, rate } = state;
  const last = purchasesFor(doc, item.id).find((p) => p.price != null);
  if (!last || !rate) return null;
  let perDay = null;
  const per = unitPriceAUD(doc, last);
  if (rate.mode === "size" && per != null) perDay = rate.perDay * per;
  else if (rate.mode === "unit") perDay = toAUD(last.price, last.currency, doc.settings) / rate.daysPerUnit;
  if (perDay == null) return null;
  return { perDay, perMonth: perDay * 30, perYear: perDay * 365 };
}

export function spentInYear(doc, year, itemId = null) {
  const byCategory = {};
  let total = 0;
  livePurchases(doc).forEach((p) => {
    if (!p.date?.startsWith(String(year)) || p.price == null) return;
    if (itemId && p.itemId !== itemId) return;
    const item = doc.items.find((i) => i.id === p.itemId);
    const aud = toAUD(p.price, p.currency, doc.settings) * (p.qty || 1);
    total += aud;
    const cat = item?.category || "Other";
    byCategory[cat] = (byCategory[cat] || 0) + aud;
  });
  return { total, byCategory };
}

export function costByCategory(doc, today = todayStr()) {
  const out = {};
  let total = 0;
  liveItems(doc).forEach((i) => {
    if (i.consumable === false || i.archived) return;
    const st = itemState(doc, i, today);
    if (!st.active.length) return;
    const c = itemCost(doc, st);
    if (!c) return;
    out[i.category] = (out[i.category] || 0) + c.perMonth;
    total += c.perMonth;
  });
  return { total, byCategory: out };
}

/* ---------------- Pick-lists ---------------- */

export function typesIn(doc, category) {
  return [...new Set(liveItems(doc).filter((i) => i.category === category).map((i) => i.type))].sort();
}

function lastUsed(doc, item) {
  let d = "";
  liveUnits(item).forEach((u) => {
    if (isOpenUnit(u) && !isPausedUnit(u)) d = "9999";
    [u.openedAt, u.finishedAt].forEach((x) => { if (x && x > d) d = x; });
  });
  purchasesFor(doc, item.id).forEach((p) => { if (p.date > d) d = p.date; });
  return d;
}

// Brands for a type, most recently used first; then brands from other types.
export function brandsFor(doc, type) {
  const mine = new Map();
  const others = new Map();
  liveItems(doc).forEach((i) => {
    if (!i.brand) return;
    const when = lastUsed(doc, i);
    const target = i.type === type ? mine : others;
    const cur = target.get(i.brand);
    if (!cur || when > cur.when) target.set(i.brand, { brand: i.brand, when, using: when === "9999" });
  });
  const sort = (m) => [...m.values()].sort((a, b) => (a.when < b.when ? 1 : -1));
  const recent = sort(mine);
  return { recent, other: sort(others).filter((o) => !mine.has(o.brand)) };
}

// Items for the Log / Add picker: in use first, then most recent.
export function itemsByRecent(doc) {
  return liveItems(doc).map((i) => ({ item: i, when: lastUsed(doc, i) })).sort((a, b) => (a.when < b.when ? 1 : -1)).map((x) => x.item);
}

/* ---------------- Changes ----------------
   Each returns nothing and edits `doc` in place; the caller saves it. */

function touch(item) { item.updatedAt = now(); }

export function addItem(doc, f) {
  const item = {
    id: uid("itm"),
    category: f.category, type: f.type.trim(), brand: (f.brand || "").trim(), product: f.product.trim(),
    owner: f.owner || null,
    consumable: !NON_CONSUMABLE.has(f.category),
    size: f.size ? Number(f.size) : null, unit: f.unit || "ml",
    spares: 0, units: [],
    warnDays: null, pctLeft: isPctCategory(f.category) ? DEFAULT_SETTINGS.pctLeft : null,
    guessDays: f.guessDays ? Number(f.guessDays) : null,
    backupFor: null, archived: false, deleted: false,
    createdAt: now(), updatedAt: now(),
  };
  doc.items.push(item);
  return item;
}

export function openOne(doc, itemId, { date = todayStr(), by = null, size = null } = {}) {
  const item = findItem(doc, itemId);
  if (item.spares > 0) item.spares -= 1;
  item.archived = false;
  const unit = { id: uid("u"), size: size || item.size || null, openedAt: date, finishedAt: null, paused: [], by };
  item.units.push(unit);
  touch(item);
  return unit;
}

// Finishes the oldest open unit (or `unitId`). Returns that unit.
export function finishOne(doc, itemId, { unitId = null, date = todayStr() } = {}) {
  const item = findItem(doc, itemId);
  const open = liveUnits(item).filter(isOpenUnit).sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
  const unit = unitId ? open.find((u) => u.id === unitId) : open.find((u) => !isPausedUnit(u)) || open[0];
  if (!unit) return null;
  unit.finishedAt = date < unit.openedAt ? unit.openedAt : date;
  (unit.paused || []).forEach((p) => { if (!p.to) p.to = unit.finishedAt; });
  touch(item);
  return unit;
}

export function recordPurchase(doc, itemId, f) {
  const item = findItem(doc, itemId);
  const p = {
    id: uid("p"), itemId, date: f.date || todayStr(),
    price: f.price === "" || f.price == null ? null : Number(f.price),
    currency: f.currency || "AUD", size: f.size ? Number(f.size) : null, unit: f.unit || item.unit,
    qty: Math.max(1, Number(f.qty) || 1), shop: (f.shop || "").trim(), by: f.by || null,
    updatedAt: now(), deleted: false,
  };
  doc.purchases.push(p);
  if (p.size) item.size = p.size;
  if (f.unit) item.unit = f.unit;
  item.spares = (item.spares || 0) + p.qty;
  item.archived = false;
  touch(item);
  if (f.openNow) openOne(doc, itemId, { date: p.date, by: f.by });
  return p;
}

export function pauseUnit(doc, itemId, unitId, { date = todayStr(), backupFor } = {}) {
  const item = findItem(doc, itemId);
  const unit = item.units.find((u) => u.id === unitId);
  unit.paused = unit.paused || [];
  if (!isPausedUnit(unit)) unit.paused.push({ from: date, to: null });
  if (backupFor !== undefined) item.backupFor = backupFor || null;
  touch(item);
}

export function resumeUnit(doc, itemId, unitId, { date = todayStr() } = {}) {
  const item = findItem(doc, itemId);
  const unit = item.units.find((u) => u.id === unitId);
  (unit.paused || []).forEach((p) => { if (!p.to) p.to = date < p.from ? p.from : date; });
  item.backupFor = null;
  touch(item);
}

export function snoozeCheck(doc, itemId, unitId, { days = 14, today = todayStr() } = {}) {
  const item = findItem(doc, itemId);
  const unit = item.units.find((u) => u.id === unitId);
  unit.snoozeUntil = shiftDate(today, days);
  touch(item);
}

export function editUnit(doc, itemId, unitId, f) {
  const item = findItem(doc, itemId);
  const unit = item.units.find((u) => u.id === unitId);
  if (f.openedAt) unit.openedAt = f.openedAt;
  if ("finishedAt" in f) unit.finishedAt = f.finishedAt || null;
  if (unit.finishedAt && unit.finishedAt < unit.openedAt) unit.finishedAt = unit.openedAt;
  if ("size" in f) unit.size = f.size ? Number(f.size) : null;
  if (f.deleted) unit.deleted = true;
  touch(item);
}

export function updateItem(doc, itemId, f) {
  const item = findItem(doc, itemId);
  Object.assign(item, f);
  if ("category" in f) item.consumable = !NON_CONSUMABLE.has(item.category);
  touch(item);
}

export function deletePurchase(doc, purchaseId) {
  const p = doc.purchases.find((x) => x.id === purchaseId);
  p.deleted = true;
  p.updatedAt = now();
}

/* ---------------- Shopping list ----------------
   Anything you want to buy: free text (e.g. a new toothbrush head) or a
   tracked product. Entries are kept with a done flag so both phones agree. */

export const liveList = (doc) => (doc.shopping || []).filter((s) => !s.deleted);

export function shoppingList(doc) {
  const list = liveList(doc);
  return {
    toBuy: list.filter((s) => !s.done).sort((a, b) => a.addedAt - b.addedAt),
    done: list.filter((s) => s.done).sort((a, b) => b.doneAt - a.doneAt),
  };
}

// Reminders (Out / Low) that aren't on the list yet.
export function listSuggestions(doc, today = todayStr()) {
  const onList = new Set(liveList(doc).filter((s) => !s.done && s.itemId).map((s) => s.itemId));
  return reminders(doc, today).filter((st) => (st.status === "out" || st.status === "low") && !onList.has(st.item.id));
}

// Free text that matches a tracked product's name links to it.
export function matchItem(doc, text) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return liveItems(doc).find((i) => [itemName(i), i.product, `${i.brand} ${i.product}`].some((n) => n && n.toLowerCase() === t)) || null;
}

export function addToList(doc, { text = "", itemId = null, by = null } = {}) {
  const linked = itemId ? findItem(doc, itemId) : matchItem(doc, text);
  const label = linked ? itemName(linked) : text.trim();
  if (!label) return null;
  doc.shopping = doc.shopping || [];
  const dup = liveList(doc).find((s) => !s.done && (linked ? s.itemId === linked.id : s.text.toLowerCase() === label.toLowerCase()));
  if (dup) return dup;
  const entry = { id: uid("s"), text: label, itemId: linked?.id || null, by, addedAt: now(), done: false, doneAt: null, deleted: false, updatedAt: now() };
  doc.shopping.push(entry);
  return entry;
}

export function setListDone(doc, entryId, done = true) {
  const e = doc.shopping.find((s) => s.id === entryId);
  e.done = done; e.doneAt = done ? now() : null; e.updatedAt = now();
}

export function removeFromList(doc, entryId) {
  const e = doc.shopping.find((s) => s.id === entryId);
  e.deleted = true; e.updatedAt = now();
}

export function clearDone(doc) {
  liveList(doc).filter((s) => s.done).forEach((s) => { s.deleted = true; s.updatedAt = now(); });
}

export { round };
