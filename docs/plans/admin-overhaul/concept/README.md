# Operator concept (Slice A)

Static HTML/CSS/JS for two authenticated desks: **Overview** (`/operator`) and **Report / Claim Review** (`/admin`). This folder is a visual concept only. It does not load the app, call a server, or use production data.

## Open locally

1. Do not start Next.js, Docker, or a static server. A local file is enough.
2. Open `docs/plans/admin-overhaul/concept/index.html` in a desktop browser (Firefox, Chrome, Safari, or Edge).
   - Finder / Explorer: double-click the file.
   - Terminal: `xdg-open docs/plans/admin-overhaul/concept/index.html` (Linux) or `open …` (macOS).
3. Confirm the amber concept rail reads **Concept demo · invented sample · in-memory only · no network**.
4. Use the rail to switch **Theme**, **Surface**, and **Situation**. Decisions (Confirm / Not the same / Approve / Lock) stay in this tab until reload.

No account, API key, or package install is required. The page does not fetch fonts, images, or JSON.

## What you can try

- **Overview:** Do now vs informational. Approved/spam totals and “completed with limits” are inventory/status, not chores.
- **Review:** Queue on the left (desktop) or first (mobile). One item’s full form at a time. Claim match shows the **exact invented patch-note sentence**, source, patch, and issue context. Confirm / Not the same / Decide later. Lifecycle lock is a separate disclosure — it is not the reject control.
- **Mobile:** Queue list → item. Back returns to the queue. Primary actions stick to the bottom.
- **Failed-save:** Situation switcher pre-fills an excerpt and shows a recoverable error; the text remains. Retry in this tab succeeds in memory.
- **Unavailable:** Counts render as an em dash. The desk will not draw a green zero from a failed read.
- **AI-blocked:** Mapping is blocked; search can continue; the claim row is a keyword proposal and still shows the exact notes text.

## Hash URLs (optional)

After load, the hash records the current demo, for example:

`index.html#view=review&scenario=normal&theme=dark&item=claim-horse&pane=detail`

`pane=detail` is the mobile focused-item view. `pane=queue` is the mobile list.

## Screenshots

PNG files in `screenshots/` were captured from this HTML at 1440×1100 and 390×844. They are concept renders of invented sample states, not production admin captures. How they were taken is in `VERIFICATION.md`.

To recapture locally (optional): Chromium/Chrome plus Playwright, then `node capture-screenshots.cjs` from this folder. The page still does not need a server.

## Out of scope

Application routes, shared CSS, Slice B–D, scanner runs, migrations, and production access.
