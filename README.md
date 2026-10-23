# Raihana Pharmacy ERP · صيدلية ريحانة

Pharmacy management app for phone and computer. It works offline and syncs online when set up.

- Open the app: the GitHub Pages link of this repository (Settings → Pages).
- Install: open the link, then "Add to Home Screen" (iPhone) or "Install app" (Android, Chrome, Edge).
- Cloud sync: run `src/supabase-setup.sql` once in Supabase, then enter the project URL and public (anon) key in the app under Settings. Keys and passwords are typed in the app only, never stored in this repository.
- Cloud update of 23 Oct 2026 (finished sales, expenses, payments, stock changes and journal entries can only be cancelled, never changed or deleted): run `src/supabase-update-2026-10-23.sql` once in Supabase. It changes no data. `tests/sql-lock.sh` checks it in a real Postgres.

This repository holds only the app's code and made-up test data. No pharmacy data is stored here.

## Folders

| Path | What it is |
| --- | --- |
| `src/base.html` | The first app (supplier invoices, payments, returns, reports). `build.py` patches it. |
| `src/erp.js` | ERP modules: stock, selling, pricing, chronic patients, customers, money, staff, settings. |
| `src/shim.js` | Device storage (works offline) and optional Supabase sync, used outside claude.ai. |
| `src/build.py` | Builds `dist/erp-artifact.html` (claude.ai) and `dist/app/` (installable app). |
| `src/sw.js`, `src/supabase-setup.sql` | Offline cache for the installed app, and the cloud database setup. |
| `tests/` | Browser tests. `tests/fixtures/` is a made-up supplier, invoice and payment. |
| `index.html`, `sw.js`, `manifest.webmanifest`, icons | The built app that GitHub Pages serves. Do not edit by hand. |

## Build and test

```sh
npm ci                     # test tools (Playwright, Excel reader)
npx playwright install chromium
npm run site               # build, then copy the app to the repository root
npm test                   # every browser test; fails on any FAIL, page error or audit DEFECT
```

Pillow (`pip install pillow`) is needed for the icons. GitHub Actions runs the same build and tests on every pull request, and checks that the root app matches the source.
