// Small shared UI helpers: escaping, bottom sheets, toast.

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Opens a bottom sheet. build(sheet, close) fills it. Returns close().
export function openSheet(build, { label = "" } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="grab"></div><div class="sheet-body"></div></div>`;
  const body = backdrop.querySelector(".sheet-body");
  const opener = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
  build(body, close);
  const first = body.querySelector("input, select, button");
  if (first) first.focus({ preventScroll: true });
  return close;
}

let toastTimer = null;
// actions: [{ label, run }]
export function toast(message, actions = []) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<span>${esc(message)}</span>${actions.map((a, i) => `<button type="button" data-i="${i}">${esc(a.label)}</button>`).join("")}`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    el.remove();
    actions[Number(b.dataset.i)].run();
  });
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), actions.length ? 7000 : 3500);
}

export const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/></svg>`,
  browse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`,
  shop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8h13l-1.2 11.5H6.7z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></svg>`,
};

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}
