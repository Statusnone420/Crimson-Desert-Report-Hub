# Surface notes (specify only)

Slice A constraints for later visual work. **No mockups, HTML concepts, or screenshots in this slice.**

Operate mode: understand the situation, then finish tasks. Two speeds — **quick check** (Overview) and **focused session** (one workbench). Desktop today feels like a test: oversized intros, repeated scope paragraphs, and collapsed ledgers hiding the only work. Light-mode readability is required (light is the default edition). Public newspaper is the quality bar for type, contrast, and honesty — not a template for article-length spacing on operator pages.

Keyboard: every control already in the inventory must remain reachable without a pointer (existing 44px / focus-ring / `aria-current` rules in `DESIGN.md`). Failed saves and unavailable states are text, not color-only.

Themes: operator amber edition, both palettes. Do not ship a claim-review or attention change that is unreadable on paper `#f6f4ee`.

Cadence/budget/model/circuit UI may remain visible on Scanner; this overhaul must not change their saved operating baseline (2h / 3 searches per run).

---

## Overview (`/operator`)

- Quick check: two named lists — **owner decisions** and **operational incidents** — each item identifiable, each with a next-step link. Inventory (awaiting, yield, weekly composition) does not belong here.
- Quiet copy (“Running quietly.”) only when both lists are known empty. Unavailable reads use `—` / “Status unavailable.”, never a green zero.
- Keep inspect-only. No moderation, scan, or policy forms.
- Run strip: Completed vs Completed with limits vs Failed; never imply healthy AI from Completed.
- Correlate AI unavailable + OpenRouter paused into **one** AI item when they are co-symptoms (`metrics-attention-contract.md`).
- Soft “9:00 am” aside must not claim live ChatGPT task status (the connector is 10 AM `owner_attention_brief`).
- Add Videos to the tool links (nav already has it).
- Preserve `safeRunSummary` (no raw `errors[]`). Preserve `#95` diagnostics as private run facts, not Overview chrome.

## Report review (`/admin`)

- Primary work: flagged reports **and** claim pairings, visible without opening a collapsed ledger.
- Claim cards follow `claim-review-contract.md` (exact claim text, source, patch, issue context, Confirm / Not the same issue / Decide later). Lock moves to exceptional/break-glass, not the first button on a keyword flag.
- Needs you = named parts (N flagged reports · M pairings). Locks and visibility overrides are records, not that number.
- Failed save: keep the pairing/report on screen with the error. Do not empty the queue on a thrown excerpt insert without saying approval already committed (today’s Approve/excerpt split — don’t hide it).
- Public site unchanged: no raw report text off this console.

## Videos (`/admin/videos`)

- Keep the dedicated inbox. Preserve PR #94: manual YouTube add; Approve = private later-PR draft only; Archive/Restore vs 10 AM brief; stale revision; identity change re-pends; missing schema = unavailable not empty.
- Do not auto-publish Watch, crawl YouTube, or merge this queue into Needs you without keeping video counts separately named.
- Light-mode form labels stay attached; don’t restyle into a public article column.

## Scanner (`/scanner` authenticated)

- Focused session: Teach / Records / Lanes / Lessons / History stay on this page (no new route). `/admin/source-monitor` remains a redirect.
- Status line: run ACTIVE/PAUSED/CAPPED is not AI health. AI UNAVAILABLE/LIMITED may override the label; still show last scan outcome separately.
- Relabel for honesty (copy, not new metrics): **Awaiting** = private leads lacking corroboration (not an approval queue); **candidates reviewed** = screening events; **radar yield** = retained-lead share, not accuracy. Time windows named (24h vs rolling 7d vs ISO week still-tracked).
- Optional teaching candidates stay optional. Do not promote them into owner decisions.
- Policy disclosure: do not present Hourly or 1 search/run as a recommended change in this overhaul. Operating baseline remains 2h / 3 searches.
- Collection health stays on this desk. Tavily vs OpenRouter vs operator pause stay distinct except for the AI+circuit correlation rule.
- `#95` diagnostics: maintainer-only, bounded, no bodies/keys/URLs.

## Anonymous `/scanner` and `/observatory`

- **Must keep public Observatory behavior.** `isAdmin()` false renders `ObservatoryPage`; no login bounce.
- Public aggregates only. No teach desk, no rejected candidates, no video inbox, no claim-review, no export.
- Unknown vs zero rules already on Observatory remain.

## Dossiers (`/admin/compile`)

- On demand. Not a daily task. Not scanner AI health.
- Deterministic compile always available; AI prose opt-in and fail-open to deterministic.
- Missing `?run=` id should read as missing, not as “no runs yet.”
- Opt-in AI still sends private titles/repro/evidence URLs — keep that warning in copy; don’t add a silent second sender.

## Shared shell

- Keep two registers: destinations left (Overview, Report review, Videos, Scanner monitor, Dossiers), utilities right (Export CSV confirm, Sign out).
- Amber operator chrome only when signed in; login stays `PublicShell`.
- Preview notice stays visible when writes are disabled.
- Keyboard: Export confirm Escape + focus return already specified in `OperatorNav` — don’t regress.
- Footer: operator surfaces never linked publicly; 12-hour session.
- Light and dark both required; oversized page intros should shrink so the first task is in the first viewport on a 1440 desktop, without copying newspaper hero spacing.
