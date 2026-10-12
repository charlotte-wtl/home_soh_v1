# Home stock

A stock-on-hand list for the home: what's in the cabinets, how long each
thing lasts, and when to buy more. Installed to the iPhone Home Screen from
GitHub Pages, like TCM Tracker.

> This repo is public because GitHub Pages serves from it on a free account.
> It holds app code only: no stock data, no names, no credentials, no
> planning notes. The list (and the people's names) live in the private
> `personal_tcm_daily_log` repo at `user-data/<user id>/soh.json`, next to the
> TCM Tracker files, and only load after you connect. Keep it that way.

## Layout

```
app/web/            the app (deployed as-is, no build step)
├── index.html
├── css/style.css   Japandi design system (same family as TCM Tracker)
├── js/
│   ├── app.js      shell: 3 tabs, item page, routing, sync, boot
│   ├── model.js    the maths: usage rate per type, run-out dates, statuses,
│   │               cost, spend. Pure functions, tested in tests/
│   ├── store.js    the one place screens change data (+ Undo)
│   ├── home.js     reminders → filters → in use → paused
│   ├── browse.js   category → type → brand / product
│   ├── item.js     one product: level, buttons, usage, prices, cost
│   ├── more.js     spending, settings, account, import / export
│   ├── forms.js    bottom sheets: Bought, Log / Add, New product, Pause, dates
│   ├── rows.js     how a product reads in a list
│   ├── connect.js  "I have an ID" / "I'm new" (same flow as TCM Tracker)
│   ├── sync.js     GitHub sync: sha-checked uploads, merge on conflict
│   ├── merge.js    merges two phones' edits
│   ├── import.js   one-off import of the cleaned spreadsheet (CSV)
│   ├── ids.js      typo-safe user ids (copied from TCM Tracker)
│   ├── db.js       IndexedDB, the primary store
│   ├── dates.js    local-day date helpers
│   └── ui.js       escaping, sheets, toast, icons
└── sw.js           offline app shell (network-first)
tests/              node --test tests/*.test.mjs
```

## Run locally

```bash
python3 -m http.server 8787 --directory app/web
```

Open http://localhost:8787. ES modules need a real HTTP server.

## Test

```bash
node --test tests/*.test.mjs
```

The spreadsheet import test only runs when `SOH_CSV` points at the cleaned
CSV, which is kept out of this repo.

## Deploy

Any push to `main` publishes `app/web/` via `.github/workflows/pages.yml`.
On a free GitHub account, Pages needs the repo to be public.

## Things that are deliberate (same lessons as TCM Tracker)

**Saving.** IndexedDB is written first on every change; GitHub sync is layered
on top and is never a precondition for a save.

**Syncing.** Every upload sends the file's sha, so a phone with an old copy
gets 409/422 instead of overwriting. It then downloads, merges (items by id,
newer edit wins, bottles from both phones kept) and uploads again.

**The token is never persisted.** It lives in `sessionStorage` only. The
login form marks the ID and token as username / password so Apple Passwords
can hold them.

**One user ID for both apps.** Connect with the TCM Tracker ID. The app only
writes `soh.json`; TCM Tracker only reads its own files, so they share the
folder safely.
