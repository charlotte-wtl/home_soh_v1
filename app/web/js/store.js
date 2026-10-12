// The one place screens change data. Every change: copy the document, apply
// the edit, save to IndexedDB (within the same tick), then queue the upload.
// The copy taken before the edit is what Undo puts back.

import { getRecord, putRecord, queuePush } from "./sync.js";
import { getMeta, setMeta } from "./db.js";

let current = null;
let undoStack = [];

export async function load() {
  current = (await getRecord()).doc;
  current.shopping = current.shopping || [];
  current.settings = { hkdRate: 5.3, warnDays: 14, pctLeft: 0.3, currency: "AUD", ...(current.settings || {}) };
  return current;
}

export const doc = () => current;

const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

// fn(draft) edits the draft in place and may return a value.
export async function change(fn) {
  const before = clone(current);
  const draft = clone(current);
  const result = fn(draft);
  current = draft;
  undoStack.push(before);
  if (undoStack.length > 20) undoStack.shift();
  await persist();
  return result;
}

export async function undo() {
  const prev = undoStack.pop();
  if (!prev) return false;
  current = prev;
  await persist();
  return true;
}

async function persist() {
  const rec = await getRecord();
  await putRecord({ ...rec, doc: current, updatedAt: Date.now() });
  window.dispatchEvent(new CustomEvent("soh:data-changed", { detail: { local: true } }));
  queuePush();
}

// Who is using this phone. Stored on the phone only, never synced.
export const getMe = async () => (await getMeta("me")) || "p1";
export const setMe = (who) => setMeta("me", who);
