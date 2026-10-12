// How one product reads in a list: name, the level line, and two plain facts.

import * as M from "./model.js";
import { shortDate } from "./dates.js";
import { esc } from "./ui.js";
import { doc } from "./store.js";

export function leftText(st) {
  if (st.status === "learning") return "Learning how long it lasts";
  const f = st.current;
  if (!f) return M.STATUS_LABEL[st.status];
  if (st.item.pctLeft) return `${Math.round(f.pct * 100)}% left`;
  if (f.daysLeft < 0) return `Due ${Math.round(-f.daysLeft)} days ago`;
  const d = Math.round(f.daysLeft);
  return d <= 1 ? "Last day or so" : `~${d} days left`;
}

export function whenText(st) {
  if (st.status === "check") return "Still using it?";
  if (st.status === "switch") return st.backup ? `Switch to ${M.itemName(st.backup)}` : "Switch to your backup";
  if (st.status === "out") return "None left";
  if (st.current && !st.current.overdue) return `Finishes ~${shortDate(st.current.finishDate)}`;
  return "";
}

export function statusTag(status) {
  return `<span class="status ${status}">${M.STATUS_LABEL[status]}</span>`;
}

const owner = (item) => (item.owner ? ` <span class="brand">· ${esc(M.people(doc())[item.owner] || "")}</span>` : "");

// One short reason, shown after a status word (never repeats the word).
function reasonText(st) {
  const f = st.current;
  switch (st.status) {
    case "out": return "None left";
    case "check": return f ? `Should have run out ~${Math.round(-f.daysLeft)} days ago` : "Still using it?";
    case "switch": return whenText(st);
    case "low": case "ok": return [leftText(st), whenText(st)].filter(Boolean).join(", ").replace("Finishes", "finishes");
    case "spare": return `${st.spares} unopened`;
    case "learning": return "Learns once one is finished";
    default: return "";
  }
}

// opts.action: html for a button on the right; opts.tag: status word + reason
export function itemRow(st, { action = "", tag = false, level = true } = {}) {
  const item = st.item;
  const showLevel = level && st.current && !st.item.archived;
  return `<li class="row">
    <button type="button" class="row-link" data-item="${item.id}">
      <span class="name">${esc(M.itemName(item))}${owner(item)}</span>
      ${showLevel ? `<span class="level" data-status="${st.status}" aria-hidden="true"><i style="width:${Math.round(st.current.pct * 100)}%"></i></span>` : ""}
      ${tag ? `<span class="meta"><span>${statusTag(st.status)} ${esc(reasonText(st))}</span></span>`
        : `<span class="meta"><span>${esc(leftText(st))}</span><span>${esc(whenText(st))}</span></span>`}
    </button>
    ${action}
  </li>`;
}
