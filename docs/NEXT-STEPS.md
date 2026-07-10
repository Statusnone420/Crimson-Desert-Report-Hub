# State of Play & Next Steps

Owner note-to-self. Last updated **2026-07-10** after merging PR #25. Read this first when returning to the project cold.

## Where things stand right now

- **PR #25 merged to main** (merge commit `ad07754`): the OpenRouter cost-safety circuit no longer mutes the whole month on a single transport blip. One unverified-cost response charges its worst-case ceiling and keeps going; the circuit opens only for 3+ blips in a rolling 24 hours (self-heals) or a real money anomaly (month latch). Circuit logic lives in one place — `src/lib/automation/circuit.ts` — used by both the scan engine and the scanner-page badge, so the display can never lie about what the scanner does.
- **The July 10 incident is self-healed by this deploy.** A single dropped request at 02:00 UTC had muted LLM extraction all day; the first scan after deploy re-reads history and closes the circuit. Verify: OpenRouter Activity page should show DeepSeek V4 Flash calls again, and the scanner card should read green "Connected".
- **Also shipped in PR #25:** honest amber "Paused" badge, `/issues` h1, all prose capped at 65ch (`max-w-prose`), stronger focus ring, screen-reader labels on confirm chips, taller touch targets on coarse pointers, refreshed Playwright visual baselines.
- **Quality snapshot:** impeccable audit scored the site **19/20**; 541 unit tests; Playwright visual suite green.
- **Review setup:** Codex (paid, auto-reviews every PR) caught three real bugs on PR #25 — the layer works. It reads a "Review guidelines" section in `AGENTS.md` if one exists; **none exists yet** (see backlog).

## Backlog, ranked by leverage per unit of energy

- [ ] **Push alert when the circuit opens or a scan fails** (small, ~20 lines). Free Discord webhook fired from the scan finalizer when skips include `openrouter_circuit_open` / a money anomaly / status `failed`. Turns "notice it a day later on a dashboard" into "phone buzzes within the hour".
- [ ] **Add a "Review guidelines" section to `AGENTS.md`** (10 min). Codex applies it to every PR review. Encode the house rules: truthful copy over marketing language; never invent counts; every error path states whether it fails open or closed; derived state has exactly one source function; prose capped at readable measure.
- [ ] **PR definition-of-done checklist** (tiny). PR template: tests green · preview walked with production data · admin + public surfaces eyeballed · desktop AND mobile. The "live data" rule caught three defects on PR #25 alone.
- [ ] **Fire-drill the money-anomaly latch** (small). The month latch for `openrouter_unexpected_charge` / `budget_exceeded` has never fired in production. Seed a fake anomaly row on a Supabase preview branch and confirm the circuit opens and the badge shows Paused.
- [ ] **Reddit Responsible Builder application** (slow burn, biggest data ceiling). Tavily-as-Reddit-proxy works but is thin. One evening to file; approval would be the largest evidence-quality jump available.
- [ ] **Align the key limit note** (trivial). The OpenRouter key is hard-limited at **$1/month** provider-side; OPERATIONS.md prescribes "$2 or lower", so it is compliant — just remember $1 is the real backstop when reasoning about budgets.

## How to check the scanner is healthy (60 seconds)

1. Open `/scanner` while signed in: operator readout should have no `openrouter_circuit_open`, scan history should show hourly runs.
2. Public scanner card "AI extraction (OpenRouter)" should be green "Connected"; amber "Paused" means the circuit is open — see the Maintainer Runbook section "If AI extraction shows Paused" before touching anything.
3. OpenRouter dashboard → Activity: DeepSeek V4 Flash requests appearing over the day, $0.00–pennies spend.
