// Calendar days are the user's local days, never UTC (same rule as TCM Tracker:
// toISOString() files a morning log under yesterday east of Greenwich).

export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const todayStr = () => localDateStr(new Date());

export function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDate(s, delta) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + Math.round(delta));
  return localDateStr(d);
}

// Whole days from a to b (b later → positive).
export function daysBetween(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000);
}

export function shortDate(s) {
  if (!s) return "";
  const d = parseDateStr(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function monthYear(s) {
  return parseDateStr(s).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}
