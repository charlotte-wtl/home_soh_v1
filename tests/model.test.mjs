// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../app/web/js/model.js";
import { mergeDocs } from "../app/web/js/merge.js";
import { parseCSV, importRows } from "../app/web/js/import.js";

const T = "2026-10-09";

function shampooDoc() {
  const doc = M.emptyDoc();
  const old = M.addItem(doc, { category: "Daily Essentials", type: "Shampoo", brand: "Old", product: "Shampoo", size: 700 });
  M.openOne(doc, old.id, { date: "2025-11-05" });
  M.finishOne(doc, old.id, { date: "2026-01-13" });
  const brandS = M.addItem(doc, { category: "Daily Essentials", type: "Shampoo", brand: "BrandS", product: "Shampoo", size: 1000 });
  M.openOne(doc, brandS.id, { date: "2026-09-04" });
  return { doc, brandS };
}

test("shampoo example from the plan: 10.1 ml/day, finishes ~12 Dec, reminder ~28 Nov", () => {
  const { doc, brandS } = shampooDoc();
  const rate = M.typeRate(doc, "Shampoo");
  assert.equal(M.round(rate.perDay, 1), 10.1);
  const st = M.itemState(doc, M.findItem(doc, brandS.id), T);
  assert.equal(st.status, "ok");
  assert.equal(st.current.finishDate, "2026-12-12");
  assert.equal(st.remindDate, "2026-11-28");
  assert.equal(M.itemState(doc, M.findItem(doc, brandS.id), "2026-11-29").status, "low");
});

test("cost per month: 10 ml/day at $14 per 1000 ml is about $4.20", () => {
  const doc = M.emptyDoc();
  const a = M.addItem(doc, { category: "Daily Essentials", type: "Shampoo", brand: "A", product: "S", size: 1000 });
  M.recordPurchase(doc, a.id, { price: 14, size: 1000, date: "2026-01-01" });
  M.openOne(doc, a.id, { date: "2026-01-01" });
  M.finishOne(doc, a.id, { date: "2026-04-11" }); // 100 days → 10 ml/day
  M.openOne(doc, a.id, { date: "2026-04-11" });
  const c = M.itemCost(doc, M.itemState(doc, M.findItem(doc, a.id), "2026-05-01"));
  assert.equal(M.round(c.perDay, 2), 0.14);
  assert.equal(M.round(c.perMonth, 2), 4.2);
});

test("paused days don't count and a paused item gets no reminder", () => {
  const doc = M.emptyDoc();
  const s = M.addItem(doc, { category: "Skincare", type: "Serum", brand: "BrandG", product: "Serum", size: 80 });
  const u = M.openOne(doc, s.id, { date: "2026-01-01" });
  M.pauseUnit(doc, s.id, u.id, { date: "2026-01-11" });
  M.resumeUnit(doc, s.id, u.id, { date: "2026-01-31" });
  M.finishOne(doc, s.id, { date: "2026-02-10" });
  assert.equal(M.activeDays(M.findItem(doc, s.id).units[0], T), 20);
  const u2 = M.openOne(doc, s.id, { date: "2026-03-01" });
  M.pauseUnit(doc, s.id, u2.id, { date: "2026-03-05" });
  assert.equal(M.itemState(doc, M.findItem(doc, s.id), T).status, "paused");
  assert.equal(M.reminders(doc, T).length, 0);
});

test("paused backup turns a low reminder into Switch", () => {
  const doc = M.emptyDoc();
  const t = M.addItem(doc, { category: "Skincare", type: "Serum", brand: "BrandT", product: "S", size: 50, guessDays: 50 });
  M.openOne(doc, t.id, { date: "2026-08-25" });
  const g = M.addItem(doc, { category: "Skincare", type: "Serum", brand: "BrandG", product: "S", size: 80 });
  const gu = M.openOne(doc, g.id, { date: "2026-01-02" });
  M.pauseUnit(doc, g.id, gu.id, { date: "2026-03-01", backupFor: t.id });
  assert.equal(M.itemState(doc, M.findItem(doc, t.id), T).status, "switch");
});

test("groceries remind at 30% left", () => {
  const doc = M.emptyDoc();
  const o = M.addItem(doc, { category: "Groceries", type: "Oats", brand: "BrandW", product: "Oats", size: 500 });
  M.openOne(doc, o.id, { date: "2025-11-06" });
  M.finishOne(doc, o.id, { date: "2025-12-04" }); // 28 days
  M.openOne(doc, o.id, { date: "2026-10-01" });
  assert.equal(M.itemState(doc, M.findItem(doc, o.id), "2026-10-15").status, "ok");   // 50% left
  assert.equal(M.itemState(doc, M.findItem(doc, o.id), "2026-10-21").status, "low");  // ~29% left
});

test("should-be-empty asks Check; Still going snoozes it", () => {
  const { doc, brandS } = shampooDoc();
  const st = M.itemState(doc, M.findItem(doc, brandS.id), "2027-01-01");
  assert.equal(st.status, "check");
  M.snoozeCheck(doc, brandS.id, st.checkUnit.id, { days: 14, today: "2027-01-01" });
  assert.notEqual(M.itemState(doc, M.findItem(doc, brandS.id), "2027-01-05").status, "check");
  assert.equal(M.itemState(doc, M.findItem(doc, brandS.id), "2027-01-20").status, "check");
});

