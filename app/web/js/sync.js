// Sync between this phone (IndexedDB, always saved first) and the private
// GitHub data repo — the same repo, token and user ID as TCM Tracker.
// The stock list is one file next to the TCM files:
//   user-data/<user id>/soh.json
// TCM Tracker only reads its own day files, cycle.json and cabinet.json, so
// the two apps share a folder without touching each other's data.
//
// Rules (copied from TCM Tracker, they've proven themselves there):
// - Download on open and whenever the app comes back on screen.
// - Every upload carries the file's sha. If the other phone saved in between,
//   GitHub refuses (409/422) instead of overwriting; we download, merge
//   (merge.js) and upload again. Never replace this with a blind overwrite.
// - The token lives in sessionStorage only and is never written to disk.

import { getMeta, setMeta, deleteMeta } from "./db.js";
import { mergeDocs } from "./merge.js";
import { emptyDoc } from "./model.js";

const PERSISTED_KEYS = ["gh_owner", "gh_repo", "gh_branch", "gh_path_prefix"];
const DEFAULTS = {
  gh_owner: "charlotte-wtl",
  gh_repo: "personal_tcm_daily_log",
  gh_branch: "main",
  gh_path_prefix: "user-data/",
};
const TOKEN_KEY = "soh_gh_token";
const FILE = "soh.json";
const RECORD = "soh";

/* ---------------- Status ---------------- */

let statusListener = () => {};
let lastState = "";
export function setStatusListener(fn) { statusListener = fn || (() => {}); }
function status(state, detail) { lastState = state; statusListener(state, detail); }

/* ---------------- Config ---------------- */

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}
export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* private mode: nothing persisted, which is the point */ }
}

export async function getConfig() {
  const values = await Promise.all(PERSISTED_KEYS.map((k) => getMeta(k)));
  const cfg = {};
  PERSISTED_KEYS.forEach((k, i) => { cfg[k] = values[i] || DEFAULTS[k]; });
  cfg.gh_token = getToken();
  return cfg;
}

export async function setConfig(partial) {
  if ("gh_token" in partial) setToken(partial.gh_token);
  await Promise.all(PERSISTED_KEYS.filter((k) => k in partial).map((k) => setMeta(k, partial[k] || DEFAULTS[k])));
}

export const getUserId = () => getMeta("user_id");

export async function configState() {
  const cfg = await getConfig();
  if (!cfg.gh_owner || !cfg.gh_repo) return "not-configured";
  if (!(await getUserId())) return "no-user-id";
  if (!cfg.gh_token) return "needs-token";
  return "ready";
}

/* ---------------- Local record ---------------- */

// { doc, updatedAt, syncedAt, remoteSha, remoteUserId }
export async function getRecord() {
  const rec = await getMeta(RECORD);
  return rec || { doc: emptyDoc(), updatedAt: 0, syncedAt: 0 };
}
export const putRecord = (rec) => setMeta(RECORD, rec);
export const isDirty = (rec) => (rec.updatedAt || 0) > (rec.syncedAt || 0);

function announce() { window.dispatchEvent(new CustomEvent("soh:data-changed")); }

/* ---------------- GitHub API ---------------- */

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
function networkError(e) {
  return e && /Failed to fetch|NetworkError|Load failed/i.test(String(e.message || e)) ? "offline" : String(e.message || e);
}

function gh(cfg, path, options = {}) {
  return fetch(`https://api.github.com/repos/${cfg.gh_owner}/${cfg.gh_repo}/${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      Authorization: `Bearer ${cfg.gh_token}`,
      Accept: "application/vnd.github+json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

const prefixDir = (cfg) => cfg.gh_path_prefix.replace(/\/+$/, "");
const userPath = (cfg, userId, name) => `${prefixDir(cfg)}/${userId}/${name}`;

export async function testConnection(cfg) {
  try {
    const res = await fetch(`https://api.github.com/repos/${cfg.gh_owner}/${cfg.gh_repo}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${cfg.gh_token}`, Accept: "application/vnd.github+json" },
    });
    if (res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, error: "bad-token" };
    if (res.status === 404 || res.status === 403) return { ok: false, error: "repo-not-found-or-no-access" };
    return { ok: false, error: `github-${res.status}` };
  } catch (e) {
    return { ok: false, error: networkError(e) };
  }
}

