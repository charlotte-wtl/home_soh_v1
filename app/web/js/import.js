// One-off import of the cleaned spreadsheet (soh_cleaned.csv), plus export.
// Columns: category,type,brand,product,size,unit,price,bought,started,
//          finished,days,per_day,user,reminders,notes
// Each row is one bottle/pack; rows with the same category + type + brand +
// product become one item. Importing twice never duplicates an item.

import { uid, NON_CONSUMABLE, liveUnits, isOpenUnit } from "./model.js";

export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])));
}

const keyOf = (r) => [r.category, r.type, r.brand, r.product].map((x) => (x || "").toLowerCase()).join("|");
const num = (x) => (x === "" || x == null || Number.isNaN(Number(x)) ? null : Number(x));
const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || "");

// Adds the rows to `doc` in place. Returns { added, skipped }.
export function importRows(doc, rows) {
  const existing = new Set(doc.items.filter((i) => !i.deleted).map((i) => keyOf(i)));
  const groups = new Map();
  rows.forEach((r) => {
    if (!r.category || !r.type || !r.product) return;
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });

  // The sheet's main user owns nothing in particular (shared); anyone else
  // named in the "user" column is matched to a person in settings.people.
  const names = Object.entries(doc.settings?.people || {}).map(([k, v]) => [k, v.toLowerCase()]);
  const counts = {};
  rows.forEach((r) => { const u = (r.user || "").toLowerCase(); if (u) counts[u] = (counts[u] || 0) + 1; });
  const mainUser = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const personKey = (u) => names.find(([, n]) => n === (u || "").toLowerCase())?.[0] || null;

  let added = 0, skipped = 0;
  const stamp = Date.now();
  const newItems = [];
  for (const [k, group] of groups) {
    if (existing.has(k)) { skipped++; continue; }
    const first = group[0];
    const sizes = group.map((r) => num(r.size)).filter(Boolean);
    const unitLabel = first.unit === "ml/g" || !first.unit ? (first.category === "Groceries" ? "g" : "ml") : first.unit;
    const item = {
      id: uid("itm"), category: first.category, type: first.type, brand: first.brand, product: first.product,
      owner: first.user && first.user.toLowerCase() !== mainUser ? personKey(first.user) : null,
      consumable: !NON_CONSUMABLE.has(first.category) && first.reminders !== "no",
      size: sizes.length ? sizes[sizes.length - 1] : null, unit: sizes.length ? unitLabel : "pcs",
      spares: 0, units: [], warnDays: null, pctLeft: first.category === "Groceries" ? 0.3 : null,
      guessDays: null, backupFor: null, archived: false, deleted: false, createdAt: stamp, updatedAt: stamp,
    };
    group.forEach((r) => {
      if (isDate(r.started)) {
        item.units.push({ id: uid("u"), size: num(r.size) || item.size, openedAt: r.started, finishedAt: isDate(r.finished) ? r.finished : null, paused: [], by: personKey(r.user) });
      }
      const price = num(r.price);
      if (price) {
        doc.purchases.push({
          id: uid("p"), itemId: item.id, date: isDate(r.bought) ? r.bought : isDate(r.started) ? r.started : null,
          price, currency: "AUD", size: num(r.size) || item.size, unit: item.unit, qty: 1, shop: "", by: null,
          updatedAt: stamp, deleted: false,
        });
      }
    });
    item.units.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
    newItems.push(item);
    doc.items.push(item);
    added++;
  }

  // A finished product whose type has another one in use is something you
  // moved on from: file it under Past instead of reminding you to buy it.
  newItems.forEach((item) => {
    if (liveUnits(item).some(isOpenUnit) || !item.units.length) return;
    const replaced = doc.items.some((o) => o !== item && !o.deleted && o.type === item.type && liveUnits(o).some(isOpenUnit));
    if (replaced) item.archived = true;
  });
  return { added, skipped };
}

export function exportJSON(doc) {
  return JSON.stringify({ app: "home-soh", exportedAt: new Date().toISOString(), ...doc }, null, 2);
}

export function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
