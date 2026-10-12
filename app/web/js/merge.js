// Merges two versions of the stock document when two phones saved at once.
// Items and purchases are matched by id and the newer edit wins; open/finished
// bottles inside an item are kept from both sides, so one phone finishing a
// bottle while the other opens one loses neither. Deletions are flags, not removals,
// so a delete on one phone can't be undone by the other phone's old copy.

function byId(list) { return new Map((list || []).map((x) => [x.id, x])); }

function mergeUnits(newer, older) {
  const out = byId(newer.units);
  (older.units || []).forEach((u) => { if (!out.has(u.id)) out.set(u.id, u); });
  return [...out.values()].sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
}

export function mergeDocs(local, remote) {
  const items = byId(remote.items);
  (local.items || []).forEach((l) => {
    const r = items.get(l.id);
    if (!r) { items.set(l.id, l); return; }
    const [newer, older] = (l.updatedAt || 0) >= (r.updatedAt || 0) ? [l, r] : [r, l];
    items.set(l.id, { ...newer, units: mergeUnits(newer, older) });
  });

  const purchases = byId(remote.purchases);
  (local.purchases || []).forEach((l) => {
    const r = purchases.get(l.id);
    if (!r || (l.updatedAt || 0) >= (r.updatedAt || 0)) purchases.set(l.id, l);
  });

  return {
    items: [...items.values()],
    purchases: [...purchases.values()],
    settings: { ...(remote.settings || {}), ...(local.settings || {}) },
  };
}