test("brands are listed most recently used first", () => {
  const doc = M.emptyDoc();
  const a = M.addItem(doc, { category: "Skincare", type: "Face cream", brand: "Old", product: "C" });
  M.openOne(doc, a.id, { date: "2025-01-01" }); M.finishOne(doc, a.id, { date: "2025-03-01" });
  const b = M.addItem(doc, { category: "Skincare", type: "Face cream", brand: "Newer", product: "C" });
  M.openOne(doc, b.id, { date: "2026-02-01" }); M.finishOne(doc, b.id, { date: "2026-05-01" });
  const c = M.addItem(doc, { category: "Skincare", type: "Face cream", brand: "Using", product: "C" });
  M.openOne(doc, c.id, { date: "2024-01-01" });
  assert.deepEqual(M.brandsFor(doc, "Face cream").recent.map((x) => x.brand), ["Using", "Newer", "Old"]);
});

test("HKD converts at 5.3 and yearly spend adds up the calendar year", () => {
  const doc = M.emptyDoc();
  const a = M.addItem(doc, { category: "Skincare", type: "Face cream", brand: "L", product: "C", size: 50 });
  M.recordPurchase(doc, a.id, { price: 280, currency: "HKD", size: 50, date: "2026-10-09" });
  M.recordPurchase(doc, a.id, { price: 10, currency: "AUD", qty: 2, date: "2026-03-01" });
  M.recordPurchase(doc, a.id, { price: 99, currency: "AUD", date: "2025-12-31" });
  assert.equal(M.round(M.spentInYear(doc, 2026).total, 2), M.round(280 / 5.3 + 20, 2));
});

test("merge keeps both phones' bottles and the newer item fields", () => {
  const base = M.emptyDoc();
  const it = M.addItem(base, { category: "Daily Essentials", type: "Contact lens solution", brand: "BrandR", product: "BrandR", size: 355 });
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  M.openOne(a, it.id, { date: "2026-10-01" });
  M.recordPurchase(b, it.id, { price: 7.33, size: 355 });
  b.items[0].updatedAt = a.items[0].updatedAt + 5; // b edited the item last
  const m = mergeDocs(a, b);
  assert.equal(m.items[0].units.length, 1);   // a's opened bottle survives b's newer edit
  assert.equal(m.items[0].spares, 1);         // b's purchase wins the item fields
  assert.equal(m.purchases.length, 1);
});

test("imports the cleaned spreadsheet and gets the plan's numbers", async () => {
  const fs = await import("node:fs");
  const path = process.env.SOH_CSV;
  if (!path || !fs.existsSync(path)) return; // private data: only run when the file is provided
  const doc = M.emptyDoc();
  const r = importRows(doc, parseCSV(fs.readFileSync(path, "utf8")));
  assert.equal(r.added, 23);
  assert.equal(M.round(M.typeRate(doc, "Contact lens solution").perDay, 1), 6.7);
  assert.equal(M.round(M.typeRate(doc, "Face cream").perDay, 1), 1.5);
  assert.equal(importRows(doc, parseCSV(fs.readFileSync(path, "utf8"))).added, 0);
  const past = doc.items.filter((i) => i.archived).map((i) => i.product);
  assert.ok(past.includes("Skin barrier serum"));
});

test("shopping list: free text, linked products, no duplicates, suggestions", () => {
  const doc = M.emptyDoc();
  const oats = M.addItem(doc, { category: "Groceries", type: "Oats", brand: "BrandW", product: "Oats", size: 500 });
  M.openOne(doc, oats.id, { date: "2025-11-06" });
  M.finishOne(doc, oats.id, { date: "2025-12-04" });                 // now Out
  assert.equal(M.listSuggestions(doc, T).length, 1);
  M.addToList(doc, { text: "薏米" });
  M.addToList(doc, { text: "Electric toothbrush head" });
  M.addToList(doc, { text: "BrandW · Oats" });                        // typed name links to the product
  M.addToList(doc, { itemId: oats.id });                              // no duplicate
  const { toBuy } = M.shoppingList(doc);
  assert.deepEqual(toBuy.map((e) => e.text), ["薏米", "Electric toothbrush head", "BrandW · Oats"]);
  assert.equal(toBuy[2].itemId, oats.id);
  assert.equal(M.listSuggestions(doc, T).length, 0);                  // already on the list
  M.setListDone(doc, toBuy[0].id, true);
  assert.equal(M.shoppingList(doc).done.length, 1);
  M.clearDone(doc);
  assert.equal(M.shoppingList(doc).done.length, 0);
});

test("merge keeps shopping entries added on both phones", () => {
  const a = M.emptyDoc(), b = M.emptyDoc();
  M.addToList(a, { text: "薏米" });
  M.addToList(b, { text: "Toothbrush head" });
  assert.equal(mergeDocs(a, b).shopping.length, 2);
});

test("categories: new built-ins, Pantry uses % left, custom categories", () => {
  const doc = M.emptyDoc();
  for (const c of ["Home Essentials", "Health & Supplements", "Pantry"]) assert.ok(M.categories(doc).includes(c));
  assert.ok(M.addItem(doc, { category: "Pantry", type: "Rice", brand: "", product: "Rice" }).pctLeft);
  assert.ok(!M.addItem(doc, { category: "Home Essentials", type: "Bin bags", brand: "", product: "Bin bags" }).pctLeft);
  assert.equal(M.addCategory(doc, "  Pet  "), "Pet");
  assert.equal(M.addCategory(doc, "pet"), "Pet");          // no duplicates
  assert.ok(M.categories(doc).includes("Pet"));
  assert.ok(M.addItem(doc, { category: "Pet", type: "Food", brand: "", product: "Food" }).consumable);
});
