// App shell: three tabs (Home, Browse, More), the item page, sync and boot.

import { load } from "./store.js";
import { ICONS, esc } from "./ui.js";
import { mountHome } from "./home.js";
import { mountBrowse } from "./browse.js";
import { mountItem } from "./item.js";
import { mountMore } from "./more.js";
import { mountShop } from "./shop.js";
import { openConnect, offlineThisSession } from "./connect.js";
import { configState, pull, setStatusListener, disconnect } from "./sync.js";

const app = document.getElementById("app");
app.innerHTML = `
  <main>
    <section class="screen" id="s-home" aria-label="Home"></section>
    <section class="screen" id="s-browse" aria-label="Browse" hidden></section>
    <section class="screen" id="s-item" aria-label="Product" hidden></section>
    <section class="screen" id="s-shop" aria-label="Shopping list" hidden></section>
    <section class="screen" id="s-more" aria-label="More" hidden></section>
  </main>
  <nav class="nav" aria-label="Main"><div class="nav-inner">
    <button type="button" data-tab="home">${ICONS.home}<span>Home</span></button>
    <button type="button" data-tab="browse">${ICONS.browse}<span>Browse</span></button>
    <button type="button" data-tab="shop">${ICONS.shop}<span>Shop</span></button>
    <button type="button" data-tab="more">${ICONS.more}<span>More</span></button>
  </div></nav>`;

const el = (id) => document.getElementById(id);
let tab = "home";
let fromTab = "home";

/* ---------------- Sync status line ---------------- */

const SYNC_TEXT = {
  ready: "Connected", synced: "Saved and synced", syncing: "Syncing…", pulling: "Updating…",
  merged: "Merged changes from the other phone", error: "Saved on this phone. Sync failed, will retry",
  offline: "Saved on this phone. Offline", "needs-token": "Saved on this phone. Connect to sync",
  "no-user-id": "Saved on this phone. Not connected", "not-configured": "Saved on this phone. Not connected",
};
let syncState = "not-configured";
const syncText = () => `<span class="dot" data-state="${syncState}" aria-hidden="true"></span>${esc(SYNC_TEXT[syncState] || SYNC_TEXT.ready)}`;
function setSync(state) {
  syncState = state;
  home.setSync(syncText());
}

/* ---------------- Screens ---------------- */

const openItem = (id) => { fromTab = tab === "item" ? fromTab : tab; show("item", id); };
const home = mountHome(el("s-home"), { onOpenItem: openItem, onImport: () => show("more"), syncText });
const browse = mountBrowse(el("s-browse"), { onOpenItem: openItem });
const item = mountItem(el("s-item"), { onBack: () => history.length > 1 ? history.back() : show(fromTab) });
const shop = mountShop(el("s-shop"), { onOpenItem: openItem });
const more = mountMore(el("s-more"), {
  onConnect: () => connectAndSync({ allowOffline: false }),
  onDisconnect: async () => { await disconnect(); setSync(await configState()); more.render(); },
});

function render() {
  if (tab === "home") home.render();
  if (tab === "browse") browse.render();
  if (tab === "item") item.render();
  if (tab === "shop") shop.render();
  if (tab === "more") more.render();
}

function show(next, id = null, { push = true } = {}) {
  tab = next;
  ["home", "browse", "item", "shop", "more"].forEach((k) => { el(`s-${k}`).hidden = k !== next; });
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const on = b.dataset.tab === (next === "item" ? fromTab : next);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (next === "item") item.show(id);
  else render();
  const hash = next === "item" ? `#/item/${id}` : `#/${next}`;
  if (push && location.hash !== hash) history.pushState(null, "", hash);
  window.scrollTo(0, 0);
}

function fromHash() {
  const [, name, id] = (location.hash || "#/home").split("/");
  if (name === "item" && id) show("item", id, { push: false });
  else show(["home", "browse", "shop", "more"].includes(name) ? name : "home", null, { push: false });
}

document.querySelector(".nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) show(b.dataset.tab);
});
window.addEventListener("popstate", fromHash);

// Local edits and downloads from the other phone both land here.
window.addEventListener("soh:data-changed", async (e) => {
  if (!e.detail?.local) await load();
  // Don't redraw under someone typing in a search box.
  if (document.activeElement?.matches?.(".search")) return;
  render();
});

/* ---------------- Sync ---------------- */

setStatusListener((state, detail) => setSync(state === "error" && detail === "offline" ? "offline" : state));

let lastPull = 0;
async function sync({ force = true } = {}) {
  if (!force && Date.now() - lastPull < 20000) return;
  const state = await configState();
  if (state !== "ready") { setSync(state); return; }
  lastPull = Date.now();
  await pull();
}

async function connectAndSync(options) {
  const connected = await openConnect(options);
  setSync(await configState());
  if (connected) await sync();
  render();
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync({ force: false }); });
window.addEventListener("online", () => sync());

/* ---------------- Boot ---------------- */

(async () => {
  await load();
  fromHash();
  const state = await configState();
  setSync(state);
  if (state === "ready") sync();
  else if (!offlineThisSession()) connectAndSync({ allowOffline: true });
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