// True if user-data/<id>/ exists — e.g. the folder TCM Tracker already made.
export async function userFolderExists(cfg, userId) {
  const res = await gh(cfg, `contents/${prefixDir(cfg)}?ref=${encodeURIComponent(cfg.gh_branch)}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`github-${res.status}`);
  return (await res.json()).some((f) => f.type === "dir" && f.name === userId);
}

async function readFile(cfg, path) {
  const res = await gh(cfg, `contents/${path}?ref=${encodeURIComponent(cfg.gh_branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github-${res.status}`);
  const body = await res.json();
  return { sha: body.sha, data: JSON.parse(base64ToUtf8(body.content)) };
}

async function writeFile(cfg, path, data, sha, message) {
  const res = await gh(cfg, `contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: utf8ToBase64(JSON.stringify(data, null, 2)),
      branch: cfg.gh_branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 200 || res.status === 201) return { ok: true, sha: (await res.json()).content.sha };
  if (res.status === 409 || res.status === 422) return { ok: false, conflict: true };
  const body = await res.json().catch(() => ({}));
  return { ok: false, error: body.message || `github-${res.status}` };
}

/* ---------------- Pull / push ---------------- */

function remoteShape(doc, userId) {
  return { userId, app: "home-soh", version: 1, items: doc.items, purchases: doc.purchases, settings: doc.settings };
}

async function applyRemote(sha, data, userId) {
  const local = await getRecord();
  if (sha && local.remoteSha === sha && local.remoteUserId === userId) return false;
  const remoteDoc = { items: data.items || [], purchases: data.purchases || [], settings: data.settings || {} };
  const stamp = Date.now();
  if (!isDirty(local)) {
    await putRecord({ doc: { ...emptyDoc(), ...remoteDoc, settings: { ...emptyDoc().settings, ...remoteDoc.settings } }, updatedAt: stamp, syncedAt: stamp, remoteSha: sha, remoteUserId: userId });
  } else {
    const merged = mergeDocs(local.doc, remoteDoc);
    await putRecord({ ...local, doc: merged, remoteSha: sha, remoteUserId: userId, updatedAt: Math.max(stamp, (local.syncedAt || 0) + 1) });
    status("merged");
  }
  announce();
  return true;
}

let queue = Promise.resolve();
export function queuePush() {
  queue = queue.catch(() => {}).then(push);
  return queue;
}

async function push() {
  if ((await configState()) !== "ready") return { ok: false, error: "not-ready" };
  const cfg = await getConfig();
  const userId = await getUserId();
  for (let attempt = 0; attempt < 3; attempt++) {
    const rec = await getRecord();
    if (!isDirty(rec)) { status("synced"); return { ok: true }; }
    status("syncing");
    const sha = rec.remoteUserId === userId ? rec.remoteSha : undefined;
    let result;
    try {
      result = await writeFile(cfg, userPath(cfg, userId, FILE), remoteShape(rec.doc, userId), sha, `${userId}: update stock list`);
    } catch (e) {
      result = { ok: false, error: networkError(e) };
    }
    if (result.ok) {
      const cur = await getRecord();
      await putRecord({ ...cur, remoteSha: result.sha, remoteUserId: userId, syncedAt: rec.updatedAt });
      status(isDirty(cur) ? "syncing" : "synced");
      if (isDirty(cur)) continue;
      return { ok: true };
    }
    if (!result.conflict) { status("error", result.error); return result; }
    // The other phone saved first: take its version, merge, try again.
    try {
      const remote = await readFile(cfg, userPath(cfg, userId, FILE));
      if (remote) await applyRemote(remote.sha, remote.data, userId);
      else await putRecord({ ...(await getRecord()), remoteSha: undefined });
    } catch (e) {
      status("error", networkError(e));
      return { ok: false, error: networkError(e) };
    }
  }
  status("error", "conflict-retries");
  return { ok: false, error: "conflict-retries" };
}

let pullInFlight = null;
export function pull() {
  if (!pullInFlight) pullInFlight = doPull().finally(() => { pullInFlight = null; });
  return pullInFlight;
}

async function doPull() {
  if ((await configState()) !== "ready") return { ok: false, error: await configState() };
  const cfg = await getConfig();
  const userId = await getUserId();
  await queue.catch(() => {});
  status("pulling");
  try {
    const remote = await readFile(cfg, userPath(cfg, userId, FILE));
    if (remote) await applyRemote(remote.sha, remote.data, userId);
    if (isDirty(await getRecord())) return await queuePush();
    status("synced");
    return { ok: true };
  } catch (e) {
    status("error", networkError(e));
    return { ok: false, error: networkError(e) };
  }
}

/* ---------------- Account ---------------- */

// Points this phone at a user id. Switching to a different id clears the
// previous list from this phone (refused if it has unsynced changes).
export async function adoptUserId(id) {
  const current = await getUserId();
  if (current && current !== id) {
    const rec = await getRecord();
    if (isDirty(rec) && (rec.doc.items.length || rec.doc.purchases.length)) return { ok: false, error: "unsynced-other-user" };
    await deleteMeta(RECORD);
  }
  await setMeta("user_id", id);
  return { ok: true };
}

// A brand-new ID: claims the folder by writing an empty soh.json.
export async function createUserFolder(cfg, id) {
  try {
    if (await userFolderExists(cfg, id)) return { ok: false, error: "taken" };
    const res = await writeFile(cfg, userPath(cfg, id, FILE), remoteShape(emptyDoc(), id), undefined, `${id}: new stock list`);
    return res.ok ? { ok: true } : { ok: false, error: res.conflict ? "taken" : res.error };
  } catch (e) {
    return { ok: false, error: networkError(e) };
  }
}

export async function disconnect() {
  setToken("");
}

export { lastState };
