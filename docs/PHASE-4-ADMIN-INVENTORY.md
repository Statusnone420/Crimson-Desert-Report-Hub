# Phase 4 — Admin control inventory (read-only)

Generated from a 14-agent read-only sweep. **327 controls** across 11 partitions.
No file in the repository was modified to produce this.

A *control* is anything the operator can do or that acts on their behalf: buttons, forms, selects, inputs, links,
disclosures, nav destinations, downloads, server actions, API routes, and automatic behavior that runs on page load.

---

## Reorganization risk register

| # | Control | Category | Consequence for a redesign | Evidence | Severity |
|---|---|---|---|---|---|
| 1 | visibility-reset-to-automatic ("Reset to automatic" + hidden visibility=auto) | load-bearing / break-glass | This is the ONLY control in the app that writes visibility='auto'. The create-override form (VisibilityOverrideBrowser) offers only force_hidden/force_public, and the page hands that browser `autoRows` — clusters WITHOUT an override — so a forced cluster literally cannot be reached from the create path again. Drop or rename this button (or drop its hidden `visibility=auto` input, which makes the action throw "bad input") and any force_hidden/force_public cluster is stuck off or on the public Issue Board permanently, with no in-app exit. Preserving the button is insufficient while readAdminClusters is a single service-capped read: an omitted forced row also loses this sole exit, which is why stable current/legacy pagination is a Phase 4 prerequisite. | src/app/admin/page.tsx:255-261 (form), src/app/admin/page.tsx:46-47 (forcedRows/autoRows split), src/components/admin/VisibilityOverrideBrowser.tsx:70-73 (no auto option), src/app/admin/actions.ts:204-205; src/lib/adminClusters.ts:19-40 | high |
| 2 | lifecycle-clear-submit ("Clear") | load-bearing / conditional state | Sole release of issue_clusters.admin_override. While admin_override is true, the automation lifecycle pass refuses to write fix_status/fix_claimed_at at all — it only rewrites lifecycle_reason under `.eq("admin_override", true)`. Clear releases the lock, reason, and synthesized claim clock but deliberately leaves the current fix_status until the next lifecycle pass, so it is partial recovery rather than full Undo. A locked cluster whose Clear button disappears is frozen at whatever status the operator last locked, forever. Worse, the button only renders inside a collapsed <details> and only on rows where admin_override is true, so a redesign that reorganizes the exception ledger can drop it without anyone noticing until a lock needs releasing. | src/app/admin/page.tsx:213-220, src/app/admin/actions.ts:234-256, src/lib/automation/run.ts:1356-1365 | high |
| 3 | feedback-rules-undo ("Undo" in Active lessons) | load-bearing / break-glass | Sole revoke path for a scanner_feedback_rules row. A whole-domain BLOCK rule silently suppresses every future lead from that domain (matchScannerFeedbackRule), and nothing expires it unless expires_at was set — which no rendered control sets. The current "Undo" label overstates signal recovery: revocation recomputes a clustered signal but leaves an unclustered quarantined signal hidden, and it never reactivates a superseded same-scope rule. The panel only renders when feedbackLearningAvailable is true, so if the redesign folds it away or ties it to a different gate, a bad domain rule becomes permanent and invisible. Preserve the control, but label its target-dependent effect honestly. | src/components/scanner/ScannerFeedbackDesk.tsx:243-246, src/components/scanner/AdminScannerView.tsx:663-667, src/app/admin/actions.ts:708-727, src/lib/automation/feedback.ts:101-123, supabase/migrations/20260724200000_observation_moderation.sql:157-216 | high |
| 4 | scanner-policy-form (How often / Search depth / Monthly search cap / Monthly LLM cap / Save settings) | coupled / load-bearing | Save settings is a FULL jsonb replace: scannerPolicyFromFormData reads six fields and normalizeScannerPolicy substitutes hard defaults for anything missing. Splitting this one <form> into separate cards/sections — the obvious redesign move — means saving the budget section alone silently sets paused=false and minIntervalMinutes=60, i.e. un-pauses the scanner and triples its cadence. There is also no other UI to pause scanning or cap spend, so losing this form removes all spend control. | src/components/scanner/AdminScannerView.tsx:601-615, src/lib/automation/settings.ts:114-124, src/lib/automation/settings.ts:143-153 | high |
| 5 | scanner-cadence-select + hidden minIntervalMinutes input | coupled | The hidden input is not decorative: when cadence='paused', scannerPolicyFromFormData falls back to formData.get("minIntervalMinutes") for the interval. Drop the hidden field while keeping the visible select and pausing the scanner also resets its stored cadence to the 60-minute default, so resuming later resumes hourly instead of at the operator's chosen interval. The two controls only work as a pair. | src/components/scanner/AdminScannerView.tsx:602,604-607, src/lib/automation/settings.ts:117-118,98-102 | high |
| 6 | set-current-patch-override ("New current patch" + "Set current patch") | break-glass / no-undo / coupled | Codebase calls it break-glass in both the action doc comment and the disclosure copy. It has no clear/undo control: the only way back is a successful Pearl Abyss scrape flipping is_current. It is also coupled far outside /admin — the /scanner Context lanes desk queries patch_observations filtered by the current patch version, and setClusterFixStatus stamps fix_claimed_patch_version from it. Set it wrong and the observation desk empties, taking every per-item Undo card with it. | src/app/admin/actions.ts:258-279, src/app/admin/page.tsx:276-313, src/lib/queries.ts:1245-1251, src/app/admin/actions.ts:176-183 | high |
| 7 | moderate-report Approve / Reject / Spam | no-undo / load-bearing | The queue query selects only moderation_status='pending', so the moment a report is decided it leaves /admin and no rendered control can re-open it, retry a failed excerpt, un-approve it, or delete an approved_excerpts row. The exported action itself has no pending-status guard and can re-decide an already-decided report or append another excerpt, but that is not a safe rendered recovery workflow. These three buttons are the only operator path to bug_reports.moderation_status. A redesign must keep all three plus the excerpt field together without presenting the action's unrestricted re-submit behavior as Undo. | src/app/admin/page.tsx:29-34,155-163, src/app/admin/actions.ts:111-144 | high |
| 8 | moderate-report cluster select ↔ Reject / Spam buttons | coupled / label mismatch | The update writes `cluster_id: clusterId \|\| null` on EVERY decision, not just Approve. Rejecting or spamming a report silently rewrites (or, if the operator never touched the dropdown on a report whose cluster is unset, clears) its cluster assignment. A redesign that moves the cluster picker away from the reject/spam buttons, or that renders reject/spam without the select in the same form, changes what those buttons write. | src/app/admin/page.tsx:141-148,158-163, src/app/admin/actions.ts:135 | high |
| 9 | lifecycle-lock-status-select (Open / Fix claimed / Marked fixed / Still happening) | dead / coupled | Two traps. (1) FIX_STATUSES accepts 'acknowledged' server-side but the menu deliberately omits it (comment: "acknowledged is a dead state") — a redesign that renders options from FIX_STATUSES resurrects a status no rule produces. (2) The select uses defaultValue={cluster.fix_status}; for a legacy 'acknowledged' row no option matches, so the browser preselects the FIRST option (Open) and pressing Lock silently rewrites the status to 'reported' plus sets admin_override=true. Reordering the option list changes what that mis-click writes. | src/app/admin/page.tsx:21-22,202-208, src/lib/constants.ts:46-52, src/app/admin/actions.ts:172-187 | high |
| 10 | candidate-keep-as-relevant ("Keep as relevant") vs undo_scanner_decision | no-undo / provider boundary | On a successful Keep, rescueCandidateSignal persists or re-observes a source signal, uses zero search credits and zero or one OpenRouter generation call, and recomputes cluster visibility BEFORE the action records the decision and marks automation_rejected_candidates.rescued_at. The optional generation prompt includes the private candidate title, snippet, and canonicalized source URL plus unpublished cluster slugs/titles; subsequent cost-audit GETs carry only the returned generation ID. The automation route currently requests deny-collection but not ZDR. The undo RPC clears candidate fields only `where rescued_at is null` and never deletes the rescued signal — so Undo on a Keep revokes the allow-rule but leaves the rescued lead and any consumed spend. Persistence sets the signal private before normal evidence and override rules recompute visibility. The lesson itself is never publication permission. Presenting Keep next to reversible controls in a redesign overstates its reversibility. | src/components/scanner/ScannerFeedbackDesk.tsx:79-87, src/app/admin/actions.ts:545-603, src/lib/automation/run.ts:2613-2745, src/lib/automation/extract.ts:128-147,309-358, src/lib/automation/budget.ts:145-183, supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:262-269 | high |
| 11 | candidate-keep-as-relevant vs feedbackLearningAvailable gate | coupled / conditional state | Keep sits OUTSIDE the feedbackLearningAvailable ternary while Reject-and-teach sits inside it. That asymmetry is deliberate degraded-mode behavior — with the learning schema missing you can still rescue a missed lead. A redesign that wraps the whole card's action row in the availability check removes the only usable control in the degraded state, exactly when the operator most needs it. | src/components/scanner/ScannerFeedbackDesk.tsx:78-88 vs :89-139, src/components/scanner/AdminScannerView.tsx:523-526 | medium |
| 12 | operator-nav EXPORT CSV | load-bearing / label mismatch | Styled as a plain <a> inside a nav of <Link> page destinations, visually identical to REPORT REVIEW / SCANNER MONITOR / COMPILE DOSSIER — but it is a one-click, no-confirmation bulk download intended to include every bug_reports row through a fixed 22-column allowlist, including description, repro_steps, hardware_specs, driver_os and pers_id, via the service-role client. It deliberately excludes submitter_ip_hash and duplicate_fingerprint. The current route makes one unpaginated select, so the hosted PostgREST row cap can silently omit older reports. It is also the only export path in the app. A redesign must neither delete it, keep treating it as a nav tab, describe the allowlisted payload as the complete table, nor preserve the false completeness claim without stable pagination. | src/components/dispatch/Chrome.tsx:154-159,186-189, src/app/api/admin/export/route.ts:6-41 | high |
| 13 | scan-dry-run-button + scan-manual-run-button | no-undo / label mismatch | Both can spend real Tavily credits and paid LLM calls against the monthly caps and persist their automation run ledger/progress/intent. A dry run suppresses scanner-content persistence and public content changes, so "Test scan without publishing" is not free or a no-op even though it does not persist lifecycle, signal, observation, or candidate content. Starting either mode also sweeps stale running rows to failed. A manual run writes across source_signals, issue_clusters, automation_rejected_candidates, patch_observations and more with no revert control. They are also the only manual scan trigger. Renaming or moving them is fine; making either easier to hit (e.g. a prominent primary action) increases irreversible spend. | src/components/ScanControls.tsx:140-155, src/app/api/admin/scan/route.ts:11-36, src/lib/automation/run.ts:2366-2522 | high |
| 14 | scan-status-poll (GET /api/admin/scan/status) | coupled / automatic behavior | A read-shaped poll that writes: it calls sweepStaleRuns on EVERY request (marking abandoned runs failed) and calls revalidatePublicSurfaces when a manual run finished under 2 minutes ago. ScanControls seeds runId from the server-rendered activeRunId at mount, so merely LOADING /scanner during a run starts it. Remove the ScanControls widget or its polling in a redesign and stale 'running' rows stop being swept and the public pages stop being refreshed after manual runs. Note it also has no preview-write guard, unlike the POST route. | src/components/ScanControls.tsx:43-46,57-100, src/app/api/admin/scan/status/route.ts:25-50 | high |
| 15 | VisibilityOverrideBrowser (search → per-result Override… → Apply break-glass override) | break-glass / coupled | The codebase's own phrase ("Apply break-glass override", "break-glass action"). It is buried four disclosure levels deep (rule-band <details> → ledger body → nested <details> → per-result <details>), renders nothing until 2+ characters are typed, caps results at 8, and receives only engine-owned clusters. Every one of those is a deliberate friction/coupling decision, and each is the kind of thing a redesign 'simplifies' away — flattening it turns the most dangerous write in the admin area into a browsable list. | src/components/admin/VisibilityOverrideBrowser.tsx:13,18-24,27,55,60,83-85, src/app/admin/page.tsx:227,272 | high |
| 16 | override-confirm checkbox ("I understand this immediately changes the public Issue Board…") | load-bearing / no DB backstop | Unlike the scanner-side confirm_broad — which is enforced in the browser, in the action, AND in the RPC — this acknowledgement exists only as `required` on the input and as `confirmed` in the server action. The RPC validates only the visibility value and the reason. Drop the checkbox in a redesign and the guard silently disappears: force_public/force_hidden becomes a two-field submit with no acknowledgement anywhere in the stack. Nothing persists it either (no confirmed_at analogue on issue_clusters). | src/components/admin/VisibilityOverrideBrowser.tsx:79-82, src/app/admin/actions.ts:203-205, supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:435-440 vs :119-121 | high |
| 17 | observation Undo ("Undo — restore item and revoke rule") ↔ current-patch filter | coupled | The Context lanes desk lists only patch_observations for the CURRENT patch version, and the per-item Undo renders only on cards in that list. A hidden observation from a previous patch has no card, therefore no per-item Undo. Active lessons supplies a rule-level recovery only while that rule remains active, unrevoked, and unexpired; superseding or expiry removes the rule row without undoing the decision, leaving no rendered recovery. So the Current patch override control on a different page determines whether the card-level control exists at all. | src/lib/queries.ts:1201-1206,1245-1251,1265-1273; src/components/scanner/AdminScannerView.tsx:250-261 | high |
| 18 | lifecycle Lock button on non-locked "Needs review:" rows | coupled / label mismatch | The Lock form renders on EVERY exception row, including rows that are there only because lifecycle_reason starts with "Needs review:" and are still engine-owned. Pressing Lock on such a row does not 'confirm the suggestion' — it sets admin_override=true and permanently removes that cluster from engine control until someone presses Clear. The button label gives no hint that it is a one-way transfer of ownership. | src/app/admin/page.tsx:48-50,187-212, src/app/admin/actions.ts:184-185 | medium |
| 19 | stat-needs-you | coupled | needsYou = pending report count + exception rows that are NOT admin_override. It silently aggregates two different sections (Flagged for review and the Lifecycle exceptions disclosure) and deliberately excludes your own locks. Any redesign that recomputes this number from one section, or that changes what lands in exceptionRows, changes the headline number the operator triages by. | src/app/admin/page.tsx:48-52,70-81 | medium |
| 20 | /admin/source-monitor | dead | A bare unconditional redirect() to /scanner with no requireAdmin/isAdmin call, not present in OPERATOR_NAV, and nothing in src/ links to it. Six server actions still make seven calls to revalidatePath("/admin/source-monitor") for a page that renders nothing. Safe to delete, but note an anonymous visitor is bounced to the PUBLIC /scanner view rather than challenged. | src/app/admin/source-monitor/page.tsx:5-7, src/app/admin/actions.ts:442,453,466,540,607,692,726 | low |
| 21 | rescueRejectedCandidate + RejectedArchive "Rescue" button | dead | RejectedArchive.tsx renders a Rescue form but nothing in src/ imports RejectedArchive (verified by repo-wide grep — the only hits are its own file and tests). The action stays exported and POST-able. Separately, its guard ordering is inverted: it throws "bad input" on an empty id BEFORE any auth, inheriting requireAdmin only one level down inside recordScannerDecision — correct today, one refactor from being lost. | src/components/scanner/RejectedArchive.tsx:4,22, src/app/admin/actions.ts:697-706 vs :471-472 | medium |
| 22 | setAutomationPaused (server action) vs cadence='paused' | dead / duplicated | Two implementations of 'pause the scanner'. setAutomationPaused is exported and unit-tested but no component in src/ binds to it; the live path is the cadence select's Paused option routing through setScannerPolicy. A redesign that 'wires up the pause action' would create a second writer of the same automation_settings blob — and setAutomationPaused read-modify-writes the whole policy, so the two can race each other's budget fields. | src/app/admin/actions.ts:446-455, src/lib/automation/settings.ts:155-158, src/components/scanner/AdminScannerView.tsx:604-607 | medium |
| 23 | runRedditMonitor | dead | No caller in src/. Guarded past requireAdmin by an unconditional `if (!features().reddit) throw new Error("reddit monitor permanently disabled")`. Its whole body (source_signals upsert path) is unreachable code that a redesign might mistake for a live capability worth surfacing. | src/app/admin/actions.ts:398-444 | low |
| 24 | signOutAdmin | load-bearing / unguarded | The only session-clearing control, rendered as a nav-styled <button> inside a form in OperatorShell — so it is present on /admin, /admin/compile and /scanner-as-admin but absent from any page that doesn't use OperatorShell. It is also the single exported action in actions.ts with neither requireAdmin() nor assertProductionWriteAllowed(). Effect is limited to clearing the caller's own cookie, but a redesign that moves it out of OperatorShell removes sign-out from every page at once. | src/app/admin/actions.ts:39-43, src/components/dispatch/Chrome.tsx:201-205 | medium |
| 25 | recordScannerDecision expires_at field | dead | The action reads and validates an `expires_at` FormData field and passes it to the RPC as p_expires_at, but no rendered form supplies it — every rule created from the UI is permanent until Undo. Either a redesign surfaces it (a real feature: self-expiring rules) or it stays an untested code path; today it is a capability that exists only in the handler. | src/app/admin/actions.ts:479-480,490,531,589 | low |
| 26 | scanner-policy hidden modelPreset input and the 'paused' form field | dead | Two inert inputs in the settings path. normalizeScannerPolicy collapses modelPreset to the single allowed constant regardless of what is submitted, so the hidden field can never change anything. And scannerPolicyFromFormData's `formData.get("paused")` branch is only reachable for a form that posts `paused` without `cadence` — no rendered form does. Both are safe to drop; both look load-bearing from the markup. | src/components/scanner/AdminScannerView.tsx:603, src/lib/automation/settings.ts:110,117 | low |
| 27 | Footer Admin sign-in popover vs /admin/login page | duplicated | Two complete password-entry surfaces posting to the same POST /api/admin/login. AdminControls suppresses itself with `if (pathname?.startsWith("/admin")) return null` specifically because showing both at once was a bug. Any redesign that changes admin route prefixes, or renders the footer inside an operator page, resurrects the two-competing-forms defect. | src/components/AdminControls.tsx:27-29,51-69, src/app/admin/login/LoginForm.tsx:16-23 | medium |
| 28 | candidate "Reject and teach…" vs signal "Remove bad lead" | duplicated | Two visually different forms in two different sections that both create a block rule through the same recordScannerDecision action. They are NOT interchangeable: the candidate form offers three scopes plus confirm_broad, while the signal form hard-codes scope=exact_url via hidden input and the server rejects any signal decision that is 'relevant', non-exact-scope, or carries confirm_broad. Merging them into one component would either widen the signal path illegally or narrow the candidate path. | src/components/scanner/ScannerFeedbackDesk.tsx:92-135, src/components/scanner/AdminScannerView.tsx:179-209, src/app/admin/actions.ts:488 | medium |
| 29 | observation card Undo vs Active lessons Undo | duplicated | The same undoScannerDecision with the same decision_id is reachable from two places: the per-observation card on the Context lanes desk and the rule row in the Active lessons ledger. They are not redundant — the card version is patch-scoped (disappears when the current patch changes) and the ledger version is rule-scoped (disappears when the rule expires or is already revoked). Consolidating to one loses a recovery path in one of those two states. | src/components/scanner/AdminScannerView.tsx:250-261, src/components/scanner/ScannerFeedbackDesk.tsx:243-246 | medium |
| 30 | teaching-desk search + "Show N more optional candidates" truncation | coupled / ordering matters | The desk shows exactly 2 cards by default, but when a search query is present it renders filtered.length (no cap) and hides the Show-more disclosure entirely. So search does not filter the visible list — it changes the pagination mode. It also filters to undecided candidates only (no rescued_at, no decision_id, no feedback_rule_id), which is why decided items vanish rather than showing a decided state. A redesign that adds a normal 'search + paginate' pattern changes both behaviors. | src/components/scanner/ScannerFeedbackDesk.tsx:10,156-170,191,200-214 | medium |
| 31 | Steam-review lead: teaching form replaced by explanatory text | dead / conditional absence | For any signal whose source or source_type is steam_review the Remove-bad-lead disclosure is not rendered at all, replaced by a sentence — and the action throws the same refusal server-side. This is intentional defense in depth (Steam reviews share one provider URL, so an exact_url rule would block the whole provider). A redesign that normalizes lead cards to always show the same action set would either render a control that always errors or, worse, remove the server refusal to match the UI. | src/components/scanner/AdminScannerView.tsx:169-176, src/app/admin/actions.ts:512-514 | medium |
| 32 | compile use_ai checkbox | coupled / conditional state | The checkbox is disabled and its label text changes based on features().ai, and the server independently re-checks `useAi && features().ai` before calling the AI drafter. The label is the only place the operator learns why AI is unavailable. A redesign that keeps the checkbox but drops the conditional label leaves a silently no-op control; one that drops the server re-check makes the client's disabled attribute the only gate. | src/app/admin/compile/page.tsx:29,60-66, src/app/admin/actions.ts:375-378 | low |
| 33 | compile ?run= parameter and the 10-row Previous runs list | coupled | The output block renders only when ?run= is present; the list shows the newest 10 runs but the query by id accepts any dossier_runs uuid. An older run is therefore fetchable only when the operator already knows or saved its UUID-bearing URL; it is not discoverable after it drops past the newest 10. Compile now redirects into this same parameter. A redesign that switches to client-side tab state or an inline result panel breaks both the redirect target and every bookmarked run link. | src/app/admin/compile/page.tsx:31-41,71-96, src/app/admin/actions.ts:395 | low |

**Risk assessment:**

Verified against source; the inventory's structure holds, with three corrections worth noting. (1) The inventory lists `source_path` as if only exact_url/source_domain matter in places — it is in fact a fully valid scope everywhere (client, action, RPC check, and specificity ranking), so the desk's three-option scope select is live, not partly dead. (2) The inventory's claim that the visibility-override reason/confirm is validated "in three layers" is only half right for the confirm checkbox: the RPC validates the visibility value and the reason but NOT the acknowledgement, unlike scanner-side confirm_broad which the SQL does enforce. (3) `acknowledged` is dead as an option but live as an accepted server value, and the Lock select's defaultValue makes a legacy 'acknowledged' row silently preselect "Open" — a real mis-write path the inventory did not surface.

The reorganization risk concentrates in four places. First, three controls are the sole exit from a sticky state: "Reset to automatic" (only writer of visibility='auto'), "Clear" (only release of admin_override, which otherwise freezes the lifecycle engine out of that cluster forever), and Active-lessons "Undo" (only revoke of a feedback rule). Losing any of them strands data with no in-app recovery. Second, the scanner policy form is a single full-replace jsonb write whose hidden minIntervalMinutes field is load-bearing on the paused branch — splitting that form into sections, the most likely redesign move, silently un-pauses the scanner and resets its cadence. Third, several controls are irreversible from the rendered operator workflow but presented as ordinary: Approve/Reject/Spam remove the report from the pending queue and expose no recovery control even though the status-unrestricted action can be re-posted unsafely; both scan buttons spend real money; Keep-as-relevant's Undo revokes the rule but never removes the rescued signal; and Set current patch has no clear control and silently determines which observations — and therefore which per-item Undo cards — exist on /scanner. Fourth, the break-glass surfaces the codebase names as such (the visibility override browser and the current-patch override) are deliberately buried behind depth and a 2-character search gate; the visibility creator also keeps an 8-result cap and required acknowledgement, while the current-patch override is a version-only form with no acknowledgement. Every one of those distinct frictions is the kind a redesign flattens by default.

Genuinely safe to delete: /admin/source-monitor, runRedditMonitor, the RejectedArchive component and its Rescue button, the hidden modelPreset input, and the unreachable `paused` form-field branch. Genuinely duplicated capability: two password sign-in surfaces, two block-rule teaching forms (not interchangeable — the signal path is deliberately narrower and the server enforces that), two Undo surfaces for the same decision (not redundant — one is patch-scoped, the other rule-scoped), and two pause implementations of which only one is wired.

---

## Capability the partition missed (completeness critic)

| # | What | Where | Why it matters |
|---|---|---|---|
| 1 | Global route error boundary with a "Try again" button — the ONLY failure UI any admin server action ever reaches. Every throw in actions.ts ("bad input", "preview writes disabled", "report not found", "source signal not found", raw Postgres FK errors from the unvalidated cluster select) renders this page. It is a client component that composes its own chrome, so it renders WITHOUT OperatorShell: no operator nav, no EXPORT CSV, no Sign out, and no indication you are still signed in. reset() re-renders the segment; all form state is lost. | src/app/error.tsx:17 | The parity contract asks "what happens when it fails" for every control, and the answer for all 12 guarded actions is this one file — which appears nowhere in the inventory. A redesign that adds src/app/admin/error.tsx, or restyles this page, silently changes the failure behavior of the entire admin surface. It is also the reason a failed action strands the operator outside the console chrome. |
| 2 | Initial sweep language understated signOutAdmin as only clearing a cookie. The action also calls redirect("/admin/login") unconditionally as its final statement. | src/app/admin/actions.ts:42 | Where Sign out lands is a UX contract the redesign will inherit or break. The detailed entries now name both the cookie clear and redirect, and the unit test pins both. |
| 3 | No return-to on re-authentication. requireAdmin() redirects to a bare "/admin/login" with no query parameter capturing the original destination, and every sign-in surface hard-pushes "/admin" on success. An operator whose 12h session expires on /admin/compile or /scanner is always dumped back onto Report review. | src/lib/adminGuard.ts:21 (with src/app/admin/login/LoginForm.tsx:22 and src/components/AdminControls.tsx:68) | This is load-bearing for any nav reorganization: if the redesign adds pages or deep links, none of them survive a session expiry. It also means the /scanner degrade path (isAdmin false renders the PUBLIC view rather than redirecting) and the /admin path behave inconsistently on expiry, with no shared re-auth story. |
| 4 | The "Flagged for review" queue is hard-capped at .limit(50) with no pagination, no "load more", and no "showing 50 of N" indicator — while the "Flagged reports" stat cell directly above it renders the true unbounded pending count. Past 50 pending reports the two numbers silently disagree and reports 51+ are unreachable from the UI. Ordering is created_at ASC (oldest first), which is what makes the cap survivable. | src/app/admin/page.tsx:34 (cap) vs src/app/admin/page.tsx:89 (true count) | The inventory lists the flagged query and the stat cell as separate read-only items and never states the ceiling or the ASC ordering. A redesign that reorders the queue newest-first, or that presents the list as complete, would make the oldest reports permanently unreachable instead of merely deferred. |
| 5 | Operator preview tooling in package.json that is part of the admin workflow and absent from the inventory: `npm run preview:seed` (scripts/generate-preview-seed.mjs — deterministic seed generator with --leads/--reports/--taps/--days/--patch/--seed/--out flags) and `npm run dev:preview` (scripts/preview-dev.mjs — boots the in-memory PostgREST shim on ports 3130/18790 against preview-data/seed.json). The shim injects a fixed ADMIN_PASSWORD="admin-password" and a fixed SESSION_SECRET, so this is a fully signed-in local operator console. | package.json:14-15; scripts/preview-dev.mjs:11-24; tests/e2e/mock-dev-server.mjs:1056-1057 | This is the harness the reorganization will actually be designed and reviewed in. It is admin capability (a working console with a known password) and it is the only non-production way to see the operator surface at all. |
| 6 | Post-inventory update: the preview/e2e harness now implements all seven Supabase RPCs used by these surfaces — record_issue_confirmation, apply_cluster_visibility_refresh, record_scanner_decision, record_observation_decision, undo_scanner_decision, set_cluster_visibility_override, and set_current_patch_override — plus the Keep-as-relevant run-ledger/signal/candidate write chain. The operator-write E2E submits candidate and observation decisions, both Undo shapes, Keep, visibility force/reset, and current-patch override through real server actions. The remaining harness gaps are the live-provider scan trigger and the issue_clusters slug unique-index conflict path. | tests/e2e/mock-dev-server.mjs:710-729,1165-1500; tests/e2e/operator-writes.spec.ts:57-251 | The harness is now valid parity proof for the named admin writes, but it still cannot prove a provider-backed scan or production's unique-slug recovery. Keep those two gaps explicit instead of treating either a green screenshot suite or the shim's in-memory inserts as proof. |
| 7 | The preview harness forces OPENROUTER_API_KEY="" (and TAVILY/XAI keys empty), so features().ai is false and the /admin/compile "Draft with AI" checkbox is PERMANENTLY disabled with the fallback label "Draft with AI: disabled, no AI key configured" in every local preview and every e2e screenshot. The enabled state of that control has no local reproduction. | tests/e2e/mock-dev-server.mjs:1065 vs the disabled={!aiAvailable} branch at src/app/admin/compile/page.tsx:64 | The inventory lists both label states as if both are observable. One of them is only ever observable in production, so a redesign that restyles this control will be designing the enabled state blind. |
| 8 | STEAM_PULSE_ENABLED — an env-only kill switch (must literally equal "true") that gates the entire Steam review/pulse collection lane inside operator-triggered scans. When false the collector returns null before doing anything, so steam_pulse_snapshots and steam_review_receipts are never written by "Run capped scan now". | src/lib/env.ts:123-125, consumed at src/lib/automation/run.ts:639 | The inventory lists steam_pulse_snapshots/steam_review_receipts among what the scan button writes, and separately documents Steam-review lesson suppression, but never surfaces the flag that decides whether that lane runs at all. It is operator-controlled capability with zero UI — a redesign cannot expose or explain a switch it does not know exists. |
| 9 | TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET — env-only gate on the platform-context lane (IGDB and live context). Unset, the collector returns early and platform_context_snapshots is never written by an operator scan. | src/lib/env.ts:128-130, consumed at src/lib/automation/run.ts:819 | Same class as STEAM_PULSE_ENABLED: a whole data lane the scan button is credited with writing is conditional on credentials the operator surface never mentions. Explains silently-empty platform sections without any UI signal. |
| 10 | COUPLING BREAK: the Keep-as-relevant / rescue pipeline computes its budget from automationBudgetUsd() — i.e. the AUTOMATION_BUDGET_USD_MONTHLY env var (clamped to MAX_MONTHLY_LLM_USD_CAP) — and does NOT read the operator's saved monthlyLlmUsdCap. The scheduled/manual scan path does the opposite: `input.scannerPolicy?.monthlyLlmUsdCap ?? automationBudgetUsd()`. So the "Monthly LLM cap ($)" the operator sets on /scanner governs scans but not rescues. | src/lib/automation/run.ts:2633 (rescue, env) vs src/lib/automation/run.ts:2482 (scan, policy) | The inventory presents "Monthly LLM cap ($)" as the authoritative spend control and separately notes the rescue path is LLM-capped, without connecting them. A redesign that labels that field as the spend ceiling would be making a claim the rescue path does not honor — and rescue spends real OpenRouter money. |
| 11 | CROSS-PAGE COUPLING: the observation moderation desk on /scanner reads patch_observations filtered to .eq("patch_version", currentPatch.version) with .limit(40). The current patch version is exactly what the "Set current patch" break-glass control on /admin writes. Setting a manual patch override therefore silently swaps the entire Context lanes desk: items under the old version leave the card surface and cannot be moderated there, and already-rejected items lose their per-card Undo. Their still-active rules remain undoable in Active lessons until revoked or expired. | src/lib/queries.ts:1249 (filter) and :1251 (cap); written by setCurrentPatchOverride at src/app/admin/actions.ts:271 | Two controls on two different pages are wired together and neither one says so. The inventory describes the observation desk and the patch override independently. A reorganization that separates them further, or that offers the patch override more prominently, will make this invisible dependency more dangerous. |
| 12 | Hard read ceilings on the /scanner operator desks, none of them stated in the original inventory: kept leads are the 20 most recent source_signals (so "Browse N older leads" only ever reaches inside a 20-row window — there is no way to teach on an older lead, and the desk's search box filters that window only); rejected candidates are capped at 30 and additionally filtered to non-expired, non-rescued and undecided. Feedback rules have no explicit `.limit`, count, or pagination in either the admin read or scanner-enforcement read, so the hosted PostgREST row cap can still truncate older active rules. | src/lib/queries.ts:1152 (signals, 20), :1172 (candidates, 30), :1201-1206 (admin rules); src/lib/automation/run.ts:447-454 (enforcement rules) | The inventory listed the desks and their search/show-more affordances as if they page through the full corpus. They do not. A redesign must name the hard windows and must not treat the absence of a literal `.limit` as proof that every active rule loaded. Active-rule completeness needs `created_at DESC, id DESC` pagination (or an equivalent unique cursor) in both consumers, a tied-timestamp page-boundary regression, and an exact admin count. |
| 13 | Six server actions call revalidatePath("/admin/source-monitor") — a path whose only page is an unconditional redirect() stub with no rendered content. The revalidation is a permanent no-op left behind from before the source monitor moved to /scanner. | src/app/admin/actions.ts:442, :453, :466, :540, :607, :692, :726 (stub at src/app/admin/source-monitor/page.tsx:6) | The inventory covers the /admin/source-monitor redirect and covers revalidation generally, but not that six actions are still revalidating it. If the reorganization deletes the stub these calls go quiet rather than erroring, and anyone reading the actions file will keep believing there is a third operator page to keep in sync. |
| 14 | Every admin page inherits robots: { index: true, follow: true } from the root layout metadata and none of /admin, /admin/compile, /admin/login or the /scanner admin branch overrides it — so those pages emit an affirmative index,follow meta tag. The only countervailing signal is robots.txt. Separately, /scanner (the operator's SCANNER MONITOR destination) is deliberately listed in the sitemap. | src/app/layout.tsx:29 (index:true inherited); src/app/robots.ts:9 (disallow list); src/app/sitemap.ts:13 (/scanner submitted) | The inventory records the robots.txt disallow as the operator-surface obscurity measure and calls it "obscurity, not access control", but not that the pages themselves affirmatively ask to be indexed. Any new operator route the redesign adds inherits index,follow and is protected only by whatever string happens to be in the robots.ts disallow array. |
| 15 | The "Hourly scanner wake-up" GitHub Actions workflow is `on: workflow_dispatch` ONLY — it has no schedule. It is a manual, operator-clickable trigger in the GitHub UI that fires /api/cron/keepalive (which can start a real scheduled scan that spends Tavily credits and OpenRouter tokens). The actual hourly schedule lives in the Cloudflare Worker cron. | .github/workflows/hourly-scan.yml:4 (workflow_dispatch, no schedule) vs cloudflare/scanner-cron/wrangler.jsonc:9 ("crons": ["0 * * * *"]) | The inventory treats hourly-scan.yml as part of the scheduler alongside the Worker. It is actually a third way for a human operator to trigger a spending scan — one that bypasses the app's isAdmin() gate entirely (it carries CRON_SECRET, not a session) and appears on no admin page. |
| 16 | Out-of-app operator procedures documented as part of the admin workflow and not represented anywhere in the inventory: `npx wrangler secret put CRON_SECRET` / `npx wrangler deploy` for the cron Worker, and the supabase CLI migration flow (`supabase link`, `supabase migration list`, apply, `supabase migration repair`) which OPERATIONS.md explicitly frames as an owner-authorized release action. | docs/OPERATIONS.md:55-56 (wrangler) and docs/OPERATIONS.md:29-34 (supabase migrations) | The brief asked for supabase/ and script-level operator tooling in the admin workflow. Rotating CRON_SECRET is the only way to revoke the scan-trigger credential, and it exists nowhere in the console — worth knowing before a redesign implies the console is the whole operator surface. |
| 17 | Three unlisted automatic behaviors in ScanControls, all triggered by the two scan buttons: (a) router.refresh() fires the moment a run leaves 'running', silently re-rendering the entire /scanner admin page under the operator; (b) the poll gives up permanently after 4 consecutive network failures and swaps in "Lost contact with the scan — refresh the page"; (c) a 401 mid-poll (session expiry) stops tracking and shows "Your session expired" while the scan keeps running and keeps writing server-side. | src/components/ScanControls.tsx:80 (refresh), :41 and :87-91 (give-up), :64-70 (401 path) | The inventory covers the polling loop and its server-side sweepStaleRuns write, but not these three client behaviors. (a) is the mechanism by which every desk on the page changes content without the operator acting; (c) is a state where the UI has stopped reporting on a run that is still spending money. |
| 18 | POST /api/admin/scan schedules revalidatePublicSurfaces() inside Next's after() continuation, awaiting started.completion — so cache invalidation runs after the HTTP response has already been returned and only for mode==='manual'. A dry_run never revalidates. | src/app/api/admin/scan/route.ts:31-34 | The inventory records that manual scans revalidate, but not that it happens in a post-response continuation tied to run completion. If the reorganization changes how scans are launched (e.g. moves to a server action), this out-of-band completion hook does not come along for free. |
| 19 | /admin/compile?run=<id> pointing at a missing, deleted, or malformed id renders NOTHING — the .single() error is discarded and `current` stays null, so the output block, the mode line, and the copy button all silently vanish with no "run not found" message. The Previous runs list only shows 10, so any older bookmarked run id that has aged out looks identical to a broken page. | src/app/admin/compile/page.tsx:38-41 (error ignored) and :35 (10-row history) | The inventory lists compile-run-url-param as "any signed-in operator can fetch ANY dossier_runs row by id" without noting there is no failure state for a bad id. A redesign has no existing empty state to preserve here — it has an absence. |
| 20 | The dossier textarea auto-selects its entire contents on focus (onFocus -> currentTarget.select()). This is the actual mechanism behind the adjacent note "Focus the box to select all.", which the inventory lists as a static disclosure. | src/components/DossierOutput.tsx:12 | It is the fallback copy path when the clipboard API fails (the button's own failure copy says "Copy failed — select the text instead"). Swapping the read-only textarea for a <pre> or a syntax-highlighted block during a redesign would silently delete the fallback while leaving both pieces of copy that promise it. |

**Completeness assessment:**

The inventory is very strong on the in-app control surface: every "use server" export (14, all in src/app/admin/actions.ts), every route.ts under src/app/api (9, including both cron routes), and every rendered button/select/input/details on /admin, /admin/compile, /admin/login, /admin/source-monitor and the /scanner admin branch is accounted for. I found no unlisted server action, no unlisted API route, no dead /admin/* nav destination, and no admin capability leaking through the public /scanner branch.

The genuine gaps are in four bands the ten partitions did not systematically cover: (1) the failure and navigation surface (the global error boundary is the only UI any admin action throw reaches, report reads can fail green, radar, public scoreboard, and five Scanner admin reads can counterfeit healthy/empty state, both Dossier history reads discard errors, sign-out actually redirects, and safe page return after re-auth is being handled as a bounded Phase 4 change); (2) operator tooling in package.json and tests/e2e, including the two remaining preview-harness gaps — the live-provider scan trigger and the issue_clusters slug unique-index conflict path; (3) env-var-gated operator behavior with no UI (STEAM_PULSE_ENABLED, TWITCH_CLIENT_ID/SECRET, AUTOMATION_BUDGET_USD_MONTHLY), undisclosed OpenRouter transfers on Dossier and Keep, absent ZDR on the Keep automation route, unvalidated/unbounded Dossier AI output, plus one real coupling break where rescue ignores the cap the operator saved on /scanner; and (4) hard read ceilings and cross-page coupling on the desks themselves — the flagged queue stops at 50 with no pagination while the stat cell above it shows the true count, automatic records are an uncounted 20-row source-signal window, candidates are an uncounted 30-row eligible window, the observation moderation desk is scoped to the current patch and capped at 40, both active-rule consumers rely on a non-paginated non-total `created_at` order, both readAdminClusters projections can omit lifecycle/override recovery rows, manual patch provenance is erased before claim/Dossier/burst consumers, and the bulk export can silently stop at the hosted row cap.

Nothing here contradicts the covered list; it all sits alongside it. The riskiest items for a reorganization are #4 (queue caps that a redesign will assume are complete lists), #6 (the live scan and unique-slug behavior that the otherwise write-capable harness still cannot prove), #11 (a control on one page silently redefining the contents of a desk on another), and #12 plus fact-checks #4-#15 (service-capped/non-total reads, false-clear Scanner and Dossier state, private provider payloads, unenforced AI structure, erased patch provenance, invented moderation provenance, and the false scanner-rule write claim).

---

## Adversarial fact-check corrections applied

| # | Control | Claim | Reality | Evidence | Severity |
|---|---|---|---|---|---|
| 1 | api-admin-scan-status-get (test-coverage partition) | Original sweep called it read-only except for cache revalidation and placed sweepStaleRuns on the 404 path. | sweepStaleRuns runs before every lookup and can update stale automation_runs rows to failed. The detailed route entry now states this write explicitly. | src/app/api/admin/scan/status/route.ts:31; src/lib/automation/run.ts:167-184; tests/adminScanRoute.test.ts:206-211 | medium |
| 2 | admin-session-auth-primitives | Original sweep said no test exercised POST /api/admin/login. | E2E posts valid credentials and proves the resulting cookie reaches authenticated pages. The detailed entry now limits the gap to invalid/timing/cookie-attribute route behavior. | tests/e2e/public-visual.spec.ts:66-69; src/app/api/admin/login/route.ts:5-27 | medium |
| 3 | api-admin-scan-post (test-coverage partition) | Original sweep called the scan route the only asserted admin auth surface. | The /admin redirect has E2E proof, server actions now have centralized auth-first proof, and adminGuard has real token/secret proof. The detailed coverage entries now separate those layers. | tests/e2e/public-visual.spec.ts:1053-1056; tests/adminActionsAuth.test.ts:149-186; tests/adminGuard.test.ts | low |
| 4 | active scanner feedback-rule reads | Original sweep and its compatibility test treated the absence of a literal `.limit(50)` as proof that every active rule loaded and therefore kept an Undo path. | Both the admin and scanner-enforcement queries omit count and pagination, so the hosted PostgREST row cap can truncate them. Both also order only by non-unique `created_at`; a range-page refactor can skip or duplicate tied rows. The detailed entries now require `created_at DESC, id DESC` pagination (or an equivalent unique cursor), a tied-timestamp boundary regression in both consumers, and an exact admin total before the UI or enforcement path may claim all rules. | src/lib/queries.ts:1201-1206; src/lib/automation/run.ts:447-454; supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:28-43; tests/queriesAdminCompatibility.test.ts:189-200 | high |
| 5 | admin export row read | Original sweep described the route as exporting every bug_reports row because it has no explicit `.limit`. | The route makes one unpaginated select, so the hosted PostgREST row cap can truncate older reports without an error. "Every report" requires deterministic `created_at`, `id` pagination and a regression spanning more than one API page. | src/app/api/admin/export/route.ts:35-41 | high |
| 6 | readAdminClusters current and legacy projections | Original sweep treated both no-limit cluster selects as complete. | Both projections are single, title-only unpaginated reads. The hosted row cap can omit a forced override, the sole Reset control, and engine-owned lifecycle exceptions while the page still renders success. Both paths need stable `title`, `id` pagination and a multipage forced/exception regression. | src/lib/adminClusters.ts:19-24,37-40; src/app/admin/page.tsx:46-52,240-272 | high |
| 7 | Scanner Action inbox false clear | The inventory described a disconnected radar as unavailable and described the main admin read as hard-failing, while treating the operator inbox's zero headline as a normal derived state. | A failed radar run read returns `connected=false` with `runs7d.failed=0`; separately, `getAutomationAdminData` discards errors from the source-signal window, newest-10 run history, active-run lookup, latest-real-run lookup, and latest-find lookup. Those failures become `[]`/`null`, and `scannerStatus` defaults to green `ACTIVE`. A redesigned Scanner must throw or show explicit unknown/unavailable state, with a forced-failure regression for both radar reads and each of the five admin reads before it can clear. | src/lib/radar.server.ts:160-185,542-549; src/lib/queries.ts:1146-1160,1214-1240,1298-1311; src/components/scanner/AdminScannerView.tsx:42-50,357,393-455,518-535 | high |
| 8 | Dossier AI provider transfer | The checkbox inventory said only that OpenRouter rewrites deterministic prose and named only part of the provider payload. | The complete deterministic dossier becomes the OpenRouter user message. It contains private approved-report issue titles, reproduction steps, and evidence URLs; unpublished issue-cluster titles, fix status, and confidence; and public source URLs. The request requires `data_collection: "deny"` and `zdr: true`, but no adjacent UI copy discloses the complete transfer. The opt-in must name every listed field and routing requirement, with an exact representative body/routing regression and unchecked/disabled no-call regressions. | src/app/admin/actions.ts:288-369; src/lib/dossier.ts:58-62,96-100,131-160; src/lib/ai.ts:35-52; src/lib/automation/budget.ts:44-48; tests/ai.test.ts:35-56 | high |
| 9 | Dossier load read truth | The compile-page entry recorded the selected-run silent failure but treated the newest-10 list as a normal empty state and the redesign mock rendered a green zero. | The newest-10 `dossier_runs` query and the selected `?run=<id>` `.single()` query both discard `error`. A history failure becomes "No runs yet."; a missing, malformed, or failed selected-run read silently omits the output. Dossiers needs a neutral on-demand status plus explicit history error and selected-run missing/error states, with forced-failure regressions for both reads. | src/app/admin/compile/page.tsx:31-41,82-96 | high |
| 10 | Public scanner scoreboard failure | The Scanner false-clear correction covered Patch Radar and five admin reads but implicitly trusted the shared scoreboard. | `getPublicScannerDataUncached` discards its component query errors and has a broad catch that returns a connected-looking all-zero object with `llmPaused=false`. Admin rendering ignores `scannerConnected`, so a database failure can erase both data and a paused-circuit warning. Phase 4 must render those values unavailable/unknown and force each failure in tests before showing ordinary zero. | src/lib/queries.ts:1481-1613; src/components/scanner/AdminScannerView.tsx:357,491-521; src/app/scanner/page.tsx:22-23 | high |
| 11 | Keep-as-relevant provider call and privacy | Multiple entries called Keep a guaranteed paid LLM call and described the saved scanner cap as its budget. | On success, rescue creates a manual run and persists or re-observes a private source signal. It always uses zero search credits and makes zero or one OpenRouter generation call: missing key, model, allowance, or budget uses deterministic extraction. The generation prompt contains the private candidate title/snippet/canonicalized source URL and unpublished cluster slugs/titles. Cost verification can add up to three ID-only generation-audit GETs. The automation routing requests `data_collection:"deny"` but currently omits `zdr:true`, and rescue uses the separate environment automation budget rather than the saved scanner-policy cap. | src/lib/automation/run.ts:2613-2745; src/lib/automation/extract.ts:128-147,309-358; src/lib/automation/budget.ts:145-183; tests/automationLogic.test.ts:233-265,345-440 | high |
| 12 | Dossier AI prose-only guarantee | The target and mock treated the prompt's "rewrite prose only" instruction as enforced behavior and treated every provider failure as bounded fallback. | The helper accepts any free successful response longer than 200 characters, persists it directly, and supplies no abort signal or timeout. It does not validate headings, the eight-column Top issues table, numbers, lists, URLs, statuses, confidence material, or caveats. Phase 4 needs structural validation plus bounded timeout/tamper fallback tests before making that promise. | src/lib/ai.ts:26-64; src/app/admin/actions.ts:373-395; src/lib/dossier.ts:72-179; tests/ai.test.ts:17-70 | high |
| 13 | Current-patch provenance | The inventory said manual override rows add no official claims and the Lock entry said current-patch read failure propagates. | The override writes `board_no='manual-<version>'`, but `rowToCurrent` labels every database row `source:"official"`. Read errors return a hardcoded fallback instead of throwing; claim-bearing Locks and Dossier compile consume only its version. A fresh manual row with null `published_at` can also satisfy the official-patch burst predicate. Phase 4 must distinguish official/manual/fallback, reject fallback for claim-bearing writes and compile, and exclude manual rows from official burst scheduling. | supabase/migrations/20260710021010_atomic_current_patch_override.sql:28-55; src/lib/officialPatch.server.ts:43-64,79-93; src/app/admin/actions.ts:167-186,281-347; src/lib/automation/schedule.ts:30-34 | high |
| 14 | Report moderation provenance labels | The mocks preserved "Auto-sorted / Approved automatically", "Blocked automatically", an "auto-sort reason", and a fabricated per-card flag reason. | `moderation_status` stores only current approved/pending/spam state. Manual Approve and Spam actions enter the same counters; `moderateReport` does not persist decision origin, `reason`, or `aiUsed`, and flagged cards do not receive a stored auto-sort reason. Target copy must use neutral state labels and must not invent a reason. | src/app/admin/page.tsx:36-38,82-96,105-163; src/app/admin/actions.ts:111-144; src/lib/moderation.ts:180-201 | high |
| 15 | Scanner-run feedback-rule write | The scan-start entry listed `scanner_feedback_rules` among the background run's table writes. | Scanner runs read active feedback rules to match and suppress candidates; only explicit operator teaching actions write or revoke those rules. The scan entry must classify that table read-only. | src/lib/automation/run.ts:447-470; src/app/admin/actions.ts:470-728; supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:153-201 | medium |

**Fact-check assessment:**

Spot-checked roughly 60 of the highest-risk entries against source, then widened the pass across every Stage 1 target and mock claim. The parity-critical write and guard locations match source: twelve actions directly pair `requireAdmin()` with `assertProductionWriteAllowed()`, signOutAdmin is deliberately unguarded, and rescueRejectedCandidate delegates to a guarded action. Column-level scanner-decision, observation-decision/revocation, visibility-override, current-patch, and bug-report-trigger claims match the migrations. Unreachability, conditional-render, and dry-run-spend claims also check out. The fifteen discrepancies above are now corrected in the detailed entries and target contract: scan-status is documented as a write-performing GET, valid login POST has E2E coverage, server-action/page auth coverage is no longer described as scan-route-only, no-literal-limit active-rule and cluster queries are no longer described as complete, the single-page export no longer claims to return every stored report, failed Scanner and Dossier reads cannot pose as healthy/empty state, provider payload/call/routing boundaries are explicit, Dossier AI output is not treated as structurally trustworthy without validation, manual/fallback patch provenance is not treated as official, moderation-state copy does not invent origin, and scanner runs no longer claim to write feedback rules.

---

## Full inventory by surface

### /admin — "Report review" operator page (src/app/admin/page.tsx, 318 lines)

_34 controls · partition `inv:admin-page`_

#### `admin-auth-gate` — requireAdmin() (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every GET of /admin before anything renders
- **Does:** Redirects the visitor to /admin/login unless a valid signed admin session cookie is present.
- **Backing:** src/app/admin/page.tsx:25 -> src/lib/adminGuard.ts:20-22 (isAdmin at :13-18, verifySessionToken)
- **Inputs:** ADMIN_COOKIE session cookie only; no form input
- **Writes:** read-only
- **Guard:** This IS the guard: requireAdmin() -> isAdmin() -> verifySessionToken(cookie, SESSION_SECRET). If SESSION_SECRET is unset/empty/quoted-empty, adminSessionSecret() returns null and isAdmin() is false, so the page is unreachable rather than open (src/lib/adminGuard.ts:7-11)
- **Revalidates:** —
- **On failure:** Not signed in -> redirect('/admin/login'). A thrown error inside the guard surfaces the route error boundary src/app/error.tsx ("Something broke on our side." + "Try again").
- **Tests:** tests/e2e/public-visual.spec.ts:970-1009 (signs in first, then asserts /admin renders); tests/e2e/public-visual.spec.ts:1020-1027 (footer routes through sign-in)
- **Quirks:** Page-level guard only; every server action re-checks requireAdmin() independently, so the redesign cannot rely on the page guard alone. Sign-out lives in the shell, not in this file.

#### `admin-force-dynamic` — export const dynamic = "force-dynamic"

- **Kind:** automatic · **Destructive:** none
- **Reach:** Module-level route config for /admin
- **Does:** Opts the page out of all caching so every load re-runs the six queries below.
- **Backing:** src/app/admin/page.tsx:19
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Inherits the page's requireAdmin()
- **Revalidates:** —
- **On failure:** n/a (build-time config)
- **Tests:** —
- **Quirks:** Because the page is always dynamic, the revalidatePath("/admin") that every action performs is effectively a no-op for this page; it exists for the actions' other callers. The header copy "LIVE QUEUE · REFRESHES ON LOAD" (page.tsx:67) is a promise made by this line — dropping force-dynamic silently makes that copy false.

#### `flagged-reports-query` — Flagged queue read (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load; feeds the "Flagged for review" section
- **Does:** Selects up to 50 bug_reports with moderation_status = 'pending', oldest first, with all columns (including private description, repro_steps, hardware_specs, evidence_url).
- **Backing:** src/app/admin/page.tsx:29-34, consumed at :42 and :112
- **Inputs:** none (fixed filter/order/limit)
- **Writes:** read-only
- **Guard:** Page requireAdmin(); query runs through createServiceClient() (service-role key, bypasses RLS)
- **Revalidates:** —
- **On failure:** Only `data` is destructured — the error is discarded and `flagged ?? []` (page.tsx:42) yields an empty array, so a failed read renders the "✓ All clear" empty state. A read failure is indistinguishable from an empty queue.
- **Tests:** tests/e2e/public-visual.spec.ts:980 (mock queue carries one pending report)
- **Quirks:** Hard limit(50) with no pagination and no "showing 50 of N" affordance, while the "Flagged reports" stat cell shows the true unbounded count — the two can disagree. Oldest-first ordering is the queue contract; reversing it changes which reports an operator ever sees.

#### `admin-clusters-query` — readAdminClusters(supabase) (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load; feeds the cluster dropdown, the exception ledger, the forced-visibility list and the nested override browser
- **Does:** Requests issue_clusters rows (id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, admin_visibility_reason, admin_visibility_changed_at, is_public) ordered by title. The current and legacy projections are each one potentially service-capped page, not an all-row read.
- **Backing:** src/app/admin/page.tsx:35 -> src/lib/adminClusters.ts:16-48
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin(); service-role client
- **Revalidates:** —
- **On failure:** Throws `admin clusters read failed: …` on a real error, which takes the WHOLE page to src/app/error.tsx. Exception: a missing admin_visibility_reason / admin_visibility_changed_at column falls back to a legacy select and reports both as null (adminClusters.ts:27-47).
- **Tests:** tests/e2e/public-visual.spec.ts:991-1004 (forced row + nested browser render from this data)
- **Quirks:** Unlike the count queries, this one is fatal for the page. Ordering by title is the only ordering the cluster <select>, the exception ledger and the forced list have — there is no ordering by urgency or recency. Every returned cluster is loaded into the browser payload, but the one-page read can stop at the hosted service cap; the nested override browser therefore searches only that potentially truncated array until stable title/id pagination lands.

#### `approved-count-query` — Approved report count (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load; feeds the "Auto-sorted" stat cell
- **Does:** Head-only exact count of bug_reports with moderation_status = 'approved'.
- **Backing:** src/app/admin/page.tsx:36, rendered at :84
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin(); service-role client
- **Revalidates:** —
- **On failure:** Error is never inspected; `approved.count ?? 0` renders 0. A broken count reads as "zero approved", not as an error.
- **Tests:** —
- **Quirks:** Counts every approved report, including ones the operator approved by hand with the Approve button — the label says "Auto-sorted / Approved automatically", which is not what the number measures.

#### `pending-count-query` — Pending report count (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load; feeds the "Flagged reports" stat cell and the "Needs you" arithmetic
- **Does:** Head-only exact count of bug_reports with moderation_status = 'pending'.
- **Backing:** src/app/admin/page.tsx:37, rendered at :89, reused at :52
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin(); service-role client
- **Revalidates:** —
- **On failure:** Error is never inspected; `pending.count ?? 0` renders 0 and contributes 0 to needsYou.
- **Tests:** tests/e2e/public-visual.spec.ts:978 ("Needs you" visible)
- **Quirks:** This single number is used twice — as its own stat cell AND as the first term of needsYou (page.tsx:52). The two cells are coupled: any redesign that keeps one and drops the other changes what "Needs you" means. It is also unbounded while the queue below renders at most 50 rows.

#### `spam-count-query` — Spam report count (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load; feeds the "Filtered as spam" stat cell
- **Does:** Head-only exact count of bug_reports with moderation_status = 'spam'.
- **Backing:** src/app/admin/page.tsx:38, rendered at :94
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin(); service-role client
- **Revalidates:** —
- **On failure:** Error is never inspected; `spam.count ?? 0` renders 0.
- **Tests:** —
- **Quirks:** Caption says "Blocked automatically", but every manual Spam button press also lands in this count.

#### `current-patch-query` — getCurrentPatchMetadata(supabase) (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load; feeds the "Current patch override" summary value and the version input placeholder
- **Does:** Reads the official_patch_notes row with is_current = true (newest published_at) and returns version/source; falls back to the hardcoded CURRENT_PATCH constant when there is no row or the read fails.
- **Backing:** src/app/admin/page.tsx:39 -> src/lib/officialPatch.server.ts:102-104 and :79-93 (readCurrentPatchUncached), fallback at :43-53
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin(); service-role client
- **Revalidates:** —
- **On failure:** Swallows read errors and returns source:"fallback" — the summary then shows amber "Fallback <version>". A DB outage and a never-synced scanner are displayed identically.
- **Tests:** tests/e2e/public-visual.spec.ts:986 ("Current patch override" visible)
- **Quirks:** `rowToCurrent` labels every database row `source:"official"`, including the reserved `board_no='manual-<version>'` row written by the override. The admin summary therefore calls a manual row "Synced"; downstream claim, Dossier, and burst code cannot distinguish it from scraped evidence. Passing `supabase` deliberately bypasses the 5-minute unstable_cache path, so this page always sees fresh patch state while the rest of the site may not. OperatorShell independently calls the CACHED getCurrentPatchMetadata() (src/components/dispatch/Chrome.tsx:169), so the console footer's patch family and this ledger value can disagree for up to 5 minutes after an override.

#### `operator-shell-mount` — <OperatorShell active="review"> (renders REPORT REVIEW / SCANNER MONITOR / COMPILE DOSSIER / EXPORT CSV / Sign out)

- **Kind:** nav · **Destructive:** none
- **Reach:** Wraps the whole page; the operator nav bar at the top of /admin
- **Does:** Mounts the operator chrome: nameplate link to /, four nav destinations, and the Sign out submit form; marks REPORT REVIEW as aria-current="page".
- **Backing:** src/app/admin/page.tsx:55 and :316; nav + sign-out defined in src/components/dispatch/Chrome.tsx:154-206 (OPERATOR_NAV :154-159, signOutAdmin form :201-205)
- **Inputs:** active="review" prop only
- **Writes:** read-only from this page; signOutAdmin clears the ADMIN_COOKIE (src/app/admin/actions.ts:39-43)
- **Guard:** Chrome itself is unguarded — reachability comes from the page's requireAdmin(); /api/admin/export and /scanner enforce their own
- **Revalidates:** —
- **On failure:** Sign out redirects to /admin/login; nav links are plain navigations. Chrome.tsx awaits getCurrentPatchMetadata(), so a failure there would fail the whole page render.
- **Tests:** tests/e2e/public-visual.spec.ts:936 ("Scanner monitor" link visible from /admin); tests/e2e/public-visual.spec.ts:977 ("Operator console · signed in"); tests/e2e/public-visual.spec.ts:1007 (footer must say "12 hours after sign-in")
- **Quirks:** Sign out and EXPORT CSV (a download at /api/admin/export, deliberately a plain <a>, not next/link) are only reachable from this shell — a redesign that replaces the shell on /admin silently deletes both. Chrome.tsx is owned by another agent; this entry only records that /admin mounts it with active="review".

#### `stat-needs-you` — Needs you

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > stat band (first of four cells, aria-label "Queue summary")
- **Does:** READOUT, not a control — no link, no button, nothing focusable. Displays needsYou = pending report count + exception rows that are NOT operator-locked, crimson when > 0 and green when 0, with caption "No exceptions" / "Review exceptions".
- **Backing:** src/app/admin/page.tsx:52 (computation), :71-81 (render)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** Renders 0 (green, "No exceptions") whenever the pending count query failed, because the error is dropped at page.tsx:37/52.
- **Tests:** tests/e2e/public-visual.spec.ts:978
- **Quirks:** Deliberately NOT equal to the "N items" shown on the Lifecycle exceptions disclosure: needsYou counts only unsure claim matches (exceptionRows without admin_override) plus pending reports, while the disclosure counts locked rows too. Two visible numbers derived from one array with different predicates — a redesign that unifies them changes meaning. It is also the only crimson/green semantic in the band; the other three cells are always neutral.

#### `stat-auto-sorted` — Auto-sorted

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > stat band, cell 2
- **Does:** READOUT. Displays the approved bug_reports count with caption "Approved automatically".
- **Backing:** src/app/admin/page.tsx:82-86
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** Silently 0 on query error.
- **Tests:** —
- **Quirks:** Label/data mismatch: includes manual approvals made with the Approve button on this same page.

#### `stat-flagged-reports` — Flagged reports

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > stat band, cell 3
- **Does:** READOUT. Displays the pending bug_reports count with caption "Waiting for your call".
- **Backing:** src/app/admin/page.tsx:87-91
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** Silently 0 on query error.
- **Tests:** —
- **Quirks:** Can exceed the number of rows actually rendered below (queue is limit 50) with no indication. Shares its source number with "Needs you".

#### `stat-filtered-spam` — Filtered as spam

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > stat band, cell 4
- **Does:** READOUT. Displays the spam bug_reports count with caption "Blocked automatically".
- **Backing:** src/app/admin/page.tsx:92-96
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** Silently 0 on query error.
- **Tests:** —
- **Quirks:** Label/data mismatch: manual Spam presses are counted as "Blocked automatically". This is the only stat with no corresponding section on the page — there is no way to review or un-spam anything from /admin.

#### `flagged-report-id-hidden` — (hidden input name="id")

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Flagged for review > per-report moderation form
- **Does:** Carries the bug_reports row id that Approve/Reject/Spam will act on.
- **Backing:** src/app/admin/page.tsx:140; consumed at src/app/admin/actions.ts:114 and :123
- **Inputs:** value = report.id (uuid)
- **Writes:** bug_reports.moderation_status (via the chosen decision); bug_reports.cluster_id
- **Guard:** moderateReport re-checks requireAdmin() (actions.ts:112) and assertProductionWriteAllowed() (actions.ts:113)
- **Revalidates:** /admin; revalidatePublicSurfaces(): tags PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG; paths /, /issues, /report, /scanner
- **On failure:** Missing/blank id -> throw new Error("bad input") (actions.ts:118); unknown id -> "report not found" (actions.ts:131). Either way the route error boundary replaces the page and all typed excerpt text is lost.
- **Tests:** tests/adminActions.test.ts:166-261
- **Quirks:** Behaviour-carrying hidden field: if a redesign renders the three decision buttons outside this <form>, they submit with no id and every press throws "bad input".

#### `flagged-cluster-select` — (unlabelled <select name="cluster_id">, first option "No cluster")

- **Kind:** select · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > per-report moderation form, leftmost field
- **Does:** Chooses which issue cluster the report is filed under; options are the rows returned by readAdminClusters, ordered by title, defaulting to the report's existing cluster_id.
- **Backing:** src/app/admin/page.tsx:141-148; consumed at src/app/admin/actions.ts:116 and :135
- **Inputs:** Option values are cluster uuids; "" = No cluster. No search, grouping, or client-side cap; the upstream read can still stop at the hosted service cap. defaultValue = report.cluster_id ?? ""
- **Writes:** bug_reports.cluster_id (set to the chosen uuid, or NULL when "No cluster"); indirectly: refreshClusterVisibility() recomputes cluster stats/promotion for the old and new cluster (actions.ts:146-161 -> src/lib/automation/run.ts:1886-1889)
- **Guard:** requireAdmin() + assertProductionWriteAllowed() inside moderateReport (actions.ts:112-113). The cluster id itself is NOT validated against the cluster table — any uuid string is written as-is.
- **Revalidates:** /admin; revalidatePublicSurfaces(): PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG, /, /issues, /report, /scanner
- **On failure:** An invalid/foreign uuid fails at the DB FK level and surfaces as `throw new Error(error.message)` (actions.ts:137) -> route error boundary. A failure in the follow-up refreshClusterVisibility is swallowed and only console.error'd (actions.ts:158-160), so stats can silently lag a successful moderation.
- **Tests:** tests/adminActions.test.ts:228-261 (cluster reassignment refresh behaviour)
- **Quirks:** Coupled to ALL THREE buttons, not just Approve: moderateReport writes cluster_id on rejected and spam decisions too (actions.ts:135). Pressing Reject while the select shows "No cluster" strips an existing cluster link. There is no visible label, and the UI renders the entire returned cluster window as a dropdown farm; the upstream one-page read can still omit rows at the hosted service cap.

#### `flagged-excerpt-input` — (unlabelled text input, placeholder "Public excerpt, anonymized, max 500 chars")

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin > Flagged for review > per-report moderation form, middle field
- **Does:** Optional operator-written public quote that is published only if the report is approved.
- **Backing:** src/app/admin/page.tsx:149-154; consumed at src/app/admin/actions.ts:117 and :139-144
- **Inputs:** name="excerpt", maxLength 500 client-side; server trims and slices to 500 (actions.ts:117, :142). No minimum, not required.
- **Writes:** approved_excerpts INSERT { report_id, excerpt_text } — ONLY when decision === "approved" AND the trimmed excerpt is non-empty
- **Guard:** requireAdmin() + assertProductionWriteAllowed() inside moderateReport
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Insert failure throws `approved excerpt insert failed: …` (actions.ts:143) AFTER the moderation_status update already committed — the report is approved but has no public excerpt, and the operator sees the error page with their text gone.
- **Tests:** tests/adminActions.test.ts:203-226 (excerpt insert failure surfaces)
- **Quirks:** Silently ignored on Reject and Spam — the field stays enabled and gives no feedback that the text will be discarded. Placeholder is doing all the labelling work (no <label>, no aria-label), so it disappears the moment typing starts. It is the ONLY authoring surface for public excerpt text anywhere in the app; if the redesign drops it, approved reports can never gain a public quote.

#### `flagged-approve-button` — Approve

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > per-report moderation form, first button
- **Does:** Submits the form with decision=approved: files the report under the selected cluster, marks it approved, and publishes the excerpt if one was typed.
- **Backing:** src/app/admin/page.tsx:155-157 (<button name="decision" value="approved">) -> src/app/admin/actions.ts:111-165
- **Inputs:** name="decision" value="approved"; carries id, cluster_id, excerpt from the same form
- **Writes:** bug_reports.moderation_status = 'approved'; bug_reports.cluster_id; approved_excerpts (report_id, excerpt_text) when excerpt present; cluster stats/visibility via refreshClusterVisibility (best-effort)
- **Guard:** requireAdmin() (actions.ts:112) + assertProductionWriteAllowed() (actions.ts:113, throws "preview writes disabled" on VERCEL_ENV=preview). Decision value must be one of approved/rejected/spam (actions.ts:118).
- **Revalidates:** /admin; revalidatePublicSurfaces(): PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG, /, /issues, /report, /scanner
- **On failure:** Any DB error throws and renders src/app/error.tsx; the row may already be updated (update happens before the excerpt insert and before the refresh). No optimistic UI, no toast, no inline error.
- **Tests:** tests/e2e/public-visual.spec.ts:981 ("Approve" button visible); tests/adminActions.test.ts:166-201
- **Quirks:** This is the ONLY control on the page that publishes report text to the public site. It is a plain <button>, not the SubmitButton used everywhere else, so it has no pending/disabled state — a double-click can fire moderateReport twice. Being the FIRST submit button in the form, it is also the browser's implicit submission target: pressing Enter in the excerpt field approves the report. Ordering of the three buttons is load-bearing.

#### `flagged-reject-button` — Reject

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > per-report moderation form, second button
- **Does:** Submits decision=rejected: sets moderation_status to 'rejected' and still writes the selected cluster_id.
- **Backing:** src/app/admin/page.tsx:158-160 -> src/app/admin/actions.ts:111-165
- **Inputs:** name="decision" value="rejected"; also submits id, cluster_id, excerpt
- **Writes:** bug_reports.moderation_status = 'rejected'; bug_reports.cluster_id (written even though the report is being rejected)
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); decision allow-list (actions.ts:37, :118)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Throws -> route error boundary. If the report was previously approved and had a cluster, refreshClusterVisibility for that old cluster runs best-effort and its failure is only logged (actions.ts:147-161).
- **Tests:** tests/e2e/public-visual.spec.ts:982; tests/adminActions.test.ts:166-261
- **Quirks:** Label says "Reject" but the action also rewrites cluster_id and silently discards any typed excerpt. Styled with `tap-btn` while Approve uses `dispatch-btn` — the visual hierarchy is the only thing distinguishing the destructive-ish choices. Plain <button>, no pending state.

#### `flagged-spam-button` — Spam

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > per-report moderation form, third button
- **Does:** Submits decision=spam: sets moderation_status to 'spam' and writes the selected cluster_id.
- **Backing:** src/app/admin/page.tsx:161-163 -> src/app/admin/actions.ts:111-165
- **Inputs:** name="decision" value="spam"; also submits id, cluster_id, excerpt
- **Writes:** bug_reports.moderation_status = 'spam'; bug_reports.cluster_id
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); decision allow-list
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Throws -> route error boundary.
- **Tests:** tests/e2e/public-visual.spec.ts:983; tests/adminActions.test.ts:166-261
- **Quirks:** Nothing on /admin can undo this — spam reports are counted in the stat band but never listed again, so the only recovery is direct DB access. Visually identical to Reject (same `tap-btn` class), adjacent to it, with no confirmation.

#### `flagged-evidence-link` — (the evidence URL itself, rendered as the link text)

- **Kind:** link · **Destructive:** none
- **Reach:** /admin > Flagged for review > per-report card, "Evidence:" line — only when report.evidence_url is set
- **Does:** Opens the reporter-supplied evidence URL in a new tab.
- **Backing:** src/app/admin/page.tsx:126-138 (target="_blank" rel="noreferrer noopener", className "dispatch-link break-all")
- **Inputs:** href = report.evidence_url, unvalidated user-submitted URL
- **Writes:** read-only
- **Guard:** Page requireAdmin() only; rel="noreferrer noopener" is the only outbound protection. The URL is not scheme-checked or allow-listed here.
- **Revalidates:** —
- **On failure:** Dead/hostile link behaves like any external link; no preview, no domain badge.
- **Tests:** —
- **Quirks:** Conditional — the whole line vanishes when evidence_url is null, as do the Repro and Hardware lines (page.tsx:122-125). A redesign with fixed-height cards must handle four optional detail rows. This link sends the operator to attacker-influenced content from a service-role-privileged page.

#### `lifecycle-exceptions-disclosure` — Lifecycle exceptions

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Exception ledger band > first <details>
- **Does:** Collapsed-by-default summary row showing "N item/items" (amber when N > 0); expanding reveals the per-cluster Lock and Clear forms.
- **Backing:** src/app/admin/page.tsx:171-182 (summary), :183-224 (body); exceptionRows computed at :48-50
- **Inputs:** Native <details>/<summary>; no open prop, no persisted state
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** n/a — pure disclosure. Every action inside re-guards itself.
- **Tests:** tests/e2e/public-visual.spec.ts:984 ("Lifecycle exceptions" visible)
- **Quirks:** Closed on every load, including when items exist, so the crimson "Needs you" number points at controls behind a click. The summary count (exceptionRows.length — locked rows INCLUDED) intentionally differs from the "Needs you" number (locked rows EXCLUDED). Summary copy grows a sentence when empty (" Nothing needs a call right now."), so the row's height changes with state.

#### `lifecycle-lock-cluster-id-hidden` — (hidden input name="cluster_id" in the Lock form)

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions (expanded) > each ledger line
- **Does:** Identifies which cluster the Lock submit will pin.
- **Backing:** src/app/admin/page.tsx:201; consumed at src/app/admin/actions.ts:170, :187
- **Inputs:** value = cluster.id (uuid)
- **Writes:** issue_clusters row selected by this id
- **Guard:** setClusterFixStatus re-checks requireAdmin() + assertProductionWriteAllowed() (actions.ts:168-169)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Blank id -> throw new Error("bad input") (actions.ts:172).
- **Tests:** tests/adminActions.test.ts:263-288
- **Quirks:** Behaviour-carrying hidden field; one form per row, so the redesign must keep the select and the Lock button inside the SAME per-row <form> or every row will write to the wrong cluster.

#### `lifecycle-lock-status-select` — (unlabelled <select name="fix_status">, options: Open / Fix claimed — unverified / Marked fixed by maintainer / Still happening)

- **Kind:** select · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions (expanded) > each ledger line, left of the Lock button
- **Does:** Picks the lifecycle status to pin the cluster to, from LOCKABLE_STATUSES.
- **Backing:** src/app/admin/page.tsx:202-208; LOCKABLE_STATUSES at :22; labels from src/lib/lifecycle.ts:6-12
- **Inputs:** Values reported \| fix_claimed \| verified_fixed \| persists, labelled via LIFECYCLE_LABELS; defaultValue = cluster.fix_status; width fixed at 220px
- **Writes:** issue_clusters.fix_status
- **Guard:** Server validates against FIX_STATUSES (src/lib/constants.ts:46-52), which is a WIDER set than the menu — it also accepts "acknowledged"
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** A value outside FIX_STATUSES -> "bad input" (actions.ts:172).
- **Tests:** tests/adminActions.test.ts:263-288
- **Quirks:** LOCKABLE_STATUSES deliberately EXCLUDES "acknowledged" — the comment at page.tsx:21 says it is a dead state that no rule produces, so the lock menu does not offer it. Consequence: a legacy cluster whose fix_status IS 'acknowledged' gets a defaultValue matching no <option>, so the browser preselects the first option ("Open") and pressing Lock silently rewrites the status. The server would still accept 'acknowledged' from a crafted request — the exclusion is UI-only.

#### `lifecycle-lock-submit` — Lock (pending text "Locking...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Lifecycle exceptions (expanded) > each ledger line
- **Does:** Pins the cluster's lifecycle status to the operator's choice and takes it out of engine control, stamping a human-readable reason.
- **Backing:** src/app/admin/page.tsx:209-211 (SubmitButton, src/components/SubmitButton.tsx:6-21) -> src/app/admin/actions.ts:167-192
- **Inputs:** cluster_id + fix_status from the same form
- **Writes:** issue_clusters.fix_status; issue_clusters.admin_override = true; issue_clusters.lifecycle_reason = `Locked by you. Manual status set to <label>.`; issue_clusters.fix_claimed_at = now() for fix_claimed \| verified_fixed \| persists, otherwise NULL; issue_clusters.fix_claimed_patch_version = current patch version for those three, otherwise NULL
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:168-169); FIX_STATUSES allow-list (actions.ts:172)
- **Revalidates:** /admin; revalidatePublicSurfaces(): PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG, /, /issues, /report, /scanner
- **On failure:** DB error -> throw new Error(error.message) -> route error boundary. SubmitButton disables itself while pending (aria-busy), so no double submit.
- **Tests:** tests/adminActions.test.ts:263-288
- **Quirks:** Appears on EVERY exception row, including rows that are only there because of an unsure claim match — so the same button both resolves a question and creates a permanent override. Locking to "Open" wipes fix_claimed_at/fix_claimed_patch_version. Once locked, the row's label in the ledger flips to the literal string "MAINTAINER LOCK" (page.tsx:192) instead of the status you just chose, which is the one place the UI stops showing the value it wrote.

#### `lifecycle-clear-cluster-id-hidden` — (hidden input name="cluster_id" in the Clear form)

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions (expanded) > ledger lines where cluster.admin_override is true
- **Does:** Identifies the cluster whose lock will be released.
- **Backing:** src/app/admin/page.tsx:215; consumed at src/app/admin/actions.ts:237, :251
- **Inputs:** value = cluster.id (uuid)
- **Writes:** issue_clusters row selected by this id
- **Guard:** clearClusterFixStatusOverride re-checks requireAdmin() + assertProductionWriteAllowed() (actions.ts:235-236)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Blank id -> "bad input" (actions.ts:238).
- **Tests:** tests/adminActions.test.ts:289-311
- **Quirks:** Conditional markup: the whole second <form> exists only when admin_override is true (page.tsx:213-220), so the row layout differs between locked and unlocked exceptions.

#### `lifecycle-clear-submit` — Clear (pending text "Clearing...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Lifecycle exceptions (expanded) > only on rows carrying a maintainer lock
- **Does:** Releases the operator lock and hands the cluster's lifecycle back to the engine.
- **Backing:** src/app/admin/page.tsx:214-219 -> src/app/admin/actions.ts:234-256
- **Inputs:** cluster_id only; no confirmation
- **Writes:** issue_clusters.admin_override = false; issue_clusters.lifecycle_reason = NULL; issue_clusters.fix_claimed_at = NULL; issue_clusters.fix_claimed_patch_version = NULL
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:235-236)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** DB error -> throw new Error(error.message) -> route error boundary. SubmitButton blocks double submits.
- **Tests:** tests/adminActions.test.ts:289-311
- **Quirks:** Does NOT reset fix_status — the manually written status stays on the row until the engine next recomputes it, so "Clear" clears the lock, not the value. Clearing also removes the row from the ledger entirely (exceptionRows requires admin_override OR a "Needs review:" reason, page.tsx:48-50), so the row you just acted on vanishes on the next render with no confirmation of what happened. It deliberately nulls the claim clock (comment at actions.ts:245-247): auto must rebuild it only from a real matched claim.

#### `visibility-overrides-disclosure` — Visibility overrides

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Exception ledger band > second <details>
- **Does:** Collapsed summary showing "None active" or "N active" (amber when N > 0); expanding reveals one card per forced cluster plus the nested create-override browser.
- **Backing:** src/app/admin/page.tsx:227-238 (summary), :239-273 (body); forcedVisibility at :51, forcedRows at :46
- **Inputs:** Native <details>/<summary>
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/e2e/public-visual.spec.ts:985, :987-990 (test must click the summary to reach the contents)
- **Quirks:** forcedVisibility (page.tsx:51) recomputes exactly the same predicate as forcedRows (page.tsx:46) — two derivations of one truth that must stay in sync, or the badge will disagree with the list. Closed by default even when overrides are active, so live break-glass state is invisible on load.

#### `visibility-reset-cluster-id-hidden` — (hidden input name="cluster_id" in the Reset form)

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Visibility overrides (expanded) > each forced-cluster card header
- **Does:** Identifies the cluster to return to engine control.
- **Backing:** src/app/admin/page.tsx:256; consumed at src/app/admin/actions.ts:200, :209
- **Inputs:** value = cluster.id (uuid)
- **Writes:** issue_clusters row selected by this id, via RPC set_cluster_visibility_override
- **Guard:** setClusterVisibilityOverride re-checks requireAdmin() + assertProductionWriteAllowed() (actions.ts:198-199); the RPC is granted to service_role only (supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:485-486)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Blank id -> "bad input" (actions.ts:204); unknown id -> RPC raises 'issue cluster not found' (P0002) and the action throws.
- **Tests:** tests/adminActions.test.ts:313-437
- **Quirks:** Behaviour-carrying hidden field paired with a second hidden field below; both must travel together.

#### `visibility-reset-mode-hidden` — (hidden input name="visibility" value="auto")

- **Kind:** form · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides (expanded) > each forced-cluster card header
- **Does:** Hard-codes the reset form to the 'auto' branch of the shared visibility action — the branch that requires neither a reason nor a confirmation checkbox.
- **Backing:** src/app/admin/page.tsx:257; branch logic at src/app/admin/actions.ts:204-205 and :211
- **Inputs:** fixed value "auto"
- **Writes:** issue_clusters.admin_visibility_override = NULL; issue_clusters.admin_visibility_reason = NULL; issue_clusters.admin_visibility_changed_at = NULL; issue_clusters.is_public = restored from visibility_restore_is_public; issue_clusters.auto_public = restored from visibility_restore_auto_public; issue_clusters.visibility_restore_is_public / visibility_restore_auto_public = NULL; issue_clusters.visibility_revision = visibility_revision + 1
- **Guard:** Allow-list ['auto','force_public','force_hidden'] (actions.ts:194, :204) plus the reason+confirm requirement that applies ONLY when visibility !== 'auto' (actions.ts:205)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** If the deployed DB still has the legacy 2-arg RPC, the action retries without p_reason (actions.ts:214-224); any other RPC error throws.
- **Tests:** tests/adminActions.test.ts:313-437 (incl. the reason/confirmation requirement for non-auto values)
- **Quirks:** THE critical asymmetry of this page: the same server action powers both "reset" (no reason, no confirmation) and "force" (reason >= 3 chars + confirm_override checkbox, enforced in the nested browser). If a redesign turns this hidden field into a visible dropdown that can also pick force_public/force_hidden, submissions will start failing with "override reason and confirmation required" unless the reason and checkbox are added too.

#### `visibility-reset-submit` — Reset to automatic (pending text "Resetting...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides (expanded) > top-right of each forced-cluster card
- **Does:** Drops the break-glass override and restores the engine-computed visibility for that cluster, immediately.
- **Backing:** src/app/admin/page.tsx:255-261 -> src/app/admin/actions.ts:197-232
- **Inputs:** cluster_id + visibility=auto; no reason, no confirmation dialog
- **Writes:** issue_clusters override columns cleared and is_public/auto_public restored (see visibility-reset-mode-hidden); cluster stats/promotion recomputed by refreshClusterVisibility (actions.ts:227), which can change is_public again and can promote source_signals
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:198-199); RPC restricted to service_role
- **Revalidates:** /admin; revalidatePublicSurfaces() — and note the try/finally at actions.ts:226-231 revalidates EVEN IF the refresh throws
- **On failure:** RPC error throws its message. A refreshClusterVisibility failure throws AFTER revalidation has already run, so the operator sees the error page while the caches have been busted and the override is already cleared (tests/adminActions.test.ts:406-414 pins this).
- **Tests:** tests/e2e/public-visual.spec.ts:995 (button visible inside the ledger); tests/adminActions.test.ts:313-437
- **Quirks:** Instant, unconfirmed, and immediately public-facing: a forced-public issue can vanish from the site the moment this is pressed. After the press the cluster leaves the forced list and becomes reachable only by typing its title into the nested search browser — the card and its reason text are gone, so a mistaken reset cannot be visually retraced. The card's own header line (page.tsx:250-252) shows both the override AND the resulting live state ("FORCED PUBLIC · LIVE"), the only place the two are shown together.

#### `visibility-override-browser-mount` — Create visibility override (nested disclosure rendered by <VisibilityOverrideBrowser clusters={autoRows} />)

- **Kind:** disclosure · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides (expanded) > below the forced cards
- **Does:** Mounts the client-side search-and-force UI for engine-owned clusters: a search box, a visibility select (Force hidden / Force public), a required reason textarea, and a required confirmation checkbox.
- **Backing:** src/app/admin/page.tsx:272 (mount, receives autoRows from :47) -> src/components/admin/VisibilityOverrideBrowser.tsx:15-85
- **Inputs:** clusters prop = every returned cluster WITHOUT an override from the potentially service-capped readAdminClusters array; internal fields cluster_id (hidden), visibility (select, default force_hidden), reason (textarea, minLength 3 / maxLength 500, required), confirm_override (checkbox value="true", required)
- **Writes:** issue_clusters.admin_visibility_override / admin_visibility_reason / admin_visibility_changed_at / is_public / auto_public / visibility_restore_* / visibility_revision, plus source_signals.public_status='hidden' + promoted_at=NULL + promotion_reason='admin_force_hidden' on force_hidden (supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:444-481)
- **Guard:** Same setClusterVisibilityOverride action: requireAdmin(), assertProductionWriteAllowed(), plus the non-auto requirement reason>=3 && confirm_override==='true' (actions.ts:205)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Missing reason or unchecked confirmation -> "override reason and confirmation required" -> route error boundary (client `required` attributes catch it first).
- **Tests:** tests/e2e/public-visual.spec.ts:997-1004 (search-gated list, "1 matching issues.", results appear only after typing)
- **Quirks:** The component file is owned by another agent; recorded here because /admin is its ONLY mount point and it is nested two disclosures deep (details > details). Its list is search-gated by design — with an empty query it renders NO clusters, only the count "<N> automatic records" — so a redesign that flattens the nesting must preserve the deliberate friction. Forced and automatic rows are mutually exclusive (page.tsx:46-47): a cluster is either a card above or a search result here, never both.

#### `current-patch-disclosure` — Current patch override

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Exception ledger band > third and last <details>
- **Does:** Collapsed summary showing green "Synced <version>" or amber "Fallback <version>"; expanding reveals the manual patch form.
- **Backing:** src/app/admin/page.tsx:276-291 (summary), :292-312 (body/form)
- **Inputs:** Native <details>/<summary>
- **Writes:** read-only
- **Guard:** Page requireAdmin()
- **Revalidates:** —
- **On failure:** Shows "Fallback" whenever the patch read failed or returned nothing (officialPatch.server.ts:87-92) — a DB failure is presented identically to "the scanner has not synced".
- **Tests:** tests/e2e/public-visual.spec.ts:986
- **Quirks:** Its summary carries an inline `borderBottom: 0` (page.tsx:277) because it is the LAST row of the band — ordering is baked into the styling, so moving this section above another leaves a missing/doubled rule. This is the only place in the operator UI that reveals whether the official-patch scraper is currently working.

#### `current-patch-version-input` — New current patch

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin > Current patch override (expanded) > the only field
- **Does:** Accepts the patch version string to force as current.
- **Backing:** src/app/admin/page.tsx:297-308 (label at :297-299, input at :300-308)
- **Inputs:** id/htmlFor="patch_version_override", name="patch_version", required, pattern=PATCH_VERSION_SHAPE.source = ^\d+\.\d{1,2}(?:\.\d{1,2})?$ (src/lib/officialPatch.ts:64), title="Version like 1.13.02", placeholder = the CURRENT version, width 130px
- **Writes:** official_patch_notes rows (via the RPC — see the submit button)
- **Guard:** Server re-validates with isValidPatchVersion (actions.ts:267) and the RPC re-validates the same regex in SQL (supabase/migrations/20260710021010_atomic_current_patch_override.sql:11-13)
- **Revalidates:** /admin; revalidatePublicSurfaces()
- **On failure:** Client `pattern`/`required` blocks submission; a bypassed submit throws "bad input" (actions.ts:267); a bad value reaching Postgres raises 'invalid patch version'.
- **Tests:** tests/adminActions.test.ts:842-852 (rejects a bad version)
- **Quirks:** The placeholder is the CURRENT version, so the empty field looks pre-filled with the value you would be overriding — the one field on the page where placeholder-as-hint is actively misleading. It is also the only properly <label>-associated input on the entire page; the flagged-report select and excerpt input have no labels at all.

#### `current-patch-submit` — Set current patch (pending text "Saving...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Current patch override (expanded)
- **Does:** Break-glass: writes a synthetic 'manual-<version>' patch row, makes it the single current patch, and demotes whatever was current.
- **Backing:** src/app/admin/page.tsx:309-311 -> src/app/admin/actions.ts:263-279 -> RPC set_current_patch_override (supabase/migrations/20260710021010_atomic_current_patch_override.sql:1-57)
- **Inputs:** patch_version only; observed_at is stamped server-side with new Date() (actions.ts:270)
- **Writes:** official_patch_notes.is_current = false on the previously current row; official_patch_notes INSERT/UPSERT on board_no 'manual-<version>': title 'Manual override: Patch <version>', patch_version, official_url = the generic Pearl Abyss notice URL, published_at NULL, summary NULL, observed_at, is_current = true
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:264-265); isValidPatchVersion (actions.ts:267); RPC granted to service_role only and re-validating in SQL
- **Revalidates:** /admin; revalidatePublicSurfaces(): PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG, /, /issues, /report, /scanner
- **On failure:** RPC error -> throw new Error(error.message) -> route error boundary (tests/adminActions.test.ts:877-886). The RPC takes an advisory lock and is transactional, so a failure cannot leave the site with no current patch (migration comment at :18-22).
- **Tests:** tests/adminActions.test.ts:842-886 (bad input, success path, preview-write block, RPC failure)
- **Quirks:** Changes what the ENTIRE public site calls the current patch, from a control buried in the third collapsed disclosure, with no confirmation step. The manual row carries no published_at and no summary, so downstream 'previous patch' logic explicitly compensates for duplicate/manual remnants (officialPatch.server.ts:117-127). Per the action's own docstring (actions.ts:258-262) the next successful scraper sync silently reclaims control — the override is temporary and nothing in the UI says when it will be undone.

**Surface notes.** EXACT EMPTY-STATE COPY (verbatim, must survive any redesign): - Flagged for review, when zero pending (page.tsx:105-109): "✓ All clear — no flagged reports need review" followed by "New flags appear here with the full private text, the auto-sort reason, and approve / reject / spam controls with cluster selection." (Note: the promised "auto-sort reason" is NOT actually rendered on a real flagged card — the card shows platform/category/severity/frequency/patch/date, title, description, optional repro/hardware/evidence. The empty state describes a field the populated state does not have.) - Lifecycle exceptions summary, always (page.tsx:174-176): "The system decides labels from counts. Only unsure claim matches and your own locks appear here." plus, when zero, the appended " Nothing needs a call right now."; the value reads "0 items" (singular "item" at exactly 1). - Lifecycle exceptions body, when zero (page.tsx:185): "Nothing needs a call. Locks you set and unsure claim matches will surface here." - Visibility overrides summary, always (page.tsx:230-233): "Force public/hidden takes effect immediately. Only active break-glass changes appear here, each with its reason and a one-click return to engine control."; value reads "None active" or "<N> active". - Visibility overrides body, when none forced (page.tsx:241-244): "Nothing is forced right now — every issue's visibility is engine-owned. Force is break-glass only; the scanner normally gets this right on its own." The nested Create-visibility-override browser still renders BELOW this empty state — the section is never truly empty. - Current patch override summary, always (page.tsx:279-282): "Break-glass only: if the scanner stops finding Pearl Abyss patch notes, set the current patch by hand. The next successful scan takes control back." There is no empty state; the form always renders. - Per-card fallbacks inside a forced-visibility card: reason falls back to "Existing override created before reason tracking." (page.tsx:263) and the timestamp to "Change time unavailable" (page.tsx:267) when the legacy-column read path was used. - Page header copy: kicker "Operator · Admin controls", title "Report review", dek "Auto-sorted reports, flagged submissions, and the short list of exceptions that actually need you.", status chip "LIVE QUEUE · REFRESHES ON LOAD".  LOCKABLE_STATUSES — what it excludes and why (page.tsx:21-22): the list is ["reported","fix_claimed","verified_fixed","persists"]. FIX_STATUSES (src/lib/constants.ts:46-52) additionally contains "acknowledged"; the comment says verbatim that acknowledged is a dead state because no rule produces it, so the lock menu does not offer it. The exclusion is presentation-only — setClusterFixStatus validates against the full FIX_STATUSES, so the server would still accept it.  DERIVED VALUES (all computed inline in the component, no helper, no memo): - forcedRows = clusters WITH admin_visibility_override (page.tsx:46); autoRows = clusters WITHOUT it (page.tsx:47). They are mutually exclusive and exhaustive only within the returned readAdminClusters array, which can be service-truncated until the required stable pagination lands; the comment at :44-45 explains the split as a deliberate break-glass design ("instead of rendering a dropdown farm"). - exceptionRows = clusters where String(lifecycle_reason ?? "").startsWith("Needs review:") OR admin_override is truthy (page.tsx:48-50). The "Needs review:" prefix is a magic string produced elsewhere by the lifecycle engine — a wording change there empties this ledger with no error. - forcedVisibility = a second count of the same predicate as forcedRows (page.tsx:51). - needsYou = pending.count + exceptionRows WITHOUT admin_override (page.tsx:52), i.e. locked rows are excluded here but included in the ledger's "N items".  AUTOMATIC BEHAVIOUR ON LOAD: six reads fire in one Promise.all (page.tsx:28-40) — pending reports (limit 50, oldest first), readAdminClusters, three head-only counts (approved/pending/spam), and getCurrentPatchMetadata. Only readAdminClusters can fail loudly; the other five degrade to empty/zero/fallback with no operator-visible signal. There is no loading.tsx for /admin, so the page blocks on the slowest of the six with no skeleton.  LAYOUT / GROUPING: OperatorShell (nav + sign-out + export) > .dispatch-container > pagehead > .stat-band (4 readout cells, aria-label "Queue summary") > section.review-band (aria-label "Flagged for review") > section.rule-band (aria-label "Exception ledger") containing exactly three sibling <details>, in this fixed order: Lifecycle exceptions, Visibility overrides, Current patch override. All three are closed on load and none persists open state, so every write control on the page except Approve/Reject/Spam is one click away from being invisible.  CROSS-CUTTING RISKS FOR THE REDESIGN: 1. Two button styles encode two different safety models: the three moderation buttons are plain <button> (no pending state, double-submittable), while Lock / Clear / Reset to automatic / Set current patch use SubmitButton (disabled + aria-busy while pending). Standardising on one changes real behaviour. 2. Approve is the first submit button in its form, so Enter in the excerpt field approves. Reordering the buttons reassigns that default. 3. No control anywhere has a confirmation dialog, including Spam (irrecoverable from this UI), Reset to automatic (immediately public-facing), and Set current patch (site-wide). 4. Every action throws on failure into src/app/error.tsx ("Something broke on our side." / "Try again"); there is no inline error, no toast, and all typed input (excerpt, patch version) is lost. In production the message is replaced by a digest, so operators see nothing actionable. 5. All six writes on this page go through createServiceClient() (service role, RLS bypassed); the only authorization anywhere is the session cookie checked by requireAdmin(), re-checked inside each action, plus assertProductionWriteAllowed() which throws "preview writes disabled" when VERCEL_ENV === "preview" — meaning on Vercel preview deployments every control on this page renders and every submit fails.

### Operator server actions — session (signOutAdmin) + report moderation (moderateReport) + cluster locks/overrides (setClusterFixStatus, clearClusterFixStatusOverride, setClusterVisibilityOverride, setCurrentPatchOverride), src/app/admin/actions.ts lines 1-280, plus the /admin and operator-chrome widgets that post to them

_32 controls · partition `inv:actions-moderation`_

#### `module-use-server-boundary` — "use server" module directive (src/app/admin/actions.ts:1)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Not visible. Every export in this file is compiled into a POST-able server-action endpoint reachable by action id from any client that has a valid session; the /admin page is only one caller.
- **Does:** Turns all 20 exports of this file into remotely invocable endpoints; the six in this partition are signOutAdmin (:39), moderateReport (:111), setClusterFixStatus (:167), setClusterVisibilityOverride (:197), clearClusterFixStatusOverride (:234), setCurrentPatchOverride (:263).
- **Backing:** src/app/admin/actions.ts:1
- **Inputs:** n/a — each export takes FormData (except signOutAdmin, which takes none).
- **Writes:** read-only (the directive itself writes nothing)
- **Guard:** None at module level. Each action guards itself; signOutAdmin has NO guard at all. There is no middleware protecting /admin — the only gate is requireAdmin() inside each action and inside the page components.
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/adminActions.test.ts (imports the module directly for every case)
- **Quirks:** Splitting this file during a redesign changes server-action ids; any form still holding an old id (open tab, cached RSC payload) will 404 on submit. Guards are per-export, not per-module — a new export added without requireAdmin()/assertProductionWriteAllowed() is silently unauthenticated, exactly like signOutAdmin is today.

#### `module-decisions-allowlist` — DECISIONS constant = ["approved","rejected","spam"]

- **Kind:** automatic · **Destructive:** none
- **Reach:** Not visible; enforced inside moderateReport.
- **Does:** Sole server-side allowlist for the moderation decision value. Note "pending" is NOT in it — an operator cannot send a report back to the pending queue.
- **Backing:** src/app/admin/actions.ts:37
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** Any other value throws "bad input" (src/app/admin/actions.ts:118).
- **Tests:** —
- **Quirks:** The DB check constraint allows 'pending','approved','rejected','spam' (supabase/migrations/20260705192906_schema.sql:36) but this allowlist drops 'pending'. There is therefore NO control anywhere that returns a decided report to the queue — moderation is one-way from the UI's perspective.

#### `module-visibility-overrides-allowlist` — VISIBILITY_OVERRIDES constant = ["auto","force_public","force_hidden"]

- **Kind:** automatic · **Destructive:** none
- **Reach:** Not visible; enforced inside setClusterVisibilityOverride.
- **Does:** Server-side allowlist for the visibility value; mirrors the same list inside the SQL function.
- **Backing:** src/app/admin/actions.ts:194
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** Any other value throws "bad input" (src/app/admin/actions.ts:204).
- **Tests:** tests/adminActions.test.ts:420 ("rejects unknown visibility values")
- **Quirks:** Duplicated in three places that must stay in sync: this constant, the RPC's IN-list (supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:435), and the two <option> values in VisibilityOverrideBrowser (src/components/admin/VisibilityOverrideBrowser.tsx:71-72). The UI never offers "auto" in that select — auto is only reachable from the separate hidden-input reset form.

#### `sign-out-button` — Sign out

- **Kind:** button · **Destructive:** reversible
- **Reach:** Operator chrome header, right end of the Operator nav — present on /admin, /admin/compile, and /scanner (when signed in). Not on /admin/source-monitor (that page does not use OperatorShell).
- **Does:** Submits an empty form to signOutAdmin, which clears the session cookie and redirects to the login page.
- **Backing:** src/components/dispatch/Chrome.tsx:201-205 (form action={signOutAdmin} + submit button)
- **Inputs:** No fields. The <form> wraps the button with style display:contents so it visually matches the sibling nav links.
- **Writes:** cookie cd_admin (cleared)
- **Guard:** NONE FOUND on the action itself (see sign-out-action). The button is only rendered inside OperatorShell, but the endpoint is callable without a session.
- **Revalidates:** redirect("/admin/login") inside the action
- **On failure:** If the cookie store write throws, the redirect never runs and the submit surfaces a server-action error; the operator stays signed in.
- **Tests:** tests/e2e/public-visual.spec.ts:1020-1056 signs in through the footer flow, submits Sign out, and proves subsequent direct /admin navigation redirects to /admin/login.
- **Quirks:** It is a real <form> submit styled as a nav link — keyboard/focus order and the display:contents wrapper are load-bearing for the header layout. It is the ONLY sign-out affordance in the app; there is no session-expiry notice beyond the footer sentence "Sessions expire 12 hours after sign-in" (Chrome.tsx:211).

#### `sign-out-action` — signOutAdmin (server action)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** Posted by the Sign out button; also directly invocable by action id.
- **Does:** Overwrites the cd_admin cookie with an empty value and maxAge 0, then redirects to /admin/login.
- **Backing:** src/app/admin/actions.ts:39-43
- **Inputs:** None — takes no FormData argument at all.
- **Writes:** cookie cd_admin = "" (httpOnly, path="/", maxAge=0)
- **Guard:** NONE FOUND — no requireAdmin(), no assertProductionWriteAllowed(). Unauthenticated callers can invoke it; the only effect is clearing their own cookie, so the exposure is a nuisance-level forced sign-out, not privilege escalation.
- **Revalidates:** redirect("/admin/login")
- **On failure:** cookies().set() throwing (e.g. called outside a request that can set headers) propagates as a server-action error; no cookie change, no redirect. The redirect itself throws NEXT_REDIRECT by design — any try/catch added around this call would swallow the navigation.
- **Tests:** tests/adminActionsAuth.test.ts:188-204 proves this deliberate exemption: no auth call, no DB/RPC work, cookie cleared with maxAge 0, and redirect to /admin/login.
- **Quirks:** Cookie attributes do not mirror the ones used when setting the session: login sets secure (in production) and sameSite:"lax" (src/app/api/admin/login/route.ts:19-24); the clear omits both. Deletion still matches on name+path, but a redesign that changes cookie scope must change BOTH places. A second, currently unreferenced sign-out path exists: DELETE /api/admin/login (src/app/api/admin/login/route.ts:29-33) does the same clear without the redirect and has no caller in src/ — dead code a redesign should either wire up or delete deliberately. This action also skips assertProductionWriteAllowed(), so sign-out (unlike every other action here) still works on Vercel preview.

#### `moderate-report-action` — moderateReport (server action)

- **Kind:** server-action · **Destructive:** irreversible
- **Reach:** /admin > "Flagged for review" band > one form per pending report.
- **Does:** Sets a report's moderation status and cluster assignment, optionally publishes a hand-written public excerpt, then best-effort recomputes visibility for the clusters the approval moved between.
- **Backing:** src/app/admin/actions.ts:111-165
- **Inputs:** FormData fields read: "id" (required, no format check — any non-empty string), "decision" (required, must be one of approved/rejected/spam), "cluster_id" (optional, NOT validated against existing clusters; empty string becomes null), "excerpt" (optional, trimmed, truncated to 500 chars at insert; no minimum length, no profanity/PII check at this stage).
- **Writes:** bug_reports.moderation_status; bug_reports.cluster_id; approved_excerpts.report_id (insert, only when decision==='approved' AND excerpt is non-empty); approved_excerpts.excerpt_text (insert, excerpt.slice(0,500)); via DB trigger trg_sync_approved_report_visibility (supabase/migrations/20260710001212_visibility_refresh_revision.sql:97-160): issue_clusters.auto_public, issue_clusters.is_public, issue_clusters.visibility_restore_auto_public, issue_clusters.visibility_restore_is_public, issue_clusters.visibility_revision; via refreshClusterVisibility -> apply_cluster_visibility_refresh RPC (src/lib/automation/run.ts:1863-1877; migration 20260710001212:162-392): source_signals.public_status, source_signals.promoted_at, source_signals.promotion_reason, issue_clusters.signal_count, issue_clusters.direct_report_count, issue_clusters.verified_report_count, issue_clusters.public_signal_count, issue_clusters.last_signal_at, issue_clusters.auto_public, issue_clusters.is_public, issue_clusters.visibility_restore_auto_public, issue_clusters.visibility_restore_is_public, issue_clusters.visibility_revision
- **Guard:** requireAdmin() at src/app/admin/actions.ts:112 — verifies the HMAC-signed cd_admin cookie (src/lib/adminGuard.ts:13-22, src/lib/session.ts:12-24) and redirect("/admin/login") when missing/expired; assertProductionWriteAllowed() at :113 throws "preview writes disabled" when VERCEL_ENV==='preview' (src/lib/previewGuard.ts:7-9). No CSRF token beyond Next's server-action origin check.
- **Revalidates:** revalidatePath("/admin") (actions.ts:163); revalidatePublicSurfaces() (actions.ts:164) -> revalidateTag PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG (all "max") + revalidatePath "/", "/issues", "/report", "/scanner" (src/lib/revalidate.ts:10-22)
- **On failure:** Every failure is an uncaught throw with no inline error UI on /admin: report read error -> "report read failed: <msg>"; row missing -> "report not found"; status update error -> raw Postgres message; excerpt insert error -> "approved excerpt insert failed: <msg>" AFTER the status was already written (partial state: report approved, excerpt missing — tests/adminActions.test.ts:207-228 pins this). Only the visibility refresh is best-effort: it is wrapped in try/catch and logged as "cluster visibility refresh failed:" (actions.ts:158-160), so a refresh failure still leaves the approval and excerpt persisted and still revalidates. revalidatePublicSurfaces swallows its own errors (revalidate.ts:19-21).
- **Tests:** tests/adminActions.test.ts:166-261 (approve refreshes cluster; excerpt survives refresh failure; excerpt insert failure surfaces; reject refreshes old cluster; move refreshes both clusters)
- **Quirks:** 1) The approved_excerpts INSERT is the irreversible part: no delete/edit control for excerpts exists anywhere in the app (only reads at src/lib/queries.ts:463, :881, src/app/api/reports/route.ts:89, src/lib/automation/run.ts:1289). 2) Published excerpts are NOT filtered by moderation_status (src/lib/queries.ts:433-475), so an excerpt stays public even after the report is later rejected or marked spam. 3) approved_excerpts has no unique constraint on report_id (schema.sql:48-53), so approving the same report twice with text inserts duplicate public quotes; verified_report_count dedupes by report_id so counts do not move. 4) Ordering is deliberate and load-bearing: excerpt insert must precede the visibility refresh (comment at actions.ts:153-156). 5) Old and new clusters are refreshed in Set insertion order — old first, then new (test at :245-260 asserts the order). 6) The queue only lists moderation_status='pending' (src/app/admin/page.tsx:29-34, limit 50, oldest first), so once decided a report has no rendered UI route back. The action has no status guard, however: a retained or forged resubmission can re-decide the report, move its cluster, or append another excerpt. That unrestricted endpoint is not an operator recovery control.

#### `moderate-report-id-hidden` — (hidden) id

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Flagged for review > inside each report's form.
- **Does:** Carries the bug_reports.id the decision applies to.
- **Backing:** src/app/admin/page.tsx:140
- **Inputs:** type=hidden, name="id", value={report.id}.
- **Writes:** read-only (selects the WHERE target for bug_reports updates)
- **Guard:** Server-side: only that the string is non-empty (actions.ts:118). No ownership/state check beyond the row existing.
- **Revalidates:** —
- **On failure:** Missing/empty -> "bad input". Non-existent id -> "report not found".
- **Tests:** tests/adminActions.test.ts:170
- **Quirks:** An operator can moderate ANY report id, including already-approved ones, by posting directly — the UI simply never renders those forms.

#### `moderate-report-cluster-select` — cluster select — "No cluster" + one option per cluster

- **Kind:** select · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > first field in each report's form.
- **Does:** Chooses which issue cluster the report is attached to; empty option detaches it.
- **Backing:** src/app/admin/page.tsx:141-148 (options from readAdminClusters, src/lib/adminClusters.ts:16-48)
- **Inputs:** name="cluster_id", defaultValue = report.cluster_id ?? "". Options: "" ("No cluster") plus every row returned by the potentially service-capped cluster read, ordered by title.
- **Writes:** bug_reports.cluster_id
- **Guard:** Same action guards. The value is NOT validated server-side against issue_clusters — an arbitrary string is written and only the FK constraint on bug_reports.cluster_id (schema.sql:37) rejects a bad uuid, surfacing as a raw Postgres error.
- **Revalidates:** —
- **On failure:** Absent field -> written as null (detaches the report). Malformed uuid -> raw Postgres error thrown from actions.ts:137.
- **Tests:** tests/adminActions.test.ts:245-260
- **Quirks:** There is no client-side list cap: every returned cluster renders as an <option> on every flagged report (no search, grouping, or category hint), while the upstream one-page read can silently omit clusters at the hosted service cap. This is the same returned data the VisibilityOverrideBrowser deliberately hides behind a search box. Also note that changing cluster on an ALREADY-approved report is what triggers the two-cluster refresh path, but that path is unreachable from this page because only pending reports are listed.

#### `moderate-report-excerpt-input` — Public excerpt, anonymized, max 500 chars

- **Kind:** text-input · **Destructive:** irreversible
- **Reach:** /admin > Flagged for review > second field in each report's form.
- **Does:** Optional hand-written quote that becomes public copy on the issue board when the decision is Approve.
- **Backing:** src/app/admin/page.tsx:149-154; consumed at src/app/admin/actions.ts:117 and :139-144
- **Inputs:** name="excerpt", maxLength=500 (client only), no required, no pattern. Server trims and slices to 500; DB check char_length <= 500 (schema.sql:52).
- **Writes:** approved_excerpts.excerpt_text; approved_excerpts.report_id
- **Guard:** Same action guards. No content validation — whatever is typed is published verbatim.
- **Revalidates:** (via the action) /admin plus all public surfaces
- **On failure:** Empty or whitespace-only -> no row inserted, no warning, the approval still succeeds silently. Insert error -> throws AFTER the status update already landed.
- **Tests:** tests/adminActions.test.ts:179-228
- **Quirks:** The field is silently ignored for Reject and Spam — typing an excerpt and clicking Reject discards it with no feedback. Its label promises "anonymized" but nothing enforces that; the PII screen in src/lib/moderation.ts runs only on player submissions, never on this operator-typed text. This is the single highest-consequence input in the partition: it writes public, permanent copy with no undo.

#### `moderate-report-approve` — Approve

- **Kind:** button · **Destructive:** irreversible
- **Reach:** /admin > Flagged for review > third control in each report's form.
- **Does:** Submits the form with decision=approved: publishes the report, attaches the selected cluster, inserts the excerpt if present, and promotes the cluster.
- **Backing:** src/app/admin/page.tsx:155-157 (name="decision" value="approved")
- **Inputs:** Submit button carrying name="decision", value="approved".
- **Writes:** bug_reports.moderation_status='approved'; bug_reports.cluster_id; approved_excerpts (insert when excerpt present); issue_clusters.auto_public/is_public/visibility_restore_*/visibility_revision (DB trigger)
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:112-113).
- **Revalidates:** /admin; /, /issues, /report, /scanner + PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG
- **On failure:** See moderate-report-action. No pending/disabled state — this is a plain <button>, not SubmitButton, so double-clicks can double-submit and insert duplicate excerpts.
- **Tests:** tests/adminActions.test.ts:167-177
- **Quirks:** One approved, clustered report alone makes a cluster PUBLIC via the DB trigger (auto_public=true, is_public=true unless force_hidden) — approving is a publish action, not a filing action. Label says "Approve" but the effect is "publish this cluster to the public Issue Board". Unlike every other submit in this partition it is a bare dispatch-btn with no pending state.

#### `moderate-report-reject` — Reject

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > fourth control in each report's form.
- **Does:** Submits decision=rejected: marks the report rejected and, if it had been approved into a cluster, recomputes that cluster.
- **Backing:** src/app/admin/page.tsx:158-160 (name="decision" value="rejected")
- **Inputs:** Submit button carrying name="decision", value="rejected".
- **Writes:** bug_reports.moderation_status='rejected'; bug_reports.cluster_id (still written from the select — rejecting also rewrites the cluster assignment)
- **Guard:** requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** /admin; public surfaces
- **On failure:** See moderate-report-action.
- **Tests:** tests/adminActions.test.ts:230-243
- **Quirks:** Rejecting still writes cluster_id from the select — a redesign that drops the select from the reject path changes behavior. Rejecting does NOT remove any excerpt already published for that report. No pending state (plain button).

#### `moderate-report-spam` — Spam

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > last control in each report's form.
- **Does:** Submits decision=spam: marks the report spam and feeds the "Filtered as spam" counter.
- **Backing:** src/app/admin/page.tsx:161-163 (name="decision" value="spam")
- **Inputs:** Submit button carrying name="decision", value="spam".
- **Writes:** bug_reports.moderation_status='spam'; bug_reports.cluster_id
- **Guard:** requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** /admin; public surfaces
- **On failure:** See moderate-report-action.
- **Tests:** —
- **Quirks:** Visually identical to Reject (same tap-btn class) but feeds a different public stat tile (page.tsx:92-96). Spam does NOT train anything — unlike the scanner's reject-and-teach path, it writes no rule and produces no learning; the word "Spam" implies a filter that does not exist here.

#### `set-cluster-fix-status-action` — setClusterFixStatus (server action)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /admin > "Lifecycle exceptions" disclosure > per-row Lock form.
- **Does:** Pins a cluster's lifecycle status by hand, sets admin_override=true so the engine stops deciding it, and stamps or clears the fix-claim clock.
- **Backing:** src/app/admin/actions.ts:167-192
- **Inputs:** FormData fields read: "cluster_id" (required, non-empty, not otherwise validated), "fix_status" (required, must be in FIX_STATUSES = reported\|acknowledged\|fix_claimed\|verified_fixed\|persists, src/lib/constants.ts:46-52).
- **Writes:** issue_clusters.fix_status; issue_clusters.fix_claimed_at (now() ISO when status is fix_claimed/verified_fixed/persists, otherwise NULL); issue_clusters.fix_claimed_patch_version (current patch version when claim-bearing, otherwise NULL); issue_clusters.admin_override = true; issue_clusters.lifecycle_reason = `Locked by you. Manual status set to <label>.`; reads official_patch_notes via getCurrentPatchMetadata (src/lib/officialPatch.server.ts:79-104) only for claim-bearing statuses
- **Guard:** requireAdmin() at actions.ts:168; assertProductionWriteAllowed() at :169.
- **Revalidates:** revalidatePath("/admin") (actions.ts:190); revalidatePublicSurfaces() (actions.ts:191)
- **On failure:** Invalid/missing field -> throws "bad input" before any read or write. Update error -> raw Postgres message thrown; nothing revalidates (the revalidate calls are after the throw). getCurrentPatchMetadata never throws — it falls back to CURRENT_PATCH ("1.13.01") on read failure, so a database hiccup silently stamps the fallback version into fix_claimed_patch_version.
- **Tests:** tests/adminActions.test.ts:263-287
- **Quirks:** 1) Choosing a non-claim-bearing status (reported/acknowledged) NULLS fix_claimed_at and fix_claimed_patch_version — the engine's real claim clock is destroyed and no control restores it; only a fresh, confidently matched Pearl Abyss claim during an automation run rebuilds it. 2) It does NOT call refreshClusterVisibility — lifecycle and visibility are separate axes; a redesign that merges them would change behavior. 3) The action accepts 'acknowledged' even though the UI calls it a dead state and never offers it (src/app/admin/page.tsx:21-22). 4) lifecycle_reason text is written by the server and is what the exception ledger renders back; the second-person copy ("Locked by you") is part of the locked Phase-3b vocabulary.

#### `lifecycle-lock-cluster-id-hidden` — (hidden) cluster_id — lock form

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions disclosure > per-row Lock form.
- **Does:** Carries the issue_clusters.id being locked.
- **Backing:** src/app/admin/page.tsx:201
- **Inputs:** type=hidden, name="cluster_id", value={cluster.id}.
- **Writes:** read-only (WHERE target)
- **Guard:** Non-empty check only (actions.ts:172).
- **Revalidates:** —
- **On failure:** Empty -> "bad input". Unknown id -> Supabase update matches zero rows and returns no error, so the action reports success while changing nothing.
- **Tests:** tests/adminActions.test.ts:267
- **Quirks:** Silent no-op on an unknown cluster id — there is no "cluster not found" check here, unlike moderateReport's explicit report-not-found guard and unlike the visibility RPC's P0002 raise.

#### `lifecycle-lock-status-select` — lifecycle status select — Open / Fix claimed — unverified / Marked fixed by maintainer / Still happening

- **Kind:** select · **Destructive:** reversible
- **Reach:** /admin > Lifecycle exceptions disclosure > per-row Lock form, left of the Lock button.
- **Does:** Picks which status the manual lock pins.
- **Backing:** src/app/admin/page.tsx:202-208; options from LOCKABLE_STATUSES (page.tsx:22) labelled by LIFECYCLE_LABELS (src/lib/lifecycle.ts:6-12)
- **Inputs:** name="fix_status", defaultValue={cluster.fix_status}, width 220px. Offered values: reported, fix_claimed, verified_fixed, persists.
- **Writes:** issue_clusters.fix_status (plus the claim-clock columns, see the action)
- **Guard:** Server-side membership in FIX_STATUSES (a WIDER set than the options shown).
- **Revalidates:** —
- **On failure:** Missing/unknown value -> "bad input".
- **Tests:** tests/adminActions.test.ts:268
- **Quirks:** 'acknowledged' is deliberately omitted as a dead state, which creates a trap: for a legacy row whose fix_status IS 'acknowledged', defaultValue matches no option, so the browser preselects the first option ("Open") and pressing Lock silently rewrites acknowledged -> reported. The label "Open" maps to the stored value 'reported' — label and value diverge by design (locked vocabulary: WATCHING -> OPEN), so a redesign must not rename the value.

#### `lifecycle-lock-submit` — Lock (pending text "Locking...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Lifecycle exceptions disclosure > right end of each exception row.
- **Does:** Applies the manual lifecycle lock for that cluster.
- **Backing:** src/app/admin/page.tsx:209-211 (SubmitButton, src/components/SubmitButton.tsx:6-21)
- **Inputs:** No own field; submits the enclosing form.
- **Writes:** issue_clusters.fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason
- **Guard:** requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** /admin; public surfaces
- **On failure:** Disabled with aria-busy while pending (SubmitButton), so no double-submit. Action errors surface as an unhandled server-action error with no inline message.
- **Tests:** tests/adminActions.test.ts:270
- **Quirks:** Reachable ONLY for clusters already in the exception list — page.tsx:48-50 filters to rows whose lifecycle_reason starts with "Needs review:" OR that already carry admin_override. There is no way from the UI to lock an arbitrary cluster; a redesign that adds a general cluster list would be adding capability, and one that drops the exception filter would remove the only entry point.

#### `clear-fix-status-override-action` — clearClusterFixStatusOverride (server action)

- **Kind:** server-action · **Destructive:** irreversible
- **Reach:** /admin > Lifecycle exceptions disclosure > per-row Clear form (rendered only when the row is locked).
- **Does:** Hands a locked cluster back to the engine: drops admin_override, wipes the operator reason, and erases the synthesized claim clock.
- **Backing:** src/app/admin/actions.ts:234-256
- **Inputs:** FormData field read: "cluster_id" only (required, non-empty). No confirmation field, no reason field.
- **Writes:** issue_clusters.admin_override = false; issue_clusters.lifecycle_reason = NULL; issue_clusters.fix_claimed_at = NULL; issue_clusters.fix_claimed_patch_version = NULL
- **Guard:** requireAdmin() at actions.ts:235; assertProductionWriteAllowed() at :236.
- **Revalidates:** revalidatePath("/admin") (actions.ts:254); revalidatePublicSurfaces() (actions.ts:255)
- **On failure:** Empty cluster_id -> "bad input". Update error -> raw Postgres message, no revalidation. Unknown cluster id -> zero rows matched, no error, silent success.
- **Tests:** tests/adminActions.test.ts:289-311
- **Quirks:** 1) It does NOT reset issue_clusters.fix_status — the hand-set value (e.g. verified_fixed) stays in the column after the lock is released; only computeClusterLifecycle's unlocked path (src/lib/lifecycle.ts:66-96) stops honoring it at read time. A redesign that starts trusting the stored column directly would resurrect stale manual statuses. 2) Nulling fix_claimed_at/fix_claimed_patch_version is not undoable by any control — setClusterFixStatus can re-stamp a NEW clock at now(), but the original claim timestamp is gone. 3) No confirmation step, unlike the visibility break-glass which requires reason + checkbox. 4) Once cleared, the row usually disappears from the exception ledger entirely (it no longer matches the admin_override filter), so the Clear button destroys its own row's visibility.

#### `lifecycle-clear-cluster-id-hidden` — (hidden) cluster_id — clear form

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions disclosure > inside the Clear form.
- **Does:** Carries the issue_clusters.id whose lock is being released.
- **Backing:** src/app/admin/page.tsx:215
- **Inputs:** type=hidden, name="cluster_id", value={cluster.id}.
- **Writes:** read-only (WHERE target)
- **Guard:** Non-empty check only (actions.ts:238).
- **Revalidates:** —
- **On failure:** Empty -> "bad input".
- **Tests:** tests/adminActions.test.ts:293
- **Quirks:** Two sibling forms in the same ledger row post the same field name to different actions (lock vs clear) — they are separate <form> elements, so merging them into one form during a redesign would break both.

#### `lifecycle-clear-submit` — Clear (pending text "Clearing...")

- **Kind:** button · **Destructive:** irreversible
- **Reach:** /admin > Lifecycle exceptions disclosure > appears only on rows where cluster.admin_override is true.
- **Does:** Releases the manual lifecycle lock on that cluster.
- **Backing:** src/app/admin/page.tsx:213-220 (conditional render), SubmitButton at :216-218
- **Inputs:** No own field.
- **Writes:** issue_clusters.admin_override, lifecycle_reason, fix_claimed_at, fix_claimed_patch_version
- **Guard:** requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** /admin; public surfaces
- **On failure:** Disabled while pending. Errors surface as bare server-action errors.
- **Tests:** tests/adminActions.test.ts:295
- **Quirks:** CONDITIONAL CONTROL — invisible unless admin_override is true (page.tsx:213). A redesign that renders it unconditionally would expose a destructive claim-clock wipe on unlocked clusters. Visually identical to the Lock button next to it (same tap-btn tap-btn--sm class) despite one being reversible and the other destroying data.

#### `set-cluster-visibility-override-action` — setClusterVisibilityOverride (server action)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /admin > "Visibility overrides" disclosure — two entry points: the per-card "Reset to automatic" form, and the search-and-create form inside VisibilityOverrideBrowser.
- **Does:** Break-glass writer for the promotion engine: forces a cluster public or hidden (with a recorded reason), or returns it to engine control; then recomputes effective visibility unless the cluster was just force-hidden.
- **Backing:** src/app/admin/actions.ts:197-232
- **Inputs:** FormData fields read: "cluster_id" (required, non-empty), "visibility" (required, one of auto\|force_public\|force_hidden), "reason" (trimmed, sliced to 500; required only when visibility !== 'auto', must be >= 3 chars), "confirm_override" (must equal the literal string "true"; required only when visibility !== 'auto').
- **Writes:** via RPC set_cluster_visibility_override (supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:424-483): issue_clusters.visibility_restore_is_public, issue_clusters.visibility_restore_auto_public, issue_clusters.admin_visibility_override, issue_clusters.admin_visibility_reason, issue_clusters.admin_visibility_changed_at, issue_clusters.auto_public, issue_clusters.is_public, issue_clusters.visibility_revision; on force_hidden the same RPC also writes, for every signal in the cluster: source_signals.public_status='hidden', source_signals.promoted_at=NULL, source_signals.promotion_reason='admin_force_hidden'; then (when visibility !== 'force_hidden') refreshClusterVisibility -> apply_cluster_visibility_refresh writes source_signals.public_status/promoted_at/promotion_reason and issue_clusters.signal_count/direct_report_count/verified_report_count/public_signal_count/last_signal_at/auto_public/is_public/visibility_restore_*/visibility_revision
- **Guard:** requireAdmin() at actions.ts:198; assertProductionWriteAllowed() at :199. The RPC itself is security invoker with EXECUTE granted only to service_role (migration :485-486); the app calls it with the service client.
- **Revalidates:** revalidatePath("/admin") and revalidatePublicSurfaces() — both inside a finally block (actions.ts:226-231), so they run even when the follow-up refresh throws
- **On failure:** Bad enum -> "bad input". Missing reason/confirmation on a force -> "override reason and confirmation required". RPC error -> rethrown raw UNLESS it is specifically a missing-signature error naming set_cluster_visibility_override (isMissingSupabaseRpc, src/lib/supabaseCompatibility.ts:44-55), in which case it retries the legacy 2-argument signature WITHOUT the reason; a legacy retry failure throws. A refresh failure after a successful RPC propagates the error but the override has already landed and the finally block still revalidates (tests/adminActions.test.ts:406).
- **Tests:** tests/adminActions.test.ts:313-440 (force_public refreshes; force_hidden skips the refresh; auto clears; legacy-RPC retry; real RPC failure not masked; revalidate-on-refresh-failure; unknown value rejected; reason+confirmation required)
- **Quirks:** 1) The legacy fallback silently DROPS the reason — on a database still running the 2-arg signature the override lands with no audit text, and the UI then prints "Existing override created before reason tracking." (page.tsx:263). 2) force_hidden deliberately skips refreshClusterVisibility (actions.ts:227) because the RPC already hid the signals; a redesign that "simplifies" that condition would re-promote signals it just hid. 3) revalidation lives in a finally — moving it changes error behavior. 4) 'auto' bypasses the reason+confirmation requirement entirely, so un-forcing is unaudited and admin_visibility_reason is set to NULL, erasing why the force existed. 5) The DB carries a CHECK constraint requiring reason+changed_at whenever admin_visibility_override is set (migration 20260722170106:410-420), so any redesign that writes these columns directly instead of through the RPC will violate it.

#### `visibility-reset-to-auto-form` — Reset to automatic (pending text "Resetting...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides disclosure > top-right of each active override card (one card per forced cluster).
- **Does:** Posts visibility=auto for that cluster: clears the force, restores the engine's saved baseline, and recomputes visibility.
- **Backing:** src/app/admin/page.tsx:255-261 (form with two hidden inputs + SubmitButton)
- **Inputs:** Hidden: name="cluster_id" value={cluster.id} (page.tsx:256); hidden name="visibility" value="auto" (page.tsx:257). No reason field, no confirmation checkbox.
- **Writes:** issue_clusters.admin_visibility_override=NULL, admin_visibility_reason=NULL, admin_visibility_changed_at=NULL, is_public/auto_public restored from visibility_restore_*, visibility_restore_* = NULL, visibility_revision++; then a full refreshClusterVisibility pass over source_signals and issue_clusters stats
- **Guard:** requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** /admin; /, /issues, /report, /scanner + the three public tags
- **On failure:** Disabled while pending. RPC/refresh errors surface as server-action errors; revalidation still runs via the finally.
- **Tests:** tests/adminActions.test.ts:350-364
- **Quirks:** HIDDEN-INPUT-DRIVEN BEHAVIOR: this button and the break-glass Apply button call the SAME action; only the hidden visibility=auto value distinguishes them, and only the auto path skips the reason+confirmation gate. A redesign that consolidates the two forms must keep that hidden field. One click here immediately re-exposes or re-hides a cluster on the public board with no confirmation, in contrast to the heavily gated forward direction. The card only renders when admin_visibility_override is set (page.tsx:46, :240-270).

#### `override-browser-disclosure` — Create a new override →

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Visibility overrides disclosure > below the active-override cards (always rendered, even when no overrides are active).
- **Does:** Opens the search-based creator for a new break-glass visibility override.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:27-29 (<details>/<summary>, aria-label "Create visibility override")
- **Inputs:** None. Receives autoRows (clusters with NO active override) as props from src/app/admin/page.tsx:272.
- **Writes:** read-only
- **Guard:** Client component; the page it renders inside is behind requireAdmin() (src/app/admin/page.tsx:25).
- **Revalidates:** —
- **On failure:** n/a — pure disclosure.
- **Tests:** —
- **Quirks:** It is a nested <details> inside the page's own <details> (page.tsx:227) — two levels of disclosure before any control is reachable. The entire returned cluster array is shipped to the client as props on every /admin render, even when the disclosure is never opened; until pagination lands, that array can itself be service-truncated.

#### `override-browser-search-input` — Issue title (search box)

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > first field.
- **Does:** Filters engine-owned clusters by case-insensitive title substring; nothing renders until 2+ characters are typed.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:40-48 (input) and :18-24 (filter, RESULT_LIMIT = 8 at :13)
- **Inputs:** type=search, controlled React state, no name attribute — this value is NEVER submitted, it only gates which result rows render.
- **Writes:** read-only (client-side filter)
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** < 2 chars -> empty result set with the status line "Type at least 2 characters..."; no matches -> "No matching engine-owned issues." (VisibilityOverrideBrowser.tsx:50-56).
- **Tests:** —
- **Quirks:** Hard cap of 8 results with a "+" suffix when more match — a cluster past the cap is UNREACHABLE until the operator types a narrower query; there is no pagination and no way to browse without searching. Substring match on title only (not category, not id), so an operator who knows the cluster id cannot find it here. The aria role=status line is the only feedback channel.

#### `override-create-row-disclosure` — <cluster title> · PUBLIC|PRIVATE · ENGINE OWNED · "Override…"

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > one <details> per search result (max 8).
- **Does:** Expands the break-glass form for that one cluster.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:60-65
- **Inputs:** None; the summary shows current is_public state as PUBLIC/PRIVATE plus the fixed "ENGINE OWNED" tag.
- **Writes:** read-only
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** —
- **Quirks:** Third nesting level of <details>. The PUBLIC/PRIVATE label is the cluster's CURRENT effective visibility while the select below defaults to force_hidden — so on an already-private cluster the default action is a no-visible-change write that still stamps an override, a reason, and a revision bump.

#### `override-cluster-id-hidden` — (hidden) cluster_id — break-glass form

- **Kind:** form · **Destructive:** none
- **Reach:** Inside each expanded override-create row.
- **Does:** Carries the target cluster id for the new override.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:67
- **Inputs:** type=hidden, name="cluster_id", value={cluster.id}.
- **Writes:** read-only (RPC argument)
- **Guard:** Non-empty check (actions.ts:204); the RPC raises P0002 "issue cluster not found" for an unknown id.
- **Revalidates:** —
- **On failure:** Unknown id -> RPC raises, action throws the raw message.
- **Tests:** —
- **Quirks:** Unlike the lifecycle lock path, an unknown cluster id here is a hard error rather than a silent no-op — the two lock surfaces behave differently for the same class of mistake.

#### `override-visibility-select` — Temporary visibility — Force hidden / Force public

- **Kind:** select · **Destructive:** reversible
- **Reach:** Inside each expanded override-create row, first field.
- **Does:** Chooses the direction of the break-glass force.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:69-74
- **Inputs:** name="visibility", defaultValue="force_hidden". Options offered: force_hidden, force_public. "auto" is valid server-side but never offered here.
- **Writes:** issue_clusters.admin_visibility_override (+ is_public/auto_public/restore columns via the RPC); source_signals.public_status/promoted_at/promotion_reason when force_hidden
- **Guard:** Membership in VISIBILITY_OVERRIDES (actions.ts:204) plus the RPC's own IN-list.
- **Revalidates:** —
- **On failure:** Missing/unknown -> "bad input".
- **Tests:** tests/adminActions.test.ts:314-348
- **Quirks:** Defaults to the DESTRUCTIVE direction (force_hidden) — the safer read of the label "Temporary visibility" would be no default at all. The word "Temporary" is aspirational: nothing expires the override, only a manual Reset to automatic clears it. force_hidden also mass-hides every signal in the cluster, which Reset-to-automatic only undoes indirectly by recomputation.

#### `override-reason-textarea` — Why are you overriding the engine?

- **Kind:** text-input · **Destructive:** none
- **Reach:** Inside each expanded override-create row, second field.
- **Does:** Records the audit reason stored on the cluster and shown on the active-override card.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:75-78 (textarea, minLength=3, maxLength=500, required)
- **Inputs:** name="reason"; server trims and slices to 500 (actions.ts:202) and requires length >= 3 for non-auto (actions.ts:205); the RPC re-checks btrim length between 3 and 500 (migration 20260722170106:438-440).
- **Writes:** issue_clusters.admin_visibility_reason
- **Guard:** Validated in three layers: client attributes, action, and RPC.
- **Revalidates:** —
- **On failure:** < 3 chars or absent on a force -> "override reason and confirmation required". On a legacy database the reason is dropped by the fallback retry and never stored.
- **Tests:** tests/adminActions.test.ts:430-439
- **Quirks:** This text is rendered back verbatim on the override card (page.tsx:263) with no escaping concerns but also no length clamp in the UI. It is the ONLY record of why a cluster's public state was forced, and Reset to automatic deletes it.

#### `override-confirm-checkbox` — I understand this immediately changes the public Issue Board until I reset it.

- **Kind:** checkbox · **Destructive:** none
- **Reach:** Inside each expanded override-create row, third field.
- **Does:** Explicit break-glass confirmation; must be checked for any force.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:79-82 (required checkbox, value="true")
- **Inputs:** name="confirm_override", value="true". Server compares strictly to the string "true" (actions.ts:203).
- **Writes:** read-only (gate only — never persisted)
- **Guard:** Enforced at actions.ts:205 for non-auto values only.
- **Revalidates:** —
- **On failure:** Unchecked -> the field is absent from FormData -> "override reason and confirmation required".
- **Tests:** tests/adminActions.test.ts:430-439
- **Quirks:** The confirmation is NOT recorded anywhere — nothing distinguishes an acknowledged override from one posted directly to the action. The exact string "true" is load-bearing: changing the checkbox value attribute silently disables the gate's ability to pass. This gate does not apply to the reverse (Reset to automatic), which is equally public-facing.

#### `override-apply-submit` — Apply break-glass override (pending text "Applying...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** Inside each expanded override-create row, last control.
- **Does:** Forces the selected cluster public or hidden immediately.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:83-85 (SubmitButton, class tap-btn tap-btn--danger)
- **Inputs:** No own field; submits cluster_id, visibility, reason, confirm_override.
- **Writes:** issue_clusters override + visibility columns; source_signals rows on force_hidden (see the action)
- **Guard:** requireAdmin() + assertProductionWriteAllowed() inside the action.
- **Revalidates:** /admin; /, /issues, /report, /scanner + PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG
- **On failure:** Disabled while pending. Errors surface as bare server-action errors with no inline message; the disclosure state resets on the resulting re-render.
- **Tests:** tests/adminActions.test.ts:314-348
- **Quirks:** COUPLING: after a successful apply the cluster leaves autoRows and appears in forcedRows above, so this form disappears for that cluster. To flip force_public -> force_hidden you must first Reset to automatic (which momentarily returns the cluster to engine control and may publish it) and then search for it again — there is no direct switch. The only red/danger-styled button in the whole partition.

#### `set-current-patch-override-action` — setCurrentPatchOverride (server action)

- **Kind:** server-action · **Destructive:** irreversible
- **Reach:** /admin > "Current patch override" disclosure > the form is the disclosure body itself.
- **Does:** Break-glass writer for the current patch pointer when the Pearl Abyss notice scraper stops matching: demotes whatever row is current and installs a synthetic manual row.
- **Backing:** src/app/admin/actions.ts:263-279
- **Inputs:** FormData field read: "patch_version" (trimmed; must match /^\d+\.\d{1,2}(\.\d{1,2})?$/ via isValidPatchVersion, src/lib/officialPatch.ts:64-68). Nothing else is read — no reason, no confirmation.
- **Writes:** via RPC set_current_patch_override (supabase/migrations/20260710021010_atomic_current_patch_override.sql:1-57): official_patch_notes.is_current = false for every currently-current row; then upsert on board_no of a row with board_no='manual-<version>', title='Manual override: Patch <version>', patch_version=<version>, official_url='https://crimsondesert.pearlabyss.com/en-US/News/Notice', published_at=NULL, summary=NULL, observed_at=<now>, is_current=true
- **Guard:** requireAdmin() at actions.ts:264; assertProductionWriteAllowed() at :265. RPC EXECUTE granted only to service_role (migration :59-62).
- **Revalidates:** revalidatePath("/admin") (actions.ts:277); revalidatePublicSurfaces() (actions.ts:278) — includes CURRENT_PATCH_TAG, which is what unstable_cache keys the current-patch reads on (src/lib/officialPatch.server.ts:95-100)
- **On failure:** Malformed version -> "bad input" thrown before the client is created, no writes (tests/adminActions.test.ts:843-852). RPC error -> raw message thrown, nothing revalidated; the RPC takes an advisory lock and does both statements in one transaction, so a failure cannot leave the site with zero current patches (tests:879-889). Vercel preview -> "preview writes disabled" (tests:869-877).
- **Tests:** tests/adminActions.test.ts:842-889
- **Quirks:** 1) NOT reversible by any control in this app: the only thing that reclaims the pointer is the scheduled automation run calling syncOfficialPatchNote (src/lib/automation/run.ts:2504) and successfully scraping a real notice. Re-running the override with a different version just installs another manual row. 2) The manual row is PERMANENT — no delete control exists — and getTrackedPatchEditionCount counts DISTINCT patch_version across the whole table (src/lib/officialPatch.server.ts:162-173), so a typo'd version permanently inflates the masthead's edition number. 3) While a manual row is current, the public claims register goes EMPTY: readClaimedFixesForCurrentPatch looks up official_patch_claimed_fixes by the current board_no (src/lib/officialPatch.server.ts:278-331) and a 'manual-*' board has no fix rows. 4) The RPC re-validates the same version regex independently — both copies must change together. 5) Changing the current patch silently re-buckets every patch-family read (excerpts, signal eligibility, lifecycle claim matching), so this one field moves far more of the public site than its placement suggests.

#### `patch-version-input` — New current patch

- **Kind:** text-input · **Destructive:** irreversible
- **Reach:** /admin > Current patch override disclosure > the only field.
- **Does:** Types the version string to install as current.
- **Backing:** src/app/admin/page.tsx:297-308 (label + input; id=patch_version_override)
- **Inputs:** name="patch_version", required, pattern={PATCH_VERSION_SHAPE.source} (mirrors the server regex), title="Version like 1.13.02", placeholder = the CURRENT version, width 130px.
- **Writes:** official_patch_notes.board_no / title / patch_version / official_url / published_at / summary / observed_at / is_current (via the RPC)
- **Guard:** Client pattern + server isValidPatchVersion + the RPC's own regex.
- **Revalidates:** —
- **On failure:** Empty -> blocked client-side by required; server would throw "bad input". Wrong shape -> browser validation message, or "bad input" if posted directly.
- **Tests:** tests/adminActions.test.ts:843-852
- **Quirks:** The placeholder shows the current version, which reads like a prefilled default but submits nothing — an operator who clicks Set current patch without typing gets a browser validation error, not a no-op. There is no confirmation step and no preview of what the override will do, despite this being the widest-reaching write on the page.

#### `set-current-patch-submit` — Set current patch (pending text "Saving...")

- **Kind:** button · **Destructive:** irreversible
- **Reach:** /admin > Current patch override disclosure > right of the input.
- **Does:** Installs the typed version as the site-wide current patch.
- **Backing:** src/app/admin/page.tsx:309-311 (SubmitButton)
- **Inputs:** No own field.
- **Writes:** official_patch_notes (see the action)
- **Guard:** requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** /admin; /, /issues, /report, /scanner + PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG
- **On failure:** Disabled while pending. Errors surface as bare server-action errors.
- **Tests:** tests/adminActions.test.ts:853-868
- **Quirks:** Styled tap-btn tap-btn--sm — identical weight to the reversible Lock/Clear buttons, despite being the only irreversible non-content write in the partition. The disclosure summary's status chip (green "Synced <v>" vs amber "Fallback <v>", page.tsx:283-290) is the only signal that an override is currently in effect, and it reads 'official' for a MANUAL row too — a manual override still reports source='official' (src/lib/officialPatch.server.ts:55-65), so the chip says "Synced" while the site is running on a hand-typed value. That is a label that does not match reality and a redesign should fix or preserve knowingly.

**Surface notes.** SCOPE: this covers src/app/admin/actions.ts lines 1-280 (module setup + signOutAdmin, moderateReport, setClusterFixStatus, setClusterVisibilityOverride, clearClusterFixStatusOverride, setCurrentPatchOverride) and every widget that posts to them. The three <details> containers on /admin that host these forms — "Lifecycle exceptions" (src/app/admin/page.tsx:171-225), "Visibility overrides" (:227-274), "Current patch override" (:276-313) — plus the four stat-band tiles (:70-97) and the "Flagged for review" band header (:99-110) belong to the /admin page partition; I list them here only so nothing falls between partitions. Actions at lines 281-728 (compileDossier, runRedditMonitor, setAutomationPaused, setScannerPolicy, recordScannerDecision, rejectObservationAndTeach, rescueRejectedCandidate, undoScannerDecision) are out of my partition.  SHARED GUARD SHAPE: five of the six actions open with the identical pair requireAdmin() then assertProductionWriteAllowed(). signOutAdmin has NEITHER. requireAdmin redirects (does not throw a 403), so an expired session on any of these submits lands the operator on /admin/login with the submitted work lost — there is no draft preservation anywhere.  NO ERROR SURFACE: not one control in this partition has an inline error state. Every failure path is `throw new Error(...)` out of a server action; /admin has no error.tsx of its own that I found in src/app/admin/. The operator sees a generic failure, never the message. Any redesign that adds useActionState-style inline errors is adding capability, and any redesign that assumes errors are already displayed is wrong.  NO CONFIRMATION EXCEPT ONE: the only confirmation gate in the partition is the visibility break-glass (reason >= 3 chars + confirm_override checkbox). Approve-with-excerpt (permanent public text), Clear (wipes the claim clock), Reset to automatic (immediately republishes or hides a cluster), and Set current patch (re-buckets the entire site) all fire on a single click.  PENDING STATES ARE INCONSISTENT: Lock, Clear, Reset to automatic, Apply override, and Set current patch use SubmitButton (disabled + aria-busy while pending, src/components/SubmitButton.tsx). The three moderation buttons (Approve/Reject/Spam) and Sign out are plain <button>s with no pending state — Approve in particular can be double-submitted into duplicate public excerpts.  REVALIDATION IS UNIFORM AND WIDE: every write action ends with revalidatePath("/admin") + revalidatePublicSurfaces(), which busts three cache tags and four public paths (src/lib/revalidate.ts:10-22). revalidatePublicSurfaces swallows its own errors. Only setClusterVisibilityOverride puts the revalidation in a finally block; the rest revalidate only on success.  DATA REACHABILITY IS THE HIDDEN CONSTRAINT: the moderation queue lists only pending reports (limit 50, oldest first). The lifecycle lock/clear forms render only for clusters already flagged "Needs review:" or already locked. The override reset renders only for already-forced clusters, and the override creator only lists never-forced clusters and only after 2+ typed characters, capped at 8 results. A redesign that changes any of these filters changes which records are reachable at all, not just how they look.  CROSS-ACTION COUPLING WORTH PRESERVING: (a) approve -> DB trigger publishes the cluster -> best-effort deep refresh, in that order, with the excerpt insert deliberately before the refresh; (b) force_hidden intentionally skips the deep refresh while every other visibility value runs it; (c) Lock and Clear are two sibling forms writing overlapping columns on the same row, where Clear leaves fix_status behind; (d) the visibility action's behavior is switched entirely by a hidden input value (auto vs force_*), which is also what bypasses its confirmation gate.  ORPHANS FOUND: DELETE /api/admin/login (src/app/api/admin/login/route.ts:29-33) clears the same session cookie and has no caller in src/ — a second sign-out path that today is dead. 'acknowledged' is a valid FIX_STATUS the lock UI never offers but the action still accepts, and legacy rows holding it get silently rewritten to 'reported' by the select's fallback.

### Server actions: dossier compile + scanner run + automation switches — src/app/admin/actions.ts:281-469 (compileDossier, runRedditMonitor, setAutomationPaused, setScannerPolicy) plus their only UI surfaces: /admin/compile and the admin-only right rail of /scanner

_18 controls · partition `inv:actions-compile-automation`_

#### `compile-dossier-action` — compileDossier

- **Kind:** server-action · **Destructive:** none
- **Reach:** /admin (nav) > Compile > form at the top of /admin/compile; the only caller is src/app/admin/compile/page.tsx:59
- **Does:** Reads six data sets, builds one deterministic Markdown dossier, and, only when opted in, sends that complete Markdown to a free OpenRouter model for a prose rewrite before inserting a new dossier_runs row and redirecting to it. The provider payload includes private approved-report issue titles, reproduction steps, and evidence URLs; unpublished issue-cluster titles, fix status, and confidence; and public source URLs.
- **Backing:** src/app/admin/actions.ts:281-396 (helpers at :79-109; builder src/lib/dossier.ts:58; AI src/lib/ai.ts:35-65)
- **Inputs:** use_ai — checkbox, honored only when the literal string is "on" AND features().ai is true (src/app/admin/actions.ts:284,375). No other inputs; no limits or pagination the operator can set.
- **Writes:** dossier_runs.markdown; dossier_runs.provider; dossier_runs.stats (jsonb: totalSignals, totalDirectReports, totalVerifiedReports, pendingCount); dossier_runs.id / dossier_runs.created_at via table defaults; READS ONLY: rows returned by one unpaginated approved-bug_reports select (category, platform, cluster_id, evidence_url, repro_steps, issue_title), an exact bug_reports pending head-count, rows returned by one unpaginated issue_clusters select (id, title, fix_status, confidence), rows returned by one unpaginated public source_signals select (cluster_id, source, source_url, title, summary, category, observed_at), approved_excerpts + joined bug_reports (newest 1000), official_patch_notes via getCurrentPatchMetadata. The three unpaginated row reads can stop at the hosted service cap.
- **Guard:** await requireAdmin() at :282 — src/lib/adminGuard.ts:20 redirects to /admin/login when the signed ADMIN_COOKIE fails verifySessionToken. Then assertProductionWriteAllowed() at :283 — src/lib/previewGuard.ts:7 throws "preview writes disabled" when VERCEL_ENV==='preview'.
- **Revalidates:** NONE — compileDossier calls no revalidatePath/revalidateTag at all. Freshness comes only from redirect(`/admin/compile?run=<id>`) at :395 plus `export const dynamic = "force-dynamic"` on src/app/admin/compile/page.tsx:8.
- **On failure:** Any of the five Supabase reads failing throws `<label> read failed: <message>` (throwReadError, :83-85) BEFORE any write, so nothing is persisted — labels are "approved reports", "issue clusters", "community signals", "verified reports", "pending reports". getCurrentPatchMetadata never throws: it silently degrades to the hardcoded fallback patch (src/lib/officialPatch.server.ts:79-93), so a broken patch table produces a dossier titled with that version instead of an error. AI drafting failure is invisible: draftDossierWithAi returns null on non-2xx, non-free cost, short content, or a caught throw, and the action keeps deterministic markdown. A hung fetch has no timeout and may never reach that fallback. The final insert failing throws error.message and writes nothing.
- **Tests:** tests/dossier.test.ts covers only the pure builder. tests/adminActionsAuth.test.ts:149-186 covers compileDossier's unauthenticated stop-before-work boundary. tests/ai.test.ts pins the free-model routing (`data_collection: "deny"`, `zdr: true`) but does not prove a representative complete generated user message containing every private approved-report and unpublished-cluster field, unchecked/disabled no-call paths, timeout fallback, or rejection of a missing heading/altered table/fact. Its authorized read/assemble/insert/redirect and AI-fallback paths remain untested.
- **Quirks:** Not idempotent — every submit appends another dossier_runs row; double-clicking produces duplicate runs with no dedupe, no upsert, no run key. Partial failure leaves nothing behind (single write, last), so the real risk is the opposite: silent degradation. The AI path sends the entire generated dossier, including private approved-report issue titles, repro notes, and evidence URLs plus unpublished cluster titles/status/confidence, even though approval makes only the approved excerpt public and hidden clusters are not public output; the live UI does not disclose that complete external transfer. Provider routing requires deny-collection and ZDR, but src/lib/ai.ts:40 issues the fetch with NO timeout/AbortController and accepts any free content longer than 200 characters without validating the canonical headings, eight-column table, facts, lists, URLs, statuses, confidence, or caveats. `.single()` result is used as run.id at :395 with no null check. approved_excerpts is capped at the newest 1000 rows (:313) — verifiedReportCount silently under-counts past that. issue_clusters is read unfiltered (no patch, no visibility filter), so force_hidden clusters still feed counts and provider prose; only clusters with evidence>0 reach the Top issues table (src/lib/dossier.ts:60). Only public_status='public' signals are counted, so the dossier's signal totals will not match any admin-side lead count. dossier_runs.provider is load-bearing UI: the page prints "DETERMINISTIC" vs "AI DRAFT · <PROVIDER>" from it (compile/page.tsx:21-23).

#### `compile-use-ai-checkbox` — Draft with AI (free OpenRouter prose model) / "Draft with AI: disabled, no AI key configured"

- **Kind:** checkbox · **Destructive:** none
- **Reach:** /admin/compile > compile band, left of the Compile now button
- **Does:** Opts this one compile into an AI prose rewrite of the complete deterministic dossier. That OpenRouter user message includes private approved-report issue titles, reproduction steps, and evidence URLs; unpublished issue-cluster titles, fix status, and confidence; and public source URLs. Aggregates stay deterministic either way.
- **Backing:** src/app/admin/compile/page.tsx:60-66 (input at :64); consumed at src/app/admin/actions.ts:284,375-378
- **Inputs:** name="use_ai", unchecked by default, browser-default value "on"; `disabled={!aiAvailable}` where aiAvailable = features().ai (src/lib/env.ts:30 — needs OPENROUTER_API_KEY plus an approved automation model).
- **Writes:** External: sends the complete generated Markdown to OpenRouter with deny-collection and ZDR routing requirements. Stored: dossier_runs.markdown (AI prose instead of deterministic text); dossier_runs.provider ('openrouter' instead of 'deterministic').
- **Guard:** Client-side disabled attribute only; the real gate is the server re-checking `useAi && features().ai` at src/app/admin/actions.ts:375.
- **Revalidates:** —
- **On failure:** Caught provider failures and short/paid responses keep the deterministic markdown and provider, and NOTHING tells the operator the AI leg was attempted and lost — the only clue is the DETERMINISTIC label. A hung request has no timeout. A long but structurally altered response is treated as success rather than failure.
- **Tests:** tests/ai.test.ts:35-56 pins the provider routing but not a representative complete compileDossier user message containing every private approved-report and unpublished-cluster field or the no-opt-in/no-call boundary.
- **Quirks:** The live label says only "free OpenRouter prose model" and the adjacent note says AI rewrites prose; neither discloses the complete private/unpublished transfer nor that prose-only preservation is prompt-only and unvalidated. The label text itself changes on the disabled path, and the whole <label> is dimmed via an inline style (color: var(--dispatch-faint)) rather than a class — a redesign that drops the inline style loses the disabled affordance. The checkbox is unchecked on every page load; there is no remembered preference. The server compares to the literal "on", so any redesign that gives the input an explicit value="true" silently disables AI drafting forever.

#### `compile-submit` — Compile now

- **Kind:** button · **Destructive:** none
- **Reach:** /admin/compile > compile band
- **Does:** Submits the compile form, running compileDossier and navigating to the new run.
- **Backing:** src/app/admin/compile/page.tsx:67 (<button className="dispatch-btn"> inside <form action={compileDossier}>)
- **Inputs:** No name/value; plain submit for the surrounding form.
- **Writes:** dossier_runs (one row, via compileDossier)
- **Guard:** Inherits compileDossier's requireAdmin + assertProductionWriteAllowed.
- **Revalidates:** redirect to /admin/compile?run=<id> only
- **On failure:** A thrown action error surfaces as a Next server-action error; the button has no pending state, so a slow AI leg looks like a dead button and invites repeat clicks (which create extra dossier_runs rows).
- **Tests:** —
- **Quirks:** Unlike the scanner settings form, this submit is a bare <button>, NOT the shared <SubmitButton> with useFormStatus pending text (src/components/SubmitButton.tsx:6-21). That inconsistency is the single biggest UX gap on this surface and is easy to lose track of in a redesign.

#### `compile-page-load-reads` — CompilePage (automatic on load)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Any GET of /admin/compile, with or without ?run=
- **Does:** Guards the page, lists the ten most recent dossier runs, and — when ?run=<id> is present — loads that run's markdown/provider/created_at for display.
- **Backing:** src/app/admin/compile/page.tsx:25-41 (requireAdmin :26; runs list :31-35; single run :39)
- **Inputs:** searchParams.run — an arbitrary string passed straight into .eq("id", run).single().
- **Writes:** read-only
- **Guard:** await requireAdmin() at src/app/admin/compile/page.tsx:26 (redirect to /admin/login).
- **Revalidates:** N/A — `export const dynamic = "force-dynamic"` (:8) means the page is never cached
- **On failure:** Both reads discard their error objects: `const { data: runs }` (:31) and `const { data }` (:39). A failing list read renders "No runs yet."; a failing or non-existent single read renders no output block at all. Neither says anything went wrong.
- **Tests:** No page-read regression forces either query to fail. Phase 4 requires one for the newest-10 list and one for the selected-run path.
- **Quirks:** An invalid ?run= value is indistinguishable from "no run selected" — no not-found state. The runs list is hard-capped at 10 with no pagination, so older dossiers become unreachable through the UI even though the rows persist. Phase 4 must surface the list failure and distinguish selected-run missing/malformed state from other selected-run read failures; the success-state status remains neutral **On demand**, never a green zero.

#### `compile-previous-run-link` — <formatted run date, e.g. "Jul 25, 2026, 3:04 PM">

- **Kind:** link · **Destructive:** none
- **Reach:** /admin/compile > Previous runs list
- **Does:** Loads that historical dossier run into the output box.
- **Backing:** src/app/admin/compile/page.tsx:88-95 (anchor at :90, href=`/admin/compile?run=${item.id}`)
- **Inputs:** None beyond the run id embedded in the href.
- **Writes:** read-only
- **Guard:** Page-level requireAdmin.
- **Revalidates:** —
- **On failure:** A deleted/invalid id renders the page with no output block and no message.
- **Tests:** —
- **Quirks:** Plain <a>, not next/link — full page reload each time. Label is a date rendered in America/New_York with no year-agnostic fallback (runDateLabel, :10-19); two runs in the same minute are visually identical. Ordering is created_at desc and is load-bearing: the newest run is the top link.

#### `compile-copy-dossier` — Copy to clipboard → "Copied ✓" / "Copy failed — select the text instead"

- **Kind:** button · **Destructive:** none
- **Reach:** /admin/compile > below the dossier output box (only when a run is loaded)
- **Does:** Copies the already-generated dossier markdown to the clipboard.
- **Backing:** src/components/DossierOutput.tsx:18-36
- **Inputs:** None; operates on the markdown prop.
- **Writes:** read-only (clipboard only)
- **Guard:** None beyond the page guard; it never touches the server.
- **Revalidates:** —
- **On failure:** navigator.clipboard rejection flips the label to "Copy failed — select the text instead" for 2500ms, then back to idle. No throw, no toast.
- **Tests:** —
- **Quirks:** Label is a tri-state that doubles as the only error channel — a redesign that turns this into an icon-only button destroys the failure message. State resets on a fixed 2500ms setTimeout with no cleanup on unmount. Paired with the read-only <textarea> whose onFocus select-all is the documented fallback ("Focus the box to select all.", compile/page.tsx:79) — the two are coupled, do not drop one without the other.

#### `reddit-monitor-action` — runRedditMonitor (REMOVED)

- **Kind:** server-action · **Destructive:** none
- **Status:** DELETED. The action, `src/lib/reddit.server.ts` (getRedditToken/fetchNewPosts), the `reddit` feature flag and `automationSubreddits` are all gone; there is no longer a Next server-action id to POST to.
- **Replacement tripwire:** tests/redditApiRetirement.test.ts reads the shipped `src/` tree and fails if any module imports `reddit.server`, reads `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT`, or calls the OAuth/listing endpoints. The policy now lives in a structural assertion instead of a dead action.
- **Still live:** Tavily `site:reddit.com` discovery, the old.reddit.com extraction rewrite, reddit.com domain trust, canonical Reddit URL normalization and every stored web-discovered Reddit row. `classifySignal`/`summarize` stay in `src/lib/reddit.ts` for extraction and patch-note parsing.
- **Historical schema:** the `'reddit'` value stays in the source_signals source CHECK constraint (supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:314) and `automation_runs.reddit_posts_seen` stays in the ledger, now always written as 0.

#### `automation-pause-action` — setAutomationPaused

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** ORPHANED — exported but no form or component in src/ binds to it. The only in-app pause path is the "How often → Paused" option that routes through setScannerPolicy.
- **Does:** Flips only the paused flag on the scanner policy, preserving the other five fields by reading them first.
- **Backing:** src/app/admin/actions.ts:446-455 → src/lib/automation/settings.ts:155-158 (read via getAutomationControlState :126-141, write via setScannerPolicy :143-153)
- **Inputs:** paused — string, compared with `=== "true"` at :449. Any other value, including "on", "1", "TRUE", or a missing field, resolves to false, i.e. UN-PAUSE.
- **Writes:** automation_settings.value (whole jsonb blob for key='scanner', rewritten from the normalized policy); automation_settings.updated_at (new Date().toISOString()); automation_settings.key ('scanner', upsert onConflict: 'key')
- **Guard:** requireAdmin() (:447) + assertProductionWriteAllowed() (:448). The settings-layer functions themselves have NO guard — they trust the caller and take an injected client.
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces() → PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG + /, /issues, /report, /scanner
- **On failure:** Read failure throws "automation settings read failed: <message>" and writes nothing. Write failure throws "automation settings write failed: <message>". Both happen before every revalidate call, so a failure leaves caches untouched. No optimistic locking: this is a read-modify-write, so a concurrent settings save between the read and the upsert is silently lost.
- **Tests:** tests/adminActions.test.ts:441-452 — preview blocked, no mutations, no revalidatePath; tests/adminActions.test.ts:454-472 — upserts key='scanner' with paused: true and revalidates /admin/source-monitor, /admin, /; tests/automationSettings.test.ts:155-184 — pause round-trips through the settings module
- **Quirks:** Live tests pin an action with zero UI callers — a redesign that deletes the action must delete those tests, and a redesign that keeps it should wire it to a real control. The `=== "true"` comparison is a trap: a naive checkbox named `paused` posts "on" and would UN-PAUSE the scanner while looking like it pauses it. It also normalizes on write, so any hand-edited or legacy key inside automation_settings.value is destroyed by a mere pause toggle.

#### `set-scanner-policy-action` — setScannerPolicy

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /scanner signed in as admin > right rail ("Latest run and scanner settings") > "Scanner cadence and budget" disclosure > Save settings
- **Does:** Normalizes the whole cadence-and-budget form into a six-field policy and writes it as the single automation_settings row keyed 'scanner'.
- **Backing:** src/app/admin/actions.ts:457-468 → scannerPolicyFromFormData (src/lib/automation/settings.ts:114-124) → normalizeScannerPolicy (:94-112) → setScannerPolicy (:143-153)
- **Inputs:** cadence ('60'\|'120'\|'360'\|'1440'\|'paused'), paused, minIntervalMinutes (hidden), scheduledSearchCreditsPerRun ('1'\|'2'\|'3'), monthlyTavilyCreditCap (number), monthlyLlmUsdCap (number), modelPreset (hidden). Allowed values / defaults: paused boolean default false; minIntervalMinutes ∈ {60,120,360,1440} default 60; scheduledSearchCreditsPerRun ∈ {1,2,3} default 1; monthlyTavilyCreditCap floor-clamped to 0..1000 default 1000; monthlyLlmUsdCap clamped to 0..2 default 2 (MAX_MONTHLY_LLM_USD_CAP, src/lib/automation/budget.ts:38); modelPreset only 'deepseek_v4_flash'. Every out-of-range or unparsable value silently falls back to the default rather than erroring.
- **Writes:** automation_settings.value (FULL REPLACE of the jsonb for key='scanner' — paused, minIntervalMinutes, scheduledSearchCreditsPerRun, monthlyTavilyCreditCap, monthlyLlmUsdCap, modelPreset); automation_settings.updated_at; automation_settings.key ('scanner', upsert onConflict: 'key')
- **Guard:** requireAdmin() (:458) + assertProductionWriteAllowed() (:459).
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces() → PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG + /, /issues, /report, /scanner
- **On failure:** Only the upsert can fail; it throws "automation settings write failed: <message>" before any revalidate, so the operator sees an error and stale caches. There is no validation error path at all — bad input is coerced, never rejected, so a typo saves a default instead of complaining.
- **Tests:** tests/adminActions.test.ts:475-500+ — clamps monthlyTavilyCreditCap -5 → 1000, monthlyLlmUsdCap 7 → 2, modelPreset 'expensive-model' → 'deepseek_v4_flash'; tests/automationSettings.test.ts:62-215 — defaults, per-field normalization, form-data mapping; tests/adminScannerView.test.ts:10 — mocked in the view test
- **Quirks:** HIGHEST BLAST RADIUS ON THE SURFACE. Readers of this one row: src/app/api/cron/keepalive/route.ts:32-49 (hourly cron — paused gates the whole scheduled scan via scheduledScanDecision, and minIntervalMinutes sets BOTH the automation_runs lookback window at :41 and the skip interval at :46); src/app/api/admin/scan/route.ts:25-26 (manual/dry-run scans); src/lib/automation/run.ts:2482 (monthlyBudgetUsd = monthlyLlmUsdCap); src/lib/automation/budget.ts:188-237 (credit caps, remainingRuns from minIntervalMinutes, scheduled query count from scheduledSearchCreditsPerRun, skipReasons 'tavily_credit_cap'/'llm_budget_capped'); src/lib/queries.ts:899-902, :1212, :1596-1606; src/lib/radar.server.ts:535,566-567. Two of those are PUBLIC: getPublicScannerData publishes scannerActive: !control.paused and the Patch Radar publishes paused + cadenceMinutes to the homepage — pausing is visible to every visitor, not just the operator. Passing a scannerPolicy also suppresses the 'budget_capped' skip reason entirely (budget.ts:189,207), so this policy REPLACES AUTOMATION_BUDGET_USD_MONTHLY rather than layering on it. paused is NOT honored by the manual-scan route: a paused scanner can still be run by hand. The write is a whole-blob replace with no merge and no locking. src/lib/automation/schedule.ts contributes the fallbacks a redesign must not contradict: DEFAULT_MIN_INTERVAL_MINUTES 60, a 2-minute cron jitter grace, and the rule that only mode 'scheduled'\|'manual' runs with status != 'skipped' block the next scan.

#### `scanner-settings-disclosure` — Scanner cadence and budget

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > right rail aside, second <details> below "Scan history and diagnostics"
- **Does:** Hides the entire cadence-and-budget form behind a collapsed summary.
- **Backing:** src/components/scanner/AdminScannerView.tsx:599-616
- **Inputs:** None; native <details>/<summary>, closed by default.
- **Writes:** read-only
- **Guard:** Page-level: src/app/scanner/page.tsx:21,43-64 renders AdminScannerView only when isAdmin() is true; anonymous visitors get PublicScannerView with no settings at all.
- **Revalidates:** —
- **On failure:** N/A — no JS, no state.
- **Tests:** —
- **Quirks:** Collapsed by default and given no visual weight, yet it contains the ONLY pause control and the only spend caps in the product. It sits inside an <aside aria-label="Latest run and scanner settings">, so the accessible grouping is shared with the Latest run block — splitting them in a redesign changes that landmark. Ordering within the rail matters: Latest run, then history, then settings.

#### `scanner-cadence-select` — How often

- **Kind:** select · **Destructive:** reversible
- **Reach:** /scanner (admin) > Scanner cadence and budget > first field
- **Does:** Sets the scheduled-scan interval, and — via the 'paused' option — is the only way in the app to stop automatic scanning.
- **Backing:** src/components/scanner/AdminScannerView.tsx:604-607; mapped at src/lib/automation/settings.ts:117-118
- **Inputs:** name="cadence"; options 60 (Hourly), 120 (Every 2 hours), 360 (Every 6 hours), 1440 (Daily), paused (Paused). defaultValue = control.paused ? "paused" : String(control.minIntervalMinutes).
- **Writes:** automation_settings.value.paused; automation_settings.value.minIntervalMinutes
- **Guard:** Inherits setScannerPolicy's requireAdmin + assertProductionWriteAllowed.
- **Revalidates:** via setScannerPolicy: /admin, /scanner, /admin/source-monitor + revalidatePublicSurfaces()
- **On failure:** An unrecognized cadence value normalizes to 60 minutes with no warning.
- **Tests:** tests/automationSettings.test.ts:188-215 (form-data mapping incl. the cadence branch)
- **Quirks:** LABEL DOES NOT MATCH BEHAVIOR: a control called "How often" is the master pause switch. It is also COUPLED to the hidden minIntervalMinutes input — when 'paused' is selected the server reads cadence as paused and takes the interval from that hidden field (settings.ts:118); drop the hidden field and pausing silently resets cadence to hourly. Worse, settings.ts:117 makes `paused` default to false whenever neither `cadence` nor `paused` is posted, so ANY future setScannerPolicy form that omits both fields silently UN-PAUSES the scanner. The five options are also mirrored in cadenceLabel() (AdminScannerView.tsx:22-28) and in MIN_INTERVAL_MINUTES (settings.ts:6) — three places must change together.

#### `scanner-search-depth-select` — Search depth

- **Kind:** select · **Destructive:** reversible
- **Reach:** /scanner (admin) > Scanner cadence and budget > second field
- **Does:** Sets how many Tavily search credits a single scheduled run may request.
- **Backing:** src/components/scanner/AdminScannerView.tsx:608-610; consumed at src/lib/automation/budget.ts:217
- **Inputs:** name="scheduledSearchCreditsPerRun"; options 1 / 2 / 3 ("1 search / run" … "3 searches / run"); anything else normalizes to 1.
- **Writes:** automation_settings.value.scheduledSearchCreditsPerRun
- **Guard:** Inherits setScannerPolicy's guards.
- **Revalidates:** via setScannerPolicy (see above)
- **On failure:** Out-of-range values fall back to 1 silently.
- **Tests:** tests/automationSettings.test.ts (normalization of the 1\|2\|3 set)
- **Quirks:** Applies to SCHEDULED runs only — manual scans always request 5 queries (budget.ts:218), and an active patch burst overrides the setting to 3 (budget.ts:215-216). So the label overstates its reach. It also feeds the projected-credits sentence and the monthly cap interact: projectedMonthlyCredits = ceil(30*24*60*credits/minIntervalMinutes) (AdminScannerView.tsx:30-33), which can exceed the monthly cap the operator set right below it.

#### `scanner-tavily-cap-input` — Monthly search cap

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** /scanner (admin) > Scanner cadence and budget > third field
- **Does:** Caps total Tavily credits the scanner may consume in a calendar month.
- **Backing:** src/components/scanner/AdminScannerView.tsx:611; normalized at src/lib/automation/settings.ts:81-86; enforced at src/lib/automation/budget.ts:192-208
- **Inputs:** name="monthlyTavilyCreditCap", type=number, min=0, max=1000, step=1, defaultValue=control.monthlyTavilyCreditCap. Server: floor + clamp to 0..1000 (MAX_MONTHLY_TAVILY_CREDIT_CAP); null/blank/negative → 1000.
- **Writes:** automation_settings.value.monthlyTavilyCreditCap
- **Guard:** Inherits setScannerPolicy's guards.
- **Revalidates:** via setScannerPolicy (see above)
- **On failure:** No rejection path — bad values are coerced. Setting 0 (or exhausting the cap) makes every run skip with reason 'tavily_credit_cap' (budget.ts:208), which surfaces as the CAPPED badge (AdminScannerView.tsx:35-49).
- **Tests:** tests/adminActions.test.ts:482,497 — -5 clamps to 1000
- **Quirks:** BLANKING THE FIELD MAXIMIZES SPEND: an empty input parses to null and restores 1000, not 0 (settings.ts:71-74, 81-86). That is the opposite of what clearing a budget field implies. min=0 is a real hard-stop value with a distinct downstream meaning, so the input's zero is not a no-op. The client max=1000 duplicates MAX_MONTHLY_TAVILY_CREDIT_CAP (settings.ts:9 and budget.ts:37 — the constant exists twice); changing one without the others desyncs the form from the server.

#### `scanner-llm-cap-input` — Monthly LLM cap ($)

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** /scanner (admin) > Scanner cadence and budget > fourth field
- **Does:** Caps total OpenRouter LLM dollars the scanner may spend in a calendar month.
- **Backing:** src/components/scanner/AdminScannerView.tsx:612; normalized at src/lib/automation/settings.ts:88-92; enforced at src/lib/automation/budget.ts:200-209 and src/lib/automation/run.ts:2482
- **Inputs:** name="monthlyLlmUsdCap", type=number, min=0, max=2, step=0.25, defaultValue=control.monthlyLlmUsdCap. Server clamps to 0..2 (MAX_MONTHLY_LLM_USD_CAP, budget.ts:38); null/blank/negative → 2.
- **Writes:** automation_settings.value.monthlyLlmUsdCap
- **Guard:** Inherits setScannerPolicy's guards.
- **Revalidates:** via setScannerPolicy (see above)
- **On failure:** Coerced, never rejected. 0 or exhausted → skip reason 'llm_budget_capped' (budget.ts:209); this is the only skip reason that still permits paid search (budget.ts:211), so a $0 LLM cap degrades scans to keyword extraction rather than stopping them.
- **Tests:** tests/adminActions.test.ts:483,498 — 7 clamps to 2; tests/automationSettings.test.ts:62-70 — default and clamp to 2
- **Quirks:** Same blank-equals-maximum trap as the Tavily cap: clearing the field restores $2, the ceiling. This value REPLACES the AUTOMATION_BUDGET_USD_MONTHLY env budget when a policy is present (run.ts:2482, budget.ts:200) and suppresses the 'budget_capped' skip reason entirely (budget.ts:189,207) — so the env var is effectively dead while this row exists. max=2/step=0.25 hardcode MAX_MONTHLY_LLM_USD_CAP into JSX; raising the constant without touching line 612 leaves the operator unable to enter the new range.

#### `scanner-min-interval-hidden` — minIntervalMinutes (hidden input)

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** /scanner (admin) > Scanner cadence and budget > first element in the form, invisible
- **Does:** Carries the currently saved cadence so that choosing "Paused" does not destroy it.
- **Backing:** src/components/scanner/AdminScannerView.tsx:602; read at src/lib/automation/settings.ts:118 only when cadence is absent or 'paused'
- **Inputs:** type=hidden, name="minIntervalMinutes", value={control.minIntervalMinutes}.
- **Writes:** automation_settings.value.minIntervalMinutes (only on the paused branch)
- **Guard:** Inherits setScannerPolicy's guards.
- **Revalidates:** via setScannerPolicy (see above)
- **On failure:** If absent while pausing, minIntervalMinutes normalizes to the 60-minute default — the operator's daily cadence silently becomes hourly the moment they unpause.
- **Tests:** —
- **Quirks:** BEHAVIOR-CHANGING HIDDEN INPUT and the single most deletable-looking element on this surface. It looks redundant with the cadence select (and IS redundant on every branch except 'paused'), which is exactly why a redesign will drop it. Its coupling to the cadence select is the one relationship in this partition that must be carried forward verbatim.

#### `scanner-model-preset-hidden` — modelPreset (hidden input)

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Scanner cadence and budget > second element in the form, invisible
- **Does:** Posts the model preset back unchanged. Functionally inert.
- **Backing:** src/components/scanner/AdminScannerView.tsx:603; normalized at src/lib/automation/settings.ts:110
- **Inputs:** type=hidden, name="modelPreset", value={control.modelPreset}. Only 'deepseek_v4_flash' is accepted, and every other value — including a missing field — normalizes to that same string.
- **Writes:** automation_settings.value.modelPreset (always 'deepseek_v4_flash')
- **Guard:** Inherits setScannerPolicy's guards.
- **Revalidates:** via setScannerPolicy (see above)
- **On failure:** Cannot fail; unrecognized input is replaced by the only legal value.
- **Tests:** tests/adminActions.test.ts:484,499 — 'expensive-model' normalizes to 'deepseek_v4_flash'
- **Quirks:** DEAD CONTROL: allowed set has exactly one member equal to the default, so removing this input changes nothing observable — unlike the minIntervalMinutes hidden field two lines above it, which looks identical and is load-bearing. Do not treat the pair as one thing. The value it carries is a PRESET NAME ('deepseek_v4_flash'), not the model id the scanner actually calls ('deepseek/deepseek-v4-flash', budget.ts:42) — two different strings for the same concept.

#### `scanner-save-settings-submit` — Save settings (pending: "Saving...")

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Scanner cadence and budget > bottom of the form
- **Does:** Submits every field in the disclosure to setScannerPolicy in one write.
- **Backing:** src/components/scanner/AdminScannerView.tsx:614 via src/components/SubmitButton.tsx:6-21 (useFormStatus; disabled + aria-busy while pending)
- **Inputs:** No name/value; submits the enclosing <form action={setScannerPolicy}>.
- **Writes:** automation_settings row for key='scanner' (all six fields at once)
- **Guard:** Inherits setScannerPolicy's guards.
- **Revalidates:** via setScannerPolicy: /admin, /scanner, /admin/source-monitor + revalidatePublicSurfaces()
- **On failure:** A thrown action error surfaces as a Next server-action error and the disclosure keeps the entered values; nothing is revalidated.
- **Tests:** tests/adminScannerView.test.ts (view-level, with setScannerPolicy mocked)
- **Quirks:** ALL-OR-NOTHING SAVE: the action rebuilds the entire policy from this one form, so splitting cadence and budget into separate forms in a redesign would make each save reset the other's fields to defaults. Correctly uses <SubmitButton> with pending text, unlike the compile page's bare button — pick one pattern deliberately rather than by accident.

#### `scanner-projection-note` — About N scheduled Tavily credits monthly at this setting, capped at X. LLM spend stops at $Y. Cadence is Z.

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Scanner cadence and budget > sentence directly above Save settings
- **Does:** Restates the saved policy as one plain sentence, including a projected monthly credit burn.
- **Backing:** src/components/scanner/AdminScannerView.tsx:613; projection from projectedMonthlyCredits (:30-33), cadence wording from cadenceLabel (:22-28)
- **Inputs:** Derived from the `control` prop (saved state) — not from the form's current selections.
- **Writes:** read-only
- **Guard:** Admin-only page render.
- **Revalidates:** —
- **On failure:** Cannot fail independently; shows 0 projected credits whenever control.paused is true.
- **Tests:** —
- **Quirks:** STALE BY DESIGN: it reflects the last SAVED policy, so changing a select and reading the sentence shows the old numbers until the save round-trips — an operator can easily believe they already saved. The projection is uncapped arithmetic and can print a number larger than the cap it cites in the same sentence. It is also the only place the caps are stated in words, so deleting it removes the only human-readable explanation of what those two number inputs do.

**Surface notes.**

SCOPE: lines 281-469 of `src/app/admin/actions.ts` plus the two UI surfaces that reach them. Helpers at :79-109 serve compileDossier exclusively: relatedReport unwraps PostgREST's object-or-array join shape, throwReadError supplies the uniform read failure, and distinctVerifiedReports/distinctVerifiedClusterRows de-duplicate approved excerpts by report_id while keeping the newest row. Those helpers explain why dossier verified counts differ from raw excerpt counts.

TWO SURFACES, ONE PARTITION: compileDossier lives on `/admin/compile` inside `<OperatorShell active="compile">`. The remaining operator controls live on role-aware `/scanner`; `isAdmin()` selects PublicScannerView or AdminScannerView without turning the route itself private. The current compile layout is pagehead → compile form → selected `?run=` output → newest-10 history. The scanner layout places feedback left and Latest run → Scan history → Cadence and budget in a collapsed right rail. Genuine empty states that must survive are "No runs yet." and "No completed scan yet."; Phase 4 must stop Dossier list/selected-run failures and five Scanner signal/run failures from counterfeiting those ordinary empty states.

DEAD OR ORPHANED: runRedditMonitor has no UI caller and is permanently disabled; setAutomationPaused is exported and tested but has no UI caller; modelPreset is a hidden single-value input. Revalidation is asymmetric: the automation actions revalidate scanner/admin/public surfaces, while compileDossier revalidates nothing and relies on redirect plus force-dynamic. `/admin/source-monitor` is a redirect to `/scanner`, so revalidating it preserves no independent rendered page.

GUARDS AND COVERAGE: new write actions must retain `await requireAdmin()` followed by `assertProductionWriteAllowed()`. `tests/adminActionsAuth.test.ts:149-186` behaviorally covers all guarded action paths, including compileDossier, with valid mutation-shaped inputs and tripwires proving unauthenticated requests stop before DB, RPC, external, or revalidation work. That is boundary coverage only: compileDossier's authorized reads, assembly, dossier_runs insert, redirect, and AI fallback remain untested; `tests/dossier.test.ts` covers only the pure builder.

BLAST RADIUS: both scanner-policy writers replace the whole `automation_settings` JSON blob without merge or locking. That row feeds the cron, manual route, budget engine, operator desk, public scanner scoreboard, and public Patch Radar. Pausing is publicly visible but does not stop manual scans; supplying a policy also switches the budget engine away from `AUTOMATION_BUDGET_USD_MONTHLY`.

### Scanner learning loop — server actions in src/app/admin/actions.ts:470-728 (recordScannerDecision, rejectObservationAndTeach, rescueRejectedCandidate, undoScannerDecision) plus every operator control on /scanner (admin render) that invokes them

_31 controls · partition `inv:actions-scanner-feedback`_

#### `record-scanner-decision-action` — recordScannerDecision (server action)

- **Kind:** server-action · **Destructive:** state-changing
- **Reach:** /scanner (admin render) > "Teach the scanner" desk (Keep as relevant / Reject and teach…) AND "Automatic records" > Remove bad lead. One action, two target kinds.
- **Does:** Records one durable operator decision about a discovered page: on the normal RPC path it writes an immutable decision row plus one active feedback rule that teaches future scanner runs to allow or block that URL/path/domain; for target_kind=signal it also quarantines the already-kept public lead. The supported missing-RPC compatibility path for Relevant rescue writes neither decision nor rule.
- **Backing:** src/app/admin/actions.ts:470-609; RPC public.record_scanner_decision in supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:74-232
- **Inputs:** FormData: id (required, trimmed; candidate id or source_signals id); target_kind ('candidate' default \| 'signal', actions.ts:474,485); decision (relevant\|off_topic\|wrong_patch\|not_issue_report\|duplicate — SCANNER_DECISIONS, src/lib/automation/feedback.ts:4-10, validated actions.ts:483); reason (trimmed, 3-500 chars, actions.ts:486-487); scope (exact_url\|source_path\|source_domain, default exact_url, actions.ts:477,484); confirm_broad ('true' string, actions.ts:478); expires_at (date string, must parse and be in the future, actions.ts:479-480,490). Cross-field rules (actions.ts:488-489): signal targets forbid decision=relevant, forbid any scope other than exact_url, and forbid confirm_broad; any non-exact_url scope REQUIRES confirm_broad. Scope value is derived server-side by scannerRuleScopeValue (feedback.ts:69-82): exact_url=canonicalized URL, source_path=reddit r/<sub> or domain+first two path segments, source_domain=registrable domain.
- **Writes:** scanner_decisions.id/candidate_id/signal_id/target_url/target_url_hash/source_domain/decision/reason (insert; created_at, actor='admin' defaulted) — migration :153-171; scanner_feedback_rules.id/decision_id/action/decision/scope_type/scope_value/reason/confirmed_at/expires_at (insert; action='allow' iff decision='relevant', else 'block') — migration :143,173-193; scanner_feedback_rules.revoked_at + scanner_feedback_rules.superseded_by_rule_id on every prior active rule with the same scope_type+scope_value — migration :195-201; automation_rejected_candidates.decision_id / .feedback_rule_id / .decided_at (candidate branch) — migration :203-209; automation_rejected_candidates.rescued_at (candidate branch, decision='relevant' only) — actions.ts:598-602; source_signals.public_status='hidden' / .promoted_at=null / .promotion_reason='operator_feedback_blocked' (signal branch) — migration :211-217; issue_clusters.visibility_revision +1 for the signal's cluster (signal branch) — migration :223-227; signal branch then refreshClusterVisibility → apply_cluster_visibility_refresh rewrites source_signals.public_status/promoted_at/promotion_reason for the whole cluster and issue_clusters.signal_count/direct_report_count/verified_report_count/public_signal_count/last_signal_at/auto_public/is_public/visibility_revision — src/lib/automation/run.ts:1863-1877, actions.ts:537; decision='relevant' additionally runs the full rescue pipeline (see control relevant-decision-rescue-pipeline): automation_runs insert+update, source_signals insert/update, issue_clusters recompute
- **Guard:** await requireAdmin() (actions.ts:471) → src/lib/adminGuard.ts:20-22 redirects to /admin/login when the signed ADMIN_COOKIE fails verification; assertProductionWriteAllowed() (actions.ts:472) → src/lib/previewGuard.ts:7-9 throws 'preview writes disabled' when VERCEL_ENV=preview. DB layer: RPC is SECURITY INVOKER, executed with the service-role key (createServiceClient); execute is revoked from public/anon/authenticated and granted only to service_role (migration :291-304). The RPC re-validates every rule the TS layer checks (migration :98-141).
- **Revalidates:** revalidatePath('/admin'); revalidatePath('/scanner'); revalidatePath('/admin/source-monitor'); revalidatePublicSurfaces() → tags PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG + paths /, /issues, /report, /scanner (src/lib/revalidate.ts:10-22)
- **On failure:** Any validation miss throws 'bad input' before a client is created (actions.ts:492) — no write. Missing row throws 'rejected candidate not found' / 'source signal not found'; read errors throw '<x> read failed: …'. Steam-review signals throw 'Steam review signals cannot create URL feedback rules' (actions.ts:512-514). RPC error throws 'scanner decision write failed: …' — EXCEPT the legacy escape hatch at actions.ts:591-595: when decision='relevant' AND the RPC itself is missing (PGRST202/42883 via isMissingSupabaseRpc), the error is swallowed and the flow continues to mark rescued_at, so a Relevant click can succeed with NO decision row and NO allow rule. rescueCandidateSignal failure throws before any decision row is written (deliberate ordering, actions.ts:564-576). A failure of the rescued_at mark throws 'rescue mark failed' after the decision+rule already committed. Server actions surface as an unhandled error/error boundary — there is no inline field-level error UI.
- **Tests:** tests/adminActions.test.ts:571-610 records a durable exact-URL rejection without changing visibility; tests/adminActions.test.ts:612-643 broad scope requires confirm_broad, then passes source_path scope value; tests/adminActions.test.ts:645-662 Relevant rescues before recording the allow rule (ordering asserted); tests/adminActions.test.ts:690-721 does not pretend a rejection was learned when the RPC is missing; failed rescue leaves nothing written; tests/adminActions.test.ts:723-808 signal branch refreshes only the affected cluster and refuses Steam reviews/relevant/broad rules. tests/e2e/operator-writes.spec.ts:99-170 submits candidate reject/Undo and Keep/rescue through the real forms, including the non-reversible Keep Undo boundary.
- **Quirks:** target_kind is a hidden input and the ONLY thing that switches the two very different branches — a redesign that drops it silently converts every signal removal into a candidate decision against a non-existent candidate id. Ordering is load-bearing: rescue runs BEFORE the decision write on purpose (comment actions.ts:564-567). Scope specificity + recency decides which rule wins later (feedback.ts:91-123), so a newer exact_url Relevant supersedes an older block only within the same scope — a domain block still applies to unmatched URLs. expires_at is accepted but no UI emits it (see scanner-decision-expires-at-param). The rule teaches DISCOVERY only; it never changes issue visibility (migration header :1-5) except via the explicit signal quarantine.

#### `candidate-keep-relevant-submit` — Keep as relevant

- **Kind:** button · **Destructive:** irreversible
- **Reach:** /scanner (admin) > Action inbox > "Teach the scanner · Optional" > each candidate card, primary button
- **Does:** Declares an auto-rejected candidate actually relevant: runs the full rescue pipeline (deterministic extraction or zero/one OpenRouter generation, signal persistence, and cluster recompute), normally records an 'allow' rule for the exact-URL scope, and marks the candidate rescued so it leaves the desk. Cost verification can add ID-only OpenRouter audit requests; the missing-RPC compatibility path records no rule.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:79-87 (form) → src/app/admin/actions.ts:470-609 (relevant branch at 568-603)
- **Inputs:** Four hidden inputs, no operator-editable field: id=candidate.id (:80), decision='relevant' (:81), scope='exact_url' (:82), reason=canned string 'Operator inspected this page and confirmed it is a relevant Crimson Desert issue lead.' (:83). SubmitButton pendingText 'Keeping...'.
- **Writes:** Always on a successful rescue: automation_runs (insert 'running' + finalize), source_signals (insert or seen_count update), issue_clusters visibility/stat columns, automation_rejected_candidates.rescued_at. Normal RPC path additionally writes scanner_decisions (decision='relevant'), scanner_feedback_rules (action='allow', scope_type='exact_url'), revokes/supersedes prior same-URL rules, and writes automation_rejected_candidates.decision_id/.feedback_rule_id/.decided_at. Missing-RPC compatibility omits those decision/rule writes.
- **Guard:** requireAdmin + assertProductionWriteAllowed inside recordScannerDecision (actions.ts:471-472). The button itself renders only when the card renders; it is NOT gated by feedbackLearningAvailable (ScannerFeedbackDesk.tsx:78-88 sits outside that conditional).
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** A rescue failure (LLM/extraction/persistence) throws and nothing is recorded — the candidate stays on the desk for retry (tests/adminActions.test.ts:708-721). If the RPC is absent, the legacy path still marks rescued_at with no rule (actions.ts:591-603). No optimistic UI: the whole page re-renders on success.
- **Tests:** tests/adminActions.test.ts:645-662; tests/e2e/public-visual.spec.ts:957 asserts the button is visible; tests/e2e/operator-writes.spec.ts:122-170 submits Keep through the real form, proves the rescue writes, and proves lesson Undo does not return the rescued candidate
- **Quirks:** UNDO DOES NOT REACH THIS. undoScannerDecision revokes the allow rule and marks the decision undone, but it only clears decision_id/feedback_rule_id/decided_at 'where rescued_at is null' (migration 20260724200000_observation_moderation.sql:188-193) — the rescued candidate keeps its decision_id, stays filtered out of the desk (src/lib/queries.ts:1169-1170), and the persisted source_signal + automation_runs row are never removed. This control always uses zero Tavily/search credits and can make at most one OpenRouter generation call; no key/allowance/budget uses deterministic extraction with zero provider calls. The optional generation prompt contains the candidate's private title, snippet, and canonicalized source URL plus unpublished cluster slugs/titles. ID-only cost-audit GETs can follow. Its current automation routing sets deny-collection but omits ZDR. The canned reason is stored verbatim into scanner_decisions.reason and scanner_feedback_rules.reason and shown in the Active lessons ledger — every normal-path keep looks identical there.

#### `candidate-reject-teach-disclosure` — Reject and teach…

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > candidate card > <details> summary next to "Keep as relevant"
- **Does:** Reveals the four-field teaching form for that candidate; collapsed by default so the desk is not a dropdown farm.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:89-136
- **Inputs:** none (native <details>/<summary>, styled .tap-btn)
- **Writes:** read-only
- **Guard:** Rendered only when feedbackLearningAvailable is true (ScannerFeedbackDesk.tsx:89); otherwise the whole disclosure is replaced by the sentence 'Scanner learning unlocks after the database schema update.' (:138)
- **Revalidates:** —
- **On failure:** n/a — pure client disclosure; no state persists across a server re-render, so submitting any form on the page re-collapses every open disclosure.
- **Tests:** tests/adminScannerView.test.ts:301-325 asserts it is absent when learning is unavailable; tests/e2e/public-visual.spec.ts:958
- **Quirks:** Both this and the observation control use the identical label 'Reject and teach…' for two different actions writing two different tables; tests distinguish them by count (tests/adminScannerView.test.ts:261). Losing the disclosure wrapper would expose four selects per candidate and undo the deliberate 'review the pattern, not a dropdown farm' framing (AdminScannerView.tsx:542).

#### `candidate-reject-decision-select` — Why is it wrong?

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > candidate card > Reject and teach… form, field 1
- **Does:** Chooses which of the four rejection kinds is recorded on the decision row and mirrored onto the rule (it becomes the BLOCK label in the Active lessons ledger).
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:95-102 → actions.ts:475,483 → migration :143,173-193
- **Inputs:** name=decision; options off_topic ('Off-topic'), wrong_patch ('Wrong patch'), not_issue_report ('Not an issue report'), duplicate ('Duplicate'). defaultValue is candidate-dependent: 'wrong_patch' when the auto-rejection reason was wrong_patch, else 'off_topic' (:96). 'relevant' is deliberately NOT offered here.
- **Writes:** scanner_decisions.decision; scanner_feedback_rules.decision (and action='block' derived from it)
- **Guard:** Same action guards; DB check constraint restricts the enum (migration :15,33).
- **Revalidates:** —
- **On failure:** An out-of-enum value throws 'bad input' server-side (actions.ts:483) and again in the RPC (migration :107-109).
- **Tests:** tests/adminActions.test.ts:571-610
- **Quirks:** The chosen kind is cosmetic to the engine — every non-relevant value produces the same 'block' action (migration :143). Only the ledger label differs (ScannerFeedbackDesk.tsx:219-225). A redesign that collapses these to one 'Reject' button loses ledger vocabulary but no behavior.

#### `candidate-reject-reason-textarea` — Operator reason

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > candidate card > Reject and teach… form, field 2
- **Does:** Captures the operator's written justification, stored on BOTH the immutable decision row and the rule, and displayed in the Active lessons ledger.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:103-112 → actions.ts:476,486-487
- **Inputs:** name=reason, required, minLength 3, maxLength 500; prefilled with `Reviewed source: ${plainSkipPhrase(candidate.reason)}.` (:110). Server trims then enforces 3-500 (actions.ts:486-487); DB enforces char_length(btrim) between 3 and 500 on both tables (migration :16,36).
- **Writes:** scanner_decisions.reason; scanner_feedback_rules.reason
- **Guard:** Same action guards.
- **Revalidates:** —
- **On failure:** Under 3 / over 500 characters throws 'bad input' with no write; the browser's required/minLength blocks most cases first.
- **Tests:** tests/adminActions.test.ts:571-610 (reason passed through)
- **Quirks:** Prefilled, so a hurried operator ships a machine-worded reason into a permanent audit row. The reason is never editable afterward — scanner_decisions rows are append-only (no update path exists in this partition).

#### `candidate-reject-scope-select` — Apply this lesson to

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > candidate card > Reject and teach… form, field 3
- **Does:** Chooses how wide the block rule is: this exact page, this source section, or this entire domain — and drives the live 'Rule target' preview plus the conditional confirmation checkbox.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:113-125 (React state at :39-45) → actions.ts:477,484,558-562 → src/lib/automation/feedback.ts:69-82
- **Inputs:** name=scope, controlled value; options exact_url ('This exact page'), source_path ('This source section'), source_domain ('This entire domain'). The resolved value is previewed as <code> at :125 — 'this exact page' for exact_url, otherwise the literal stored scope value (e.g. reddit.com/r/protonmail), or 'scope unavailable' when scannerRuleScopeValue returns null.
- **Writes:** scanner_feedback_rules.scope_type; scanner_feedback_rules.scope_value
- **Guard:** Same action guards; non-exact scopes additionally require confirm_broad in TS (actions.ts:489) and in the RPC (migration :119-121), and the table has a CHECK that non-exact_url rules must carry confirmed_at (migration :41).
- **Revalidates:** —
- **On failure:** Selecting source_path/source_domain without ticking the confirmation throws 'bad input' with zero writes (tests/adminActions.test.ts:612-622). If the URL cannot be canonicalized or has no registrable domain, scannerRuleScopeValue returns null and the action throws 'bad input' (actions.ts:562) — the UI shows 'scope unavailable' beforehand.
- **Tests:** tests/adminActions.test.ts:612-643
- **Quirks:** This is the only React-controlled field in the desk; it is coupled to two other elements — the <code> preview and the appearance of the confirm checkbox (:126-131). Changing scope AFTER ticking the box unmounts the checkbox and drops confirm_broad, so switching source_domain → exact_url → source_domain silently un-confirms. The stored path scope is deliberately conservative (reddit stops at r/<sub>, others at two segments, feedback.ts:44-67); the preview is the operator's only sight of it.

#### `candidate-reject-confirm-broad-checkbox` — I understand this broader rule can affect future scanner results.

- **Kind:** checkbox · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > candidate card > Reject and teach… form — appears ONLY when scope ≠ exact_url
- **Does:** Unlocks a broader-than-one-page rule; sets confirmed_at on the stored rule.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:126-131 → actions.ts:478,489 → migration :119-121,191
- **Inputs:** name=confirm_broad, value='true', required. Server treats only the exact string 'true' as confirmation (actions.ts:478).
- **Writes:** scanner_feedback_rules.confirmed_at (now() when confirmed; null otherwise, which the CHECK at migration :41 forbids for non-exact scopes)
- **Guard:** Same action guards; enforced three times — HTML required, TS actions.ts:489, RPC migration :119-121, plus the table CHECK.
- **Revalidates:** —
- **On failure:** Absent + broad scope → 'bad input', no writes.
- **Tests:** tests/adminActions.test.ts:612-643
- **Quirks:** Conditional render — a redesign that always shows it (or always hides it) changes the guarantee. Note the sibling observation form's checkbox is ALWAYS visible and NOT required (AdminScannerView.tsx:293-296), so the two teach forms have inconsistent confirmation UX today.

#### `candidate-reject-submit` — Record decision

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Teach the scanner > candidate card > Reject and teach… form, submit
- **Does:** Submits the candidate rejection: writes the immutable decision, creates the block rule, supersedes prior same-scope rules, and stamps the candidate as decided so it leaves the teaching desk.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:132-134 → src/app/admin/actions.ts:470-609 (candidate branch 545-608)
- **Inputs:** Submits id (hidden, :93) + decision + reason + scope + optional confirm_broad. pendingText 'Recording...'. Danger-styled (tap-btn--danger).
- **Writes:** scanner_decisions (insert); scanner_feedback_rules (insert, action='block'); scanner_feedback_rules.revoked_at/.superseded_by_rule_id (prior same-scope rules); automation_rejected_candidates.decision_id/.feedback_rule_id/.decided_at
- **Guard:** requireAdmin + assertProductionWriteAllowed (actions.ts:471-472).
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** Throws with no partial write on validation/read/RPC failure; the page shows an error boundary rather than an inline message.
- **Tests:** tests/adminActions.test.ts:571-643
- **Quirks:** Does NOT touch visibility of anything already public — it only teaches future runs (migration header :1-5). Undo for this lives in a completely different section of the page (Active lessons ledger at the very bottom), not on the card; after submit the card disappears immediately because getAutomationAdminData filters decided candidates out (src/lib/queries.ts:1169-1170).

#### `teaching-desk-search` — Search title, source, or rejection reason (placeholder; sr-only label "Search optional scanner review")

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > toolbar above the candidate list
- **Does:** Client-side filters the undecided candidate list and — critically — switches the list from the 2-card default slice to showing ALL matches.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:154,162-170,178-191
- **Inputs:** type=search, controlled React state; matches against title, source_domain, snippet, and plainSkipPhrase(reason), case-insensitive.
- **Writes:** read-only
- **Guard:** None beyond the page-level admin render (/scanner renders AdminScannerView only when isAdmin(), src/app/scanner/page.tsx:20-47).
- **Revalidates:** —
- **On failure:** No matches renders no cards and the counter reads '0 matches'; there is no distinct empty-state copy for a filtered-to-nothing list (the 'Nothing needs teaching right now' empty state at :172-174 only fires when there are zero undecided candidates overall).
- **Tests:** tests/adminScannerView.test.ts (desk render cases)
- **Quirks:** Coupled to the show-more disclosure: while a query is present, slicing is bypassed entirely (:191) and the disclosure is suppressed (:200). The counter text flips wording between '<n> matches' and '<n> recent candidates' (:188). Only UNDECIDED candidates are searchable — rescued/decided rows are filtered out upstream (:156-161) and again in the query.

#### `teaching-desk-show-more` — Show N more optional candidates →

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > below the first two candidate cards
- **Does:** Reveals the remaining undecided candidates beyond the default two.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:200-214 (DEFAULT_VISIBLE_CANDIDATES = 2 at :10)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** None beyond the admin page render.
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** —
- **Quirks:** ORDERING MATTERS: candidates arrive newest-first (queries.ts:1171) and only the first two are visible without a click — the desk deliberately shows a sample, not a queue. Renders only when no search query is active AND more than two matches exist. The teaching desk itself is capped upstream at 30 unexpired, unrescued, undecided rows (queries.ts:1167-1172), so 'N more' is never the true backlog.

#### `signal-remove-bad-lead-disclosure` — Remove bad lead

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > "Automatic records — What the scanner kept" > each kept lead card (and inside "Browse N older leads")
- **Does:** Reveals the two-field form that removes one kept source lead from public view and teaches the scanner to block that exact URL.
- **Backing:** src/components/scanner/AdminScannerView.tsx:169-211 (summary at :177-178)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Rendered only when feedbackLearningAvailable (:169) and the lead is NOT a Steam review (:171); each branch replaces it with an explanatory sentence instead.
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/adminScannerView.test.ts:151 expects exactly 8 occurrences of 'Remove bad lead'; tests/adminScannerView.test.ts:200 expects none when a Steam-review lead is rendered; tests/adminScannerView.test.ts:325 expects none when learning is unavailable
- **Quirks:** Appears on BOTH the six recent leads and every lead inside the 'Browse N older leads' disclosure (AdminScannerView.tsx:626-637), so a redesign must keep it inside the nested disclosure too — the test count of 8 pins that. Label says 'Remove bad lead' but the effect is quarantine + a permanent block rule, not deletion.

#### `signal-decision-select` — Why this lead is wrong

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Automatic records > lead card > Remove bad lead form, field 1
- **Does:** Chooses the rejection kind recorded for a kept lead.
- **Backing:** src/components/scanner/AdminScannerView.tsx:183-191 → actions.ts:475,483,488
- **Inputs:** name=decision, required, defaultValue off_topic; options off_topic ('Off topic'), wrong_patch ('Wrong patch'), not_issue_report ('Not an issue report'), duplicate ('Duplicate source'). 'relevant' is structurally forbidden for signals (actions.ts:488, RPC migration :125-127).
- **Writes:** scanner_decisions.decision; scanner_feedback_rules.decision (action always 'block' here)
- **Guard:** Same action guards; RPC rejects relevant-on-signal with 'a retained source signal is already relevant'.
- **Revalidates:** —
- **On failure:** Out-of-enum or 'relevant' → 'bad input', no writes (tests/adminActions.test.ts:792-808).
- **Tests:** tests/adminActions.test.ts:723-760; tests/adminActions.test.ts:792-808
- **Quirks:** Same four values as the candidate form but two labels differ ('Off topic' vs 'Off-topic', 'Duplicate source' vs 'Duplicate') — a redesign that unifies the copy is safe, the values are what matter.

#### `signal-reason-textarea` — Operator reason (placeholder "What made this source irrelevant?")

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Automatic records > lead card > Remove bad lead form, field 2
- **Does:** Captures the written justification stored on the decision and the rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:192-201 → actions.ts:476,486-487
- **Inputs:** name=reason, required, minLength 3, maxLength 500, NOT prefilled (unlike the candidate form).
- **Writes:** scanner_decisions.reason; scanner_feedback_rules.reason
- **Guard:** Same action guards; DB CHECK 3-500 on both tables.
- **Revalidates:** —
- **On failure:** Out-of-range throws 'bad input', no writes.
- **Tests:** tests/adminActions.test.ts:723-760
- **Quirks:** Empty by default here but prefilled on the candidate desk — intentional asymmetry (removing a kept public lead should require typing), worth preserving.

#### `signal-remove-submit` — Remove lead and teach scanner

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Automatic records > lead card > Remove bad lead form, submit
- **Does:** Hides one already-kept source lead from public surfaces AND records a permanent exact-URL block, then recomputes the lead's cluster so public counts and issue visibility follow.
- **Backing:** src/components/scanner/AdminScannerView.tsx:206-208 (hidden inputs :180-182) → src/app/admin/actions.ts:495-543
- **Inputs:** Hidden: id=signal.id (:180), target_kind='signal' (:181), scope='exact_url' (:182). Visible: decision, reason. pendingText 'Removing lead…'. Server derives the rule target from canonical_url ?? source_url (actions.ts:515-519).
- **Writes:** scanner_decisions (insert with signal_id, candidate_id null); scanner_feedback_rules (insert, action='block', scope_type='exact_url'); scanner_feedback_rules.revoked_at/.superseded_by_rule_id on prior same-URL rules; source_signals.public_status='hidden', .promoted_at=null, .promotion_reason='operator_feedback_blocked' (migration :211-217); issue_clusters.visibility_revision +1 (migration :223-227); then refreshClusterVisibility(affected cluster): source_signals.public_status/promoted_at/promotion_reason for every signal in the cluster + issue_clusters.signal_count/direct_report_count/verified_report_count/public_signal_count/last_signal_at/auto_public/is_public/visibility_revision (run.ts:1863-1877)
- **Guard:** requireAdmin + assertProductionWriteAllowed. Steam-review leads are blocked twice: the form is not rendered (AdminScannerView.tsx:171-175) and the action throws (actions.ts:512-514). Broad scopes and 'relevant' are rejected for signals (actions.ts:488).
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** Read failure → 'source signal read failed: …'; missing row → 'source signal not found'; RPC failure → 'scanner decision write failed: …' (no legacy escape hatch on this branch). If refreshClusterVisibility throws AFTER the RPC commits, the quarantine and rule are already durable but the cluster's aggregate counts stay stale until the next run touches that cluster.
- **Tests:** tests/adminActions.test.ts:723-760 (refreshes only the affected cluster); tests/adminActions.test.ts:762-790 (Steam review refusal); tests/adminActions.test.ts:792-808
- **Quirks:** This is the only control in the partition that changes what the PUBLIC sees at click time. Restore path is the Undo in the Active lessons ledger — but undo_scanner_decision restores nothing directly: it revokes the rule and bumps visibility_revision, and only a subsequent refreshClusterVisibility recomputes public_status, and ONLY when the signal still has a cluster_id (migration 20260724200000:201-212, actions.ts:723). A quarantined signal with cluster_id NULL stays hidden with promotion_reason='operator_feedback_blocked' forever — no control restores it. Also: broad path/domain rules are deliberately excluded when re-evaluating STORED signals (run.ts:1736-1739) — only exact_url rules can retro-hide evidence.

#### `scanner-decision-expires-at-param` — expires_at (accepted FormData field with no UI)

- **Kind:** text-input · **Destructive:** none
- **Reach:** NOT REACHABLE from any rendered control — accepted by recordScannerDecision only
- **Does:** Would set a self-expiring feedback rule: after expires_at the rule stops matching and the Active lessons ledger drops it.
- **Backing:** src/app/admin/actions.ts:479-480,490,531,589; consumed by migration :191-192 and expiry filtering in src/lib/automation/feedback.ts:84-89 and src/lib/queries.ts:1205,1305-1307
- **Inputs:** Optional date string; must parse to a finite date strictly in the future (actions.ts:490) and the RPC re-checks (migration :128-130); the table CHECKs expires_at > created_at (migration :42).
- **Writes:** scanner_feedback_rules.expires_at
- **Guard:** Same action guards.
- **Revalidates:** —
- **On failure:** A past or unparseable value throws 'bad input'. Today: unreachable, so always null.
- **Tests:** —
- **Quirks:** DEAD INPUT: grep of src/components finds no name="expires_at" — every rule created today is permanent-until-undone. rejectObservationAndTeach hardcodes p_expires_at: null (actions.ts:677) and does not even read the field. The whole expiry apparatus (client-side filter at queries.ts:1305-1307, expiryTime helper) exists with nothing feeding it. A redesign should either surface it or knowingly drop it.

#### `reject-observation-action` — rejectObservationAndTeach (server action)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /scanner (admin) > "Context lanes — Wire and Asks on the Brief" > each observation card > Reject and teach…
- **Does:** Performs two explicit acts in one RPC transaction on a public Wire/Asks item: hides it from the public lanes immediately, and records a decision + block rule so future runs skip that source.
- **Backing:** src/app/admin/actions.ts:611-694; RPC public.record_observation_decision in supabase/migrations/20260724200000_observation_moderation.sql:24-153
- **Inputs:** FormData: id (required patch_observations id); decision (off_topic\|wrong_patch\|not_issue_report\|duplicate — OBSERVATION_DECISIONS at actions.ts:611; 'relevant' is intentionally absent, RPC comment :55-57); reason (trimmed 3-500); scope — parsed by a LOCAL narrower mapping (actions.ts:625-627): only 'exact_url' or 'source_domain' survive, anything else (including the RPC-legal 'source_path') becomes null → 'bad input'; confirm_broad ('true'), required whenever scope ≠ exact_url (actions.ts:635). expires_at is not read; p_expires_at is hardcoded null (:677).
- **Writes:** patch_observations.is_public=false (guarded update, only when currently true) — migration :93-101; scanner_decisions.id/observation_id/target_url/target_url_hash/source_domain/decision/reason (insert) — migration :103-119; scanner_feedback_rules.id/decision_id/action='block'/decision/scope_type/scope_value/reason/confirmed_at/expires_at (insert) — migration :121-141; scanner_feedback_rules.revoked_at + .superseded_by_rule_id on prior active same-scope rules — migration :143-149
- **Guard:** requireAdmin() (actions.ts:620) → redirect /admin/login; assertProductionWriteAllowed() (:621) → throws under VERCEL_ENV=preview. Application-level re-decide guard: the action refuses when the observation is already hidden (:653-655) and the RPC repeats that check INSIDE the advisory-locked transaction (:93-101) so two concurrent rejects cannot both write. RPC execute granted to service_role only (migration :355-358).
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** Validation → 'bad input'. Read failure → 'observation read failed: …'; missing row → 'observation not found'. Already-hidden → 'observation is already hidden — undo its existing decision before deciding again' (both TS :654 and SQL :99). Missing migration is called out by name: 'Observation moderation needs the 20260724200000_observation_moderation migration; the item was not changed.' (:682-686) — deliberately refuses to look moderated. Any other RPC error → 'observation decision write failed: …'. Transactional: hide + decision + rule all commit or none do.
- **Tests:** tests/e2e/operator-writes.spec.ts:57-96 submits rejectObservationAndTeach and its card-level Undo through real server actions, verifies HIDDEN/PUBLIC state and rule visibility, and proves public Ask removal/restoration. tests/adminActionsAuth.test.ts:97-104 and :149-186 pin the unauthenticated stop-before-work boundary.
- **Quirks:** The action now has full happy-path E2E proof, but invalid input, the already-hidden refusal, RPC argument fidelity, and missing-migration/error branches remain unpinned. The 'teach' half is weaker than it reads: a blocked exact URL stops future intake at run.ts:1051-1075 (before the observation reroute at run.ts:996-1008), but community_ask items are deduped by an ask-SERIES hash rather than URL (src/lib/automation/observations.ts:54-61), so a serialized campaign posting a NEW URL each day is not stopped by an exact_url rule — only a domain rule would catch it. It never calls refreshClusterVisibility because observations carry no cluster_id by design (observations.ts:16-18).

#### `observation-reject-disclosure` — Reject and teach…

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > Context lanes > observation card (shown only when that card has no active decision)
- **Does:** Reveals the four-field moderation form for a Wire/Asks item.
- **Backing:** src/components/scanner/AdminScannerView.tsx:262-305
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Three-way conditional at :250-262 — replaced by 'Observation moderation unlocks after the database schema update.' when observationModerationAvailable is false, or by the Undo form when observation.decision_id is set.
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/adminScannerView.test.ts:256,261 (present exactly once alongside one Undo); tests/adminScannerView.test.ts:301-325 (absent when unavailable)
- **Quirks:** Mutually exclusive with the Undo control on the same card — the card is either 'rejectable' or 'undoable', never both. Same label as the candidate-desk disclosure; the two are only distinguishable by section.

#### `observation-decision-select` — Why this item is wrong

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Context lanes > observation card > Reject and teach… form, field 1
- **Does:** Chooses the rejection kind stored on the observation decision and its block rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:267-275 → actions.ts:611,631
- **Inputs:** name=decision, required, defaultValue off_topic; options off_topic ('Off topic'), wrong_patch ('Wrong patch'), not_issue_report ('Not patch context'), duplicate ('Duplicate source').
- **Writes:** scanner_decisions.decision; scanner_feedback_rules.decision
- **Guard:** Same action guards; RPC restricts the enum (migration :57-59).
- **Revalidates:** —
- **On failure:** Out-of-enum → 'bad input', no writes.
- **Tests:** —
- **Quirks:** LABEL MISMATCH: the value not_issue_report is labelled 'Not patch context' here but 'Not an issue report' everywhere else — the same stored value renders as 'BLOCK NON-ISSUE' in the Active lessons ledger (ScannerFeedbackDesk.tsx:223). Keep the value, fix or keep the copy knowingly.

#### `observation-reason-textarea` — Operator reason (placeholder "What made this item wrong for the public lanes?")

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Context lanes > observation card > Reject and teach… form, field 2
- **Does:** Captures the justification stored on the observation decision and its rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:276-285 → actions.ts:624,632-633
- **Inputs:** name=reason, required, minLength 3, maxLength 500, not prefilled.
- **Writes:** scanner_decisions.reason; scanner_feedback_rules.reason
- **Guard:** Same action guards; DB CHECK 3-500.
- **Revalidates:** —
- **On failure:** Out-of-range → 'bad input', no writes.
- **Tests:** —
- **Quirks:** This reason is what appears in the public-facing-adjacent Active lessons ledger; there is no separate 'internal note' field.

#### `observation-scope-select` — Rule scope

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Context lanes > observation card > Reject and teach… form, field 3
- **Does:** Chooses whether the lesson blocks just this page or the whole domain.
- **Backing:** src/components/scanner/AdminScannerView.tsx:286-292 → actions.ts:625-627,661-665
- **Inputs:** name=scope, required, defaultValue exact_url; options exact_url ('This exact page only'), source_domain ('Whole domain (needs confirmation)'). Scope value derived by scannerRuleScopeValue (canonical URL, or registrable domain).
- **Writes:** scanner_feedback_rules.scope_type; scanner_feedback_rules.scope_value
- **Guard:** Same action guards; domain scope additionally requires confirm_broad (actions.ts:635, RPC migration :69-71, table CHECK :41).
- **Revalidates:** —
- **On failure:** Domain scope without confirmation → 'bad input'. Unresolvable URL/domain → 'bad input' (actions.ts:665).
- **Tests:** —
- **Quirks:** DEAD OPTION BY OMISSION: 'source_path' is legal in the RPC and in the candidate desk but this action's local parser (actions.ts:626-627) maps anything that is not exact_url/source_domain to null → 'bad input'. So the observation lane has a coarser choice than the candidate lane — deliberate today, easy to 'fix' wrongly in a redesign. There is also no live 'Rule target' preview here (the candidate desk has one), so the operator never sees the domain string that will be stored.

#### `observation-confirm-broad-checkbox` — Confirm whole-domain rule (required only for domain scope)

- **Kind:** checkbox · **Destructive:** none
- **Reach:** /scanner (admin) > Context lanes > observation card > Reject and teach… form, field 4 — ALWAYS rendered
- **Does:** Confirms a whole-domain lesson; sets confirmed_at on the stored rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:293-296 → actions.ts:628,635 → migration :69-71,139
- **Inputs:** name=confirm_broad, value='true'. NOT marked required and NOT conditionally rendered — it sits visible even for exact-page scope.
- **Writes:** scanner_feedback_rules.confirmed_at
- **Guard:** Enforced server-side only (actions.ts:635) plus RPC + table CHECK; the browser does not block submission.
- **Revalidates:** —
- **On failure:** Domain scope with the box unticked reaches the server and throws 'bad input' — the operator loses the typed reason on the error page.
- **Tests:** —
- **Quirks:** Diverges from the candidate desk's equivalent (conditional + required). Ticking it with exact_url scope is harmless but meaningless — confirmed_at is set either way for exact_url (migration :139). This is the most likely spot for a redesign to accidentally 'harmonize' the two forms and change enforcement.

#### `observation-reject-submit` — Reject and teach

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Context lanes > observation card > Reject and teach… form, submit
- **Does:** Hides the Wire/Asks item from the public Brief lanes right now and records the undoable lesson — two records, one Undo.
- **Backing:** src/components/scanner/AdminScannerView.tsx:301-303 (hidden id at :266) → src/app/admin/actions.ts:619-694
- **Inputs:** Hidden id + decision + reason + scope + optional confirm_broad. pendingText 'Rejecting…'. Danger-styled.
- **Writes:** patch_observations.is_public=false; scanner_decisions (insert with observation_id); scanner_feedback_rules (insert, action='block'); scanner_feedback_rules.revoked_at/.superseded_by_rule_id (prior same-scope rules)
- **Guard:** requireAdmin + assertProductionWriteAllowed + the already-hidden re-decide guard (actions.ts:653-655 and migration :93-101).
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces() — this is what actually removes the item from the public Wire/Asks lanes, which read .eq('is_public', true) at src/lib/queries.ts:718-721
- **On failure:** Missing migration produces the explicit named-migration error and changes nothing (actions.ts:682-686). All other failures throw with the transaction rolled back.
- **Tests:** —
- **Quirks:** After submit the card re-renders with the Undo form in place of the disclosure — the same card, a different control. The public effect depends on cache invalidation, not on a DB trigger, so if revalidatePublicSurfaces silently swallows its error (src/lib/revalidate.ts:19-21) the item can linger publicly for up to the page's own 5-minute self-revalidation.

#### `rescue-rejected-candidate-action` — rescueRejectedCandidate (compatibility server action)

- **Kind:** server-action · **Destructive:** irreversible
- **Reach:** NO MOUNTED UI — its only caller, src/components/scanner/RejectedArchive.tsx, is not imported anywhere in src (verified by repo-wide grep). Still an exported server action with a live endpoint.
- **Does:** Thin shim: builds a synthetic FormData (decision='relevant', scope='exact_url', canned reason) and delegates to recordScannerDecision, i.e. Rescue now records a durable Relevant decision.
- **Backing:** src/app/admin/actions.ts:696-706
- **Inputs:** FormData: id only (required, trimmed). Everything else is hardcoded at :702-704 — decision 'relevant', reason 'Operator reviewed this candidate and marked it relevant.', scope 'exact_url'.
- **Writes:** identical to the Keep-as-relevant path: automation_runs / source_signals / issue_clusters and rescued_at always land on success; scanner_decisions, scanner_feedback_rules (action='allow'), and candidate decision fields land only on the normal RPC path.
- **Guard:** NONE OF ITS OWN — it does not call requireAdmin or assertProductionWriteAllowed itself; it inherits them from recordScannerDecision (actions.ts:471-472) via the delegated call at :705. Correct today, but the guard is one refactor away from being lost.
- **Revalidates:** inherited from recordScannerDecision: /admin, /scanner, /admin/source-monitor, revalidatePublicSurfaces()
- **On failure:** Empty id → 'bad input' before any client. Otherwise every failure mode of recordScannerDecision applies, including the legacy PGRST202 escape hatch that marks rescued_at with no rule (tests/adminActions.test.ts:664-688).
- **Tests:** tests/adminActions.test.ts:509-569 (rescues, rejects empty id, rejects unknown candidate); tests/adminActions.test.ts:664-688 (legacy pre-RPC rescue path)
- **Quirks:** Kept explicitly for older forms (comment at :696). Because the whole component that used it is unmounted, this is currently unreachable through the UI — a redesign can drop the button, but deleting the ACTION would also delete the legacy-RPC fallback the tests pin. Its canned reason differs from the Keep-as-relevant canned reason, so ledger rows are distinguishable by wording only.

#### `rejected-archive-rescue-submit` — Rescue

- **Kind:** button · **Destructive:** irreversible
- **Reach:** UNREACHABLE — src/components/scanner/RejectedArchive.tsx renders it, but that component has no importer anywhere in src
- **Does:** Would mark one archived rejected candidate relevant via rescueRejectedCandidate.
- **Backing:** src/components/scanner/RejectedArchive.tsx:22-27 (hidden id at :23) → src/app/admin/actions.ts:697
- **Inputs:** Hidden id=candidate.id; pendingText 'Rescuing...'.
- **Writes:** see rescue-rejected-candidate-action (nothing today — the control cannot be clicked)
- **Guard:** Inherited admin/preview guards inside the action.
- **Revalidates:** inherited
- **On failure:** n/a while unmounted.
- **Tests:** —
- **Quirks:** DEAD UI. The same file also carries an unreachable archive search input (:53-59) and a 'Show N more before they expire →' disclosure (:72-82). Parity decision needed: either mount this component or delete it deliberately — right now the teaching desk's 'Keep as relevant' is the only live way to rescue, and it is capped at 30 unexpired candidates.

#### `undo-scanner-decision-action` — undoScannerDecision (server action)

- **Kind:** server-action · **Destructive:** state-changing
- **Reach:** /scanner (admin) > "Active lessons — What the scanner will remember" ledger (one Undo per rule) AND /scanner > Context lanes > any hidden observation card
- **Does:** Marks one decision undone and revokes every rule that decision created. It returns an unrescued candidate to the teaching desk and restores a hidden observation to public. For a removed source signal it returns only the signal's current cluster id; the action recomputes that cluster when non-null, but it does not restore an unclustered signal directly.
- **Backing:** src/app/admin/actions.ts:708-728; RPC public.undo_scanner_decision in supabase/migrations/20260724200000_observation_moderation.sql:157-216 (supersedes the 20260722170106:234-286 version)
- **Inputs:** FormData: decision_id only (required, trimmed). No reason, no confirmation, no scope.
- **Writes:** scanner_decisions.undone_at = coalesce(undone_at, now()) — migration :171-175; scanner_feedback_rules.revoked_at = coalesce(revoked_at, now()) for every rule with that decision_id — migration :182-184; automation_rejected_candidates.decision_id=null, .feedback_rule_id=null, .decided_at=null — ONLY where rescued_at is null — migration :188-193; patch_observations.is_public=true when the decision carried an observation_id — migration :195-199; issue_clusters.visibility_revision +1 for the signal's cluster — migration :201-212; then refreshClusterVisibility(affected_cluster_id) if non-null: rewrites source_signals.public_status/promoted_at/promotion_reason and issue_clusters stat+visibility columns (actions.ts:723, run.ts:1863-1877)
- **Guard:** requireAdmin() (actions.ts:709) → redirect /admin/login; assertProductionWriteAllowed() (:710) → throws under preview. The RPC takes the global visibility advisory lock 20260709/1 first (migration :169) to match the write path's lock order. Execute granted to service_role only.
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** Empty decision_id → 'bad input'. RPC error → 'scanner decision undo failed: …'. Idempotency guard: if the decision was already undone or does not exist the RPC returns undone=false and the action throws 'scanner decision was already undone or not found' (actions.ts:722) — a double-click surfaces as an error page, not a silent no-op. A refreshClusterVisibility failure after the RPC commits leaves the rule revoked but the signal still hidden until the next cluster refresh.
- **Tests:** tests/adminActions.test.ts:811-823 (revokes the rule without touching cluster visibility); tests/adminActions.test.ts:825-839 (recomputes the affected cluster; asserts it does not hand-edit scanner_decisions or source_signals); tests/scannerFeedbackMigration.test.ts:28-30 (function shape)
- **Quirks:** ASYMMETRIC REVERSIBILITY — the single most important fact for a redesign. Undo makes the FUTURE-facing rule inert and restores some row state (observation is_public and candidate desk membership), but it never deletes the scanner_decisions/scanner_feedback_rules audit rows, never restores a rescued candidate (rescued_at is not cleared and blocks the reset), never removes the source_signals row or automation_runs row a Relevant rescue created, and cannot replay sources that were dropped by the rule while it was active — those runs already wrote automation_rejected_candidates rows with reason=<decision> and are gone. Signal restoration is conditional: a clustered signal is recomputed under current evidence/override rules, not restored to a stored prior value; a quarantined signal with cluster_id NULL stays hidden forever. A newer same-scope rule supersedes and revokes the older rule, and undoing the newer decision does not reactivate the older one. There is no confirmation step and no 'redo'.

#### `feedback-rule-undo-submit` — Undo

- **Kind:** button · **Destructive:** state-changing
- **Reach:** /scanner (admin) > bottom section "Active lessons — What the scanner will remember" > one per rule card, in the rule's meta column
- **Does:** Revokes that lesson and marks its decision undone, removing the rule from the ledger and from future scanner matching. Candidate and observation row state can be restored; signal-row restoration is conditional on a non-null cluster and is not a full reversal.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:241-247 (hidden decision_id=rule.decision_id at :244) → src/app/admin/actions.ts:708-728
- **Inputs:** Hidden decision_id only; pendingText 'Undoing...'; small danger-neutral tap-btn--sm.
- **Writes:** see undo-scanner-decision-action
- **Guard:** Panel renders only when feedbackLearningAvailable (AdminScannerView.tsx:663-667); action guards as above.
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** Already-undone decision throws 'scanner decision was already undone or not found'. Empty ledger renders 'No scanner lessons yet. Decisions you record above will appear here with an Undo control.' (:230).
- **Tests:** tests/adminActions.test.ts:811-839
- **Quirks:** The ledger is keyed on rule.id but submits rule.decision_id — one decision can own multiple rules in principle, and undo revokes ALL rules for that decision (migration :182-184), so two ledger rows could vanish from one click. Rules are listed newest-first and pre-filtered twice: server-side .is('revoked_at', null) + not-yet-expired (queries.ts:1201-1206) and again client-side by expiry (queries.ts:1305-1307). This is the ONLY undo control for candidate and signal decisions — it lives at the very bottom of the page, far from the cards that created them.

#### `observation-undo-submit` — Undo — restore item and revoke rule

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Context lanes > any observation card that currently carries an active decision (replaces the Reject disclosure on that card)
- **Does:** Restores the hidden Wire/Asks item to the public lanes and revokes the block rule its rejection created.
- **Backing:** src/components/scanner/AdminScannerView.tsx:252-261 (hidden decision_id=observation.decision_id at :254) → src/app/admin/actions.ts:708-728
- **Inputs:** Hidden decision_id only; pendingText 'Undoing…'; primary dispatch-btn styling (not danger).
- **Writes:** patch_observations.is_public=true; scanner_decisions.undone_at; scanner_feedback_rules.revoked_at
- **Guard:** Renders only when observationModerationAvailable AND observation.decision_id is non-null (AdminScannerView.tsx:250-252); action guards as above.
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces()
- **On failure:** Stale decision_id (already undone elsewhere) throws 'scanner decision was already undone or not found'.
- **Tests:** tests/adminScannerView.test.ts:258 asserts the exact label renders
- **Quirks:** decision_id is resolved by a SEPARATE scoped query — the newest non-undone scanner_decisions row per listed observation, capped at 200 and scoped to the 40 listed observations precisely so a hidden item cannot be stranded without an Undo (src/lib/queries.ts:1265-1296). A redesign that changes the observation list cap (40, ordered observed_at desc, current patch only) can re-strand hidden items. Note the item is restored to is_public=true unconditionally — patch_observations.is_public defaults true and only moderation ever sets it false (migration 20260716210000_patch_observations.sql:19), so this is faithful today but would become wrong if any other writer starts hiding observations.

#### `relevant-decision-rescue-pipeline` — Relevant-decision rescue pipeline (automatic side effect of Keep as relevant / Rescue)

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** Triggered by any recordScannerDecision call with decision='relevant' and target_kind='candidate'
- **Does:** Before the decision is written, opens and finalizes an automation run ledger row, extracts a structured signal deterministically or with at most one OpenRouter generation call, upserts a source_signals row, and recomputes the resolved cluster — deliberately SKIPPING the pre-screen and keep gates because the operator already judged it relevant. OpenRouter cost verification can add ID-only audit GETs. It never spends Tavily/search credits.
- **Backing:** src/app/admin/actions.ts:568-576 → rescueCandidateSignal at src/lib/automation/run.ts:2613-2746 (skip rationale at :2693-2695)
- **Inputs:** No operator inputs — derived entirely from the candidate row (title, url, source_domain, source_published_at, snippet) read at actions.ts:545-552. The optional generation prompt contains title, snippet, the canonicalized source URL, and the unpublished cluster slugs/titles supplied to extraction. Cost-audit requests carry only the returned generation ID.
- **Writes:** automation_runs insert: started_at, status='running', mode='manual', budget_monthly_usd, budget_remaining_before_usd, skips, progress (run.ts:2030-2051); automation_runs update on finalize: finished_at, status, estimated_cost_usd, reddit_posts_seen, search_queries_used, search_results_seen, llm_calls_used, signals_inserted, signals_deduped, clusters_promoted, intent='rescue_candidate', signals_reobserved, stale_signals_hidden, candidates_rescued, skips, errors, funnel, progress, operator_rules_matched (run.ts:2063-2104); source_signals insert or update: source/source_type='web_search', source_url, canonical_url, external_id_hash, title, source_domain, source_published_at, semantic_fingerprint, cluster_id, summary, extracted_facts, category, confidence, observed_at, raw_text, raw_expires_at, public_status='private', extraction_provider, extraction_model, cost_estimate_usd, first_seen_at/last_seen_at/seen_count/last_seen_run_id (run.ts:1622-1683); issue_clusters + cluster signal visibility recompute via apply_cluster_visibility_refresh (run.ts:1863-1877)
- **Guard:** Inherits requireAdmin + assertProductionWriteAllowed from the calling action. Cost guards: paid search disabled (allowPaidSearch:false, maxSearchQueries:0), LLM calls capped at MAX_RESCUE_LLM_CALLS and zeroed when the OpenRouter circuit is open (run.ts:2659-2665); a spend-read failure conservatively forces the circuit open (:2645-2650). Missing key, invalid model, exhausted allowance, or exhausted budget returns deterministic extraction with zero provider requests. The current automation provider object sets `data_collection:"deny"` but omits `zdr:true`.
- **Revalidates:** none of its own — the caller's revalidations cover it
- **On failure:** Any failure throws out of the action BEFORE the decision/rule rows are written (ordering comment actions.ts:564-567), and the run ledger is finalized as 'failed' in the finally block (run.ts:2743-2745). A rescued signal that does not resolve to a cluster throws 'rescued signal did not resolve to a cluster' (run.ts:1906).
- **Tests:** tests/adminActions.test.ts:645-662 (rescue precedes the decision write); tests/adminActions.test.ts:708-721 (failed rescue writes nothing); tests/automationRun.test.ts:2615,2658,2717,3498 (candidatesRescued accounting); tests/e2e/operator-writes.spec.ts:122-170 (real-form rescue and non-reversible Undo boundary)
- **Quirks:** A successful click on a small text button creates a run row that appears in 'Scan history and diagnostics' and public scanner counters; depending on configuration and allowance it may issue one OpenRouter generation call plus ID-only cost-audit GETs. A failure before createRunLedger creates no row, while a later failure finalizes the row as failed without necessarily creating a lead. Nothing in the live button copy says so. The saved scanner-policy LLM cap does not govern this path; the separate environment automation budget does. This is the only irreversible write in the whole learning loop: Undo cannot delete a persisted signal or run, and a successfully rescued candidate never returns to the desk.

#### `decision-revalidation` — Post-decision cache revalidation (automatic)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs at the tail of all four actions in this partition
- **Does:** Invalidates the operator pages and every public surface so the decision's effect is visible immediately rather than after the pages' own 5-minute revalidation.
- **Backing:** src/app/admin/actions.ts:538-541, 605-608, 690-693, 724-727 → src/lib/revalidate.ts:10-22
- **Inputs:** none
- **Writes:** read-only (cache only)
- **Guard:** none — runs after the write commits
- **Revalidates:** /admin; /scanner; /admin/source-monitor; tag PUBLIC_DASHBOARD_TAG; tag PUBLIC_ISSUES_TAG; tag CURRENT_PATCH_TAG; /; /issues; /report
- **On failure:** revalidatePublicSurfaces swallows every error by design (src/lib/revalidate.ts:19-21) with the comment that pages self-revalidate within 5 minutes; the bare revalidatePath calls in the actions are NOT wrapped, so a failure there would surface as an action error after the DB write already committed.
- **Tests:** tests/adminActions.test.ts:822 asserts revalidatePath('/admin')
- **Quirks:** /admin/source-monitor is revalidated by every one of these actions even though that route no longer hosts the scanner UI (the /scanner tab replaced the source-monitor wall) — check whether the path still exists before copying this list forward. The signal-quarantine and observation-hide effects on the PUBLIC site depend on this step, not on the database, so dropping it silently delays public visibility changes.

#### `schema-availability-gates` — feedbackLearningAvailable / observationModerationAvailable (automatic capability gates)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Computed on every /scanner admin render; controls whether the teaching, remove-lead, observation-moderation, and lessons-ledger controls exist at all
- **Does:** Probes whether the scanner-feedback and observation-moderation migrations are live and degrades the UI to explanatory sentences instead of rendering controls that would fail.
- **Backing:** src/lib/queries.ts:1201-1210 (feedbackLearningAvailable at :1304) and :1267-1292 (observationModerationAvailable at :1284); consumed at src/components/scanner/AdminScannerView.tsx:169-176, 250-262, 523-534, 663-667 and src/components/scanner/ScannerFeedbackDesk.tsx:89,137-139
- **Inputs:** none — derived from narrowly-matched PostgREST errors (isMissingSupabaseRelation / isMissingSupabaseColumn, src/lib/supabaseCompatibility.ts:13-55); any other error is rethrown loudly rather than downgrading the desk.
- **Writes:** read-only
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** When false: 'Scanner learning unlocks after the database schema update.' / 'Observation moderation unlocks after the database schema update.' replace the controls; the Action-inbox facts strip swaps '<n> active scanner lessons' for 'Learning schema pending' (AdminScannerView.tsx:532). rejectObservationAndTeach also refuses at the server with the migration named (actions.ts:682-686).
- **Tests:** tests/adminScannerView.test.ts:301-325 (all teach controls absent when unavailable); tests/queriesAdminCompatibility.test.ts
- **Quirks:** CONDITIONAL STATE A REDESIGN WILL MISS: five different fallback sentences exist and are only reachable on a pre-migration deploy. 'Keep as relevant' is deliberately NOT gated — it still renders when learning is unavailable (ScannerFeedbackDesk.tsx:78-88) because the legacy rescue path still works. The rejected-candidate query also has a legacy re-read without decision_id/feedback_rule_id (queries.ts:1175-1191) that shows already-decided candidates on the desk when those columns are missing.

#### `steam-review-lesson-suppression` — Steam-review lesson suppression (automatic)

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Automatic records > any lead whose source or source_type is steam_review
- **Does:** Removes the 'Remove bad lead' control for Steam-review leads and explains why: Steam reviews share one provider URL, so a URL-scoped lesson would block the whole review lane.
- **Backing:** src/components/scanner/AdminScannerView.tsx:124,171-175 (UI) and src/app/admin/actions.ts:512-514 (server refusal); scanner-side exemption at src/lib/automation/run.ts:1049-1057
- **Inputs:** none
- **Writes:** read-only
- **Guard:** Defense in depth: UI omission + server throw 'Steam review signals cannot create URL feedback rules'.
- **Revalidates:** —
- **On failure:** A forged submit throws before any RPC call and before any cluster refresh (tests/adminActions.test.ts:762-790).
- **Tests:** tests/adminActions.test.ts:762-790; tests/adminScannerView.test.ts:177-200 (control absent for a Steam-review lead)
- **Quirks:** A whole category of leads is unmoderatable from this page and there is NO alternative control to remove a bad Steam-review lead — the only exits are visibility overrides elsewhere or the automatic staleness path. Any redesign that renders one uniform action row per lead will resurrect a control the server will always reject.

**Surface notes.**

SURFACE SHAPE: all four actions are reached from `/scanner` in admin mode; anonymous visitors receive PublicScannerView. The learning loop appears in this order: Action inbox → optional candidate teaching → automatic records → Wire/Asks context lanes → active lessons. Candidate and signal decisions therefore keep their rule-level revocation control in a later section, while hidden observations also keep a card-level Undo beside the affected item.

ORDERING AND CAPS: the teaching query is newest-first and capped at 30 eligible rows, with two initially visible. Kept leads are the newest 20, with six initially visible. Observations are the newest 40 for the current patch, and their decision lookup is scoped to those 40 ids so a hidden row cannot lose its card Undo. Active lessons has no explicit application limit after revoked/expired rules are filtered, but it also has no count or pagination; the hosted PostgREST row cap can truncate the admin ledger. The scanner-enforcement read has the same defect, and both order only by non-unique `created_at`, so pagination must add `id` as a deterministic tie-breaker. "No `.limit`" does not preserve recovery or enforcement for every active rule.

EMPTY STATES: preserve "Nothing needs teaching right now. New auto-rejects remain private and expire on their own.", "No kept source leads yet.", "No observations recorded for this patch yet.", and "No scanner lessons yet. Decisions you record above will appear here with an Undo control.", plus the pre-migration and Steam-review explanations.

REVERSAL BOUNDARY: Undo revokes the feedback rule, restores a hidden observation, returns an unrescued/unexpired rejected candidate, and can recompute a quarantined signal through cluster refresh only when that signal still has a cluster. An unclustered quarantined signal stays hidden, and a superseded same-scope rule is not reactivated. Revocation never deletes decision/rule audit rows, reverses `rescued_at`, removes the rescue run or signal, refunds spend, or replays sources skipped while a block rule was active. Broad path/domain rules affect future intake only; stored-signal re-evaluation deliberately uses exact-URL rules.

VERIFICATION: tests/e2e/operator-writes.spec.ts:57-96 submits rejectObservationAndTeach and its card Undo through the real server-action path, verifies HIDDEN/PUBLIC state and rule visibility, and proves public Ask removal/restoration. Candidate reject/Undo is covered at :99-119; Keep/rescue and its non-reversible Undo boundary at :122-170. Remaining observation gaps are invalid input, already-hidden refusal, exact RPC arguments, and missing-migration/error branches. `expires_at` remains implemented but no UI emits it, and RejectedArchive remains dead UI.

### /scanner in admin mode — AdminScannerView (src/components/scanner/AdminScannerView.tsx, 671 lines), mounted by src/app/scanner/page.tsx:48 inside OperatorShell

_43 controls · partition `inv:admin-scanner-view`_

#### `page-admin-branch` — (automatic) admin vs public branch on /scanner

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner — route entry, before any section renders
- **Does:** Loading /scanner runs isAdmin(); an admin gets AdminScannerView, everyone else gets PublicScannerView on the same URL.
- **Backing:** src/app/scanner/page.tsx:20-67 (branch at :25, admin mount at :48); guard fn src/lib/adminGuard.ts:13-18
- **Inputs:** ADMIN session cookie only (ADMIN_COOKIE, HMAC-verified against SESSION_SECRET). No query params read.
- **Writes:** read-only
- **Guard:** isAdmin() — non-throwing boolean cookie check (src/lib/adminGuard.ts:13). Deliberately NOT requireAdmin(), so anonymous visitors are not redirected to /admin/login (comment at src/app/scanner/page.tsx:17-19).
- **Revalidates:** export const dynamic = "force-dynamic" (src/app/scanner/page.tsx:15) — no caching, every load refetches
- **On failure:** If SESSION_SECRET is unset, adminSessionSecret() returns null and isAdmin() is false — the admin surface silently renders as the public view with no error. getAutomationAdminData() throws propagate to the route error boundary.
- **Tests:** tests/adminScannerView.test.ts
- **Quirks:** One URL, two entirely different pages. Any redesign that moves the admin surface to /admin/scanner breaks the existing 'same link works for both audiences' contract. All 13 props are fetched server-side in one pass (src/app/scanner/page.tsx:43); AdminScannerView is a pure server component with no client state of its own.

#### `now-iso-freeze` — (automatic) server-captured nowIso timestamp

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner — computed at page load, feeds every section
- **Does:** Freezes one timestamp at render and uses it for every relative time on the page (status line, lead 'last seen', teaching-desk expiry).
- **Backing:** src/app/scanner/page.tsx:44 (nowIso), consumed at src/components/scanner/AdminScannerView.tsx:344-345 and passed to ScannerFeedbackDesk at :551 and FeedbackRulesPanel at :664
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** No failure path — pure computation.
- **Tests:** tests/adminScannerView.test.ts:68 "freezes teaching-desk relative times at the server-captured instant"
- **Quirks:** Pinned by test. A redesign that computes Date.now() inside child components instead of threading nowIso will break that test and reintroduce hydration drift.

#### `scan-dry-run-button` — Test scan without publishing

- **Kind:** button · **Destructive:** reversible
- **Reach:** Header (dispatch-pagehead) > .op-actions > ScanControls — first control on the page
- **Does:** POSTs {mode:"dry_run"} to start a scan that searches and screens but does not persist leads.
- **Backing:** src/components/ScanControls.tsx:140-147 (button), :102-131 (start fn); route src/app/api/admin/scan/route.ts:11-37
- **Inputs:** No fields. Body is hard-coded {mode:"dry_run"}; route rejects anything but manual\|dry_run (route.ts:21-23).
- **Writes:** automation_runs (insert run row + progress/skips/errors/counter updates, src/lib/automation/run.ts:158/173/198/420/428); dry_run SKIPS: lifecycle pass, quarantineStalePublicSignals, Steam collection, persistSignals, persistRejectedCandidates, patch-note sync (run.ts:2373, 2391, 2401, 2424, 2463, 2502); still spends real Tavily search credits and real LLM calls — the dry_run guards skip persistence, not searching
- **Guard:** isAdmin() → 401 (route.ts:12); isVercelPreview() → 403 preview_writes_disabled (route.ts:13)
- **Revalidates:** none for dry_run — after() only calls revalidatePublicSurfaces() when mode === "manual" (route.ts:33)
- **On failure:** 409 → inline 'A scan is already running — give it a minute.' 403 → 'Scans are disabled on preview deployments.' Other non-ok → 'Could not start the scan. Try again.' Network throw → 'Could not reach the scan API.' All rendered as role="alert" text at ScanControls.tsx:158-162.
- **Tests:** tests/adminScanRoute.test.ts
- **Quirks:** Label says 'without publishing' but it still writes an automation_runs row and burns paid Tavily/LLM budget — an operator reading the label as 'free rehearsal' is wrong. Disabled whenever any scan is running or either button is mid-start (:143), so the two scan buttons are coupled: they share the `starting` and `scanning` state.

#### `scan-manual-run-button` — Run capped scan now

- **Kind:** button · **Destructive:** reversible
- **Reach:** Header (dispatch-pagehead) > .op-actions > ScanControls — second control
- **Does:** POSTs {mode:"manual"} to run the full pipeline, persisting leads and promoting clusters.
- **Backing:** src/components/ScanControls.tsx:148-155 (button), :102-131 (start fn); route src/app/api/admin/scan/route.ts:11-37
- **Inputs:** No fields. Body hard-coded {mode:"manual"}. Budget comes from stored policy via getAutomationControlState() (route.ts:25).
- **Writes:** automation_runs (run row, status, progress, skips, errors, counters); source_signals (insert/upsert, public_status, promotion fields); issue_clusters (stats, visibility_revision, promotion); automation_rejected_candidates (insert + expiry delete); signal_observation_events; patch_observations (via rpc persist_patch_observations, src/lib/automation/observations.ts:135); steam_pulse_snapshots, steam_review_receipts, platform_context_snapshots; bug_reports / approved_excerpts reads + issue_clusters writes in the lifecycle pass
- **Guard:** isAdmin() → 401 (route.ts:12); isVercelPreview() → 403 (route.ts:13)
- **Revalidates:** after(): revalidatePublicSurfaces() once the run completes (route.ts:31-34) → tags PUBLIC_DASHBOARD/PUBLIC_ISSUES/CURRENT_PATCH + paths /, /issues, /report, /scanner (src/lib/revalidate.ts:10-22)
- **On failure:** Same inline error set as the dry-run button. If the serverless instance dies before after() fires, the status-poll route re-revalidates within a 2-minute window (src/app/api/admin/scan/status/route.ts:42-50).
- **Tests:** tests/adminScanRoute.test.ts
- **Quirks:** maxDuration = 300 on the route (route.ts:9) — a redesign that moves this behind a server action loses that budget. 'Capped' refers to the stored policy caps, which are edited in a collapsed disclosure at the very bottom of the right rail — the cap and the button that respects it are ~240 lines apart in the layout.

#### `scan-status-poll` — (automatic) live scan status polling

- **Kind:** automatic · **Destructive:** none
- **Reach:** Header > .op-actions > ScanControls — starts on mount if a run is active, and after either scan button
- **Does:** Polls GET /api/admin/scan/status?id=<runId> every 2.5s, renders a live stage/progress readout, then calls router.refresh() when the run leaves 'running'.
- **Backing:** src/components/ScanControls.tsx:57-100 (effect), :40-41 (POLL_MS=2500, MAX_POLL_FAILURES=4), readout at :164-199; route src/app/api/admin/scan/status/route.ts:25-53
- **Inputs:** runId from state; seeded from the activeRun prop at mount only (AdminScannerView.tsx:374 passes activeRun?.id).
- **Writes:** automation_runs.status — sweepStaleRuns() runs on EVERY status poll (status/route.ts:31), so a read-shaped GET performs a write; revalidatePublicSurfaces() when a manual run finished under 2 minutes ago (status/route.ts:43-50)
- **Guard:** isAdmin() → 401 (status/route.ts:26)
- **Revalidates:** /; /issues; /report; /scanner + PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG (conditional, status/route.ts:49)
- **On failure:** 401 mid-scan → polling stops, 'Your session expired — sign in again to check the scan.' (ScanControls.tsx:64-71). 4 consecutive transient failures → stops with 'Lost contact with the scan — refresh the page to check its status.' (:87-91). Route errors: missing id → 400, read failure → 500, unknown id → 404.
- **Tests:** tests/adminScanRoute.test.ts
- **Quirks:** Deliberate design note at ScanControls.tsx:45 — runId seeds from activeRunId at MOUNT ONLY, so post-refresh prop changes must not restart polling. A redesign that remounts ScanControls (new key, moved into a conditional branch, wrapped in a disclosure) will re-trigger polling for a finished run. The finished-state readout persists until the next navigation (`finished` at :135), so the header keeps a 'Scan finished' box on screen after the refresh.

#### `paused-integration-chips` — <PROVIDER> PAUSED (status line chips)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Status line (.op-status-line), directly under the header
- **Does:** Renders one amber chip per paused integration alongside scanner state, last-scan and next-check times.
- **Backing:** src/components/scanner/AdminScannerView.tsx:378-391 (chips at :385-390); integrations computed at src/app/scanner/page.tsx:23 via applyLlmCircuitToStatuses
- **Inputs:** none — display only
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** No failure path.
- **Tests:** —
- **Quirks:** Not clickable — a paused provider is reported here but has no control anywhere on this page to unpause it. pausedIntegrations also feeds attentionCount (:357), which drives both the 'Needs attention' stat cell and the Action-inbox headline, so this list silently changes two other sections.

#### `radar-stat-band` — New leads · 24h / Re-observed · 24h / Needs attention / Failed runs · 7d / Source dates

- **Kind:** automatic · **Destructive:** none
- **Reach:** Stat band 1 (.stat-band--radar) — conditional, only when radar.connected
- **Does:** Five read-only KPI cells summarizing the last 24h/7d of radar activity and health.
- **Backing:** src/components/scanner/AdminScannerView.tsx:393-455 (guard at :393)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** Entire band disappears when radar.connected is false (:455 → null). No placeholder, no explanation.
- **Tests:** —
- **Quirks:** Whole band is conditional on radar.connected — a redesign tested against a connected fixture will never see the collapsed layout. 'Source dates' cell exists specifically to expose the known Tavily missing-publication-date problem (caption at :451-452); dropping it hides a documented data-quality gap.

#### `desk-funnel-row` — This week · N candidates reviewed (segmented funnel + Awaiting / Published / Radar yield)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Stat band 2, branch A (.desk-funnel) — only when radar.connected AND radar.funnel7d.reviewed > 0
- **Does:** Renders a proportional SegmentedFunnelBar plus three KPI numbers.
- **Backing:** src/components/scanner/AdminScannerView.tsx:457-489; bar component src/components/dispatch/RadarCharts.tsx (SegmentedFunnelBar)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** Falls through to the fallback stat band (branch B) when either condition fails.
- **Tests:** —
- **Quirks:** Mutually exclusive with fallback-stat-band and they show DIFFERENT metrics. The 'Filtered' count is only a discrete number in branch B; in branch A it exists solely as a bar segment. 'Reviewed · 7d' becomes a text label instead of a stat. Inline comment at :458-460 records the reason (two stat bands read as clones) — a redesign that re-flattens this into a second band reverts a deliberate decision.

#### `fallback-stat-band` — Reviewed · 7d / Filtered / Awaiting corroboration / Published issues / Live·Watching·Kept

- **Kind:** automatic · **Destructive:** none
- **Reach:** Stat band 2, branch B (.stat-band) — when radar is disconnected or the week has no reviewed candidates
- **Does:** Five read-only cells covering the same week from the scoreboard rather than the radar.
- **Backing:** src/components/scanner/AdminScannerView.tsx:491-515
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** `getPublicScannerDataUncached` can return an all-zero fallback with `scannerConnected=false` after a component read error or its broad catch. This branch ignores `scoreboard.scannerConnected` and renders those zeroes as ordinary values, including `llmPaused=false`.
- **Tests:** —
- **Quirks:** Fifth cell packs three numbers into a LABEL ('Live N · Watching N · Kept N') with the yield percentage as the value and 'radar yield' as the caption — label/value/caption are semantically inverted versus every other cell. Uses the locked Phase-3b vocabulary (published/watching/kept); renaming these breaks the one-word-per-number rule. Phase 4 must gate this whole band on `scannerConnected` and surface unavailable/unknown instead of accepting the broad all-zero fallback.

#### `action-inbox-summary` — Action inbox — "Nothing requires intervention." / "N scanner health items need a look."

- **Kind:** automatic · **Destructive:** none
- **Reach:** Action inbox section (.operator-inbox), after the stat bands
- **Does:** States whether anything needs the operator, explains that auto-rejected pages are optional, and shows three fact counters.
- **Backing:** src/components/scanner/AdminScannerView.tsx:518-535; attentionCount computed at :357; optionalCandidates at :351-353
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** A failed Patch Radar run read is converted to `connected=false` with `runs7d.failed=0`. This component ignores `connected`, consumes that zero, removes the radar band, and can render "Nothing requires intervention." despite unknown health.
- **Tests:** Happy-path operator screenshots pin the headline, but no test forces either radar run read to fail and proves the inbox cannot clear.
- **Quirks:** Three coupled derivations live here. (1) attentionCount = failed runs 7d + paused integrations, the same number rendered in the 'Needs attention' stat cell; it has no disconnected/unknown term, which creates the false-clear failure above. (2) The body paragraph swaps entirely on feedbackLearningAvailable (:523-525). (3) The 'optional teaching candidates' count filters on !rescued_at && !decision_id && !feedback_rule_id (:351-353), but getAutomationAdminData already excludes exactly those rows server-side (src/lib/queries.ts:1167-1170) and the legacy fallback nulls both id fields (queries.ts:1197-1198) — so this filter can never remove anything and optionalCandidates.length always equals rejectedCandidates.length. Dead logic that looks load-bearing.

#### `teach-scanner-desk-mount` — Teach the scanner · Optional — "Review the pattern, not a dropdown farm."

- **Kind:** disclosure · **Destructive:** reversible
- **Reach:** Operator workbench > main column (.operator-workbench__main) — left of the rail
- **Does:** Section wrapper that mounts ScannerFeedbackDesk, the retained-candidate teaching surface.
- **Backing:** src/components/scanner/AdminScannerView.tsx:538-554 (mount at :549-553); inner controls in src/components/scanner/ScannerFeedbackDesk.tsx:145-225
- **Inputs:** Props only: candidates=rejectedCandidates (NOT optionalCandidates), nowIso, feedbackLearningAvailable.
- **Writes:** delegated — see ScannerFeedbackDesk inventory. Its Keep/Reject forms post to recordScannerDecision (candidate path): scanner_decisions, scanner_feedback_rules, automation_rejected_candidates.decision_id/feedback_rule_id/decided_at/rescued_at, and source_signals via rescueCandidateSignal
- **Guard:** Section renders unconditionally; the inner forms are gated by feedbackLearningAvailable and by requireAdmin() inside the action.
- **Revalidates:** delegated to recordScannerDecision (src/app/admin/actions.ts:605-608)
- **On failure:** Delegated. Note the desk receives rejectedCandidates while the inbox counter above it reports optionalCandidates — same array today, but two names for it.
- **Tests:** tests/adminScannerView.test.ts:103 is named "keeps every retained lead reachable and gives each one an explicit teaching action", but its fixture covers only leads returned to the component; it does not prove reachability beyond the query's newest-20 cap.
- **Quirks:** Inner controls (filter text input at ScannerFeedbackDesk.tsx:181, 'Keep this lead' hidden-field form at :79-83, 'Reject and teach…' disclosure at :91-128, 'Show N more optional candidates' disclosure at :202, per-candidate source link at :56) belong to that file and are NOT inventoried here — but they are part of this page's surface and must survive the reorg. Its confirm_broad checkbox is `required` (:128) while the observation one on this page is not — an asymmetry a shared component would erase.

#### `latest-run-block` — Latest run (plain sentence + Search / Candidates / LLM / Cost facts)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Operator workbench > right rail (.operator-workbench__rail) > first block (.op-rail-block)
- **Does:** Renders one plain-English sentence about the most recent real run plus four numeric facts.
- **Backing:** src/components/scanner/AdminScannerView.tsx:556-573; sentence builder plainRunLine at :80-100; operator summary via summarizeRunMessages (src/lib/automation/runDisplay.ts)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** latestRun null → 'No completed scan yet.' (:572). Failed runs get is-crimson styling (:561).
- **Tests:** —
- **Quirks:** latestRealRun is fetched unbounded, deliberately not from the 10-row runs slice, because skip rows can bury the real last scan during a paused stretch (comment at src/lib/queries.ts:1221-1222). So this block and the Scan-history disclosure below it can legitimately disagree about 'the last run'.

#### `scan-history-disclosure` — Scan history and diagnostics

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Operator workbench > right rail > disclosure 1 (details.operator-disclosure)
- **Does:** Expands to a list of the 8 most recent runs — Eastern timestamp, plain sentence, cost.
- **Backing:** src/components/scanner/AdminScannerView.tsx:575-597 (rows at :578-584)
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** No empty state — with zero runs the disclosure opens onto an empty body containing only the nested raw-diagnostics summary.
- **Tests:** —
- **Quirks:** Collapsed by default and shows runs.slice(0,8) while the query fetches 10 (src/lib/queries.ts:1160) — the 2 oldest fetched runs are unreachable in the UI. The timestamp is post-processed with a regex that strips the leading 'Month D, YYYY, ' (:580); moving to a different formatter will leak full dates into a narrow rail.

#### `raw-diagnostics-disclosure` — Raw funnel, skip, and error codes

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Operator workbench > right rail > disclosure 1 > NESTED disclosure (details.raw-diagnostics)
- **Does:** Second-level expand showing the raw funnel string plus comma-joined skip and error codes per run.
- **Backing:** src/components/scanner/AdminScannerView.tsx:585-595; funnelSummary at :70-78
- **Inputs:** none
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** funnelSummary returns null if ANY of candidatesSeen/deduped/prefilterRejected/llmEligible/llmCalls/kept/promoted is undefined (:73-75), so older runs silently show only skips/errors.
- **Tests:** —
- **Quirks:** Two disclosure levels deep — this is the only place raw skip/error codes are visible anywhere in the admin UI. Flattening the parent disclosure changes its reachability; deleting it removes the operator's only view of machine-readable failure codes. searchResultsSeen is optional and prefixes the string only when present (:76).

#### `cadence-budget-disclosure` — Scanner cadence and budget

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Operator workbench > right rail > disclosure 2 (details.operator-disclosure) — last element of the rail
- **Does:** Expands to the only settings form on the page: the setScannerPolicy form.
- **Backing:** src/components/scanner/AdminScannerView.tsx:599-616 (form at :601)
- **Inputs:** none itself — wraps the policy form
- **Writes:** read-only (wrapper)
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/adminScannerView.test.ts:36
- **Quirks:** Collapsed by default, at the bottom of the right rail, below a scan-history disclosure — the page's only budget/cadence control is its least reachable element while the button that spends that budget is the first element on the page.

#### `policy-min-interval-hidden` — minIntervalMinutes (hidden input)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Right rail > Scanner cadence and budget > form field 1 (hidden)
- **Does:** Echoes the current interval back so the policy write can preserve it when the cadence select is not the source of truth.
- **Backing:** src/components/scanner/AdminScannerView.tsx:602; consumed at src/lib/automation/settings.ts:118
- **Inputs:** value = control.minIntervalMinutes
- **Writes:** automation_settings.value->minIntervalMinutes (only when cadence is absent or 'paused')
- **Guard:** requireAdmin() + assertProductionWriteAllowed() in setScannerPolicy (src/app/admin/actions.ts:458-459)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Normalized by oneOfNumber against MIN_INTERVAL_MINUTES; an out-of-set value falls back to the default rather than erroring (settings.ts:98-102).
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Behavior-changing hidden input. Because scannerPolicyFromFormData prefers `cadence` when it is present and not 'paused' (settings.ts:118), this field is ONLY read when the operator picks 'Paused' — that is what preserves the old interval across a pause. Deleting it makes Pause reset cadence to the default.

#### `policy-model-preset-hidden` — modelPreset (hidden input)

- **Kind:** form · **Destructive:** none
- **Reach:** Right rail > Scanner cadence and budget > form field 2 (hidden)
- **Does:** Round-trips the model preset through the form.
- **Backing:** src/components/scanner/AdminScannerView.tsx:603; normalized at src/lib/automation/settings.ts:110
- **Inputs:** value = control.modelPreset
- **Writes:** automation_settings.value->modelPreset
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:458-459)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** normalizeScannerPolicy accepts only the single MODEL_PRESET constant and otherwise substitutes the default (settings.ts:110).
- **Tests:** —
- **Quirks:** Effectively dead — there is exactly one legal preset, so this field can never change the stored value. It exists to keep the write shape complete. Safe to drop only if the write path stops depending on the form for that key.

#### `policy-cadence-select` — How often

- **Kind:** select · **Destructive:** reversible
- **Reach:** Right rail > Scanner cadence and budget > form field 3
- **Does:** Sets the scheduled scan interval, or pauses scheduled scanning entirely.
- **Backing:** src/components/scanner/AdminScannerView.tsx:604-607; parsed at src/lib/automation/settings.ts:114-124
- **Inputs:** name=cadence; options 60 / 120 / 360 / 1440 / "paused"; defaultValue = paused ? "paused" : String(control.minIntervalMinutes). Not marked required; no client validation.
- **Writes:** automation_settings.value->paused; automation_settings.value->minIntervalMinutes; automation_settings.updated_at (src/lib/automation/settings.ts:143-153)
- **Guard:** requireAdmin() → redirect('/admin/login'); assertProductionWriteAllowed() → throws 'preview writes disabled' on VERCEL_ENV=preview (actions.ts:458-459)
- **Revalidates:** /admin (actions.ts:464); /scanner (:465); /admin/source-monitor (:466); revalidatePublicSurfaces(): tags PUBLIC_DASHBOARD/PUBLIC_ISSUES/CURRENT_PATCH + paths /, /issues, /report, /scanner (src/lib/revalidate.ts:10-22)
- **On failure:** Invalid values are silently normalized to the default interval, never rejected (settings.ts:76-79, 98-102). A write failure throws 'automation settings write failed: …' (settings.ts:152) with NO inline error UI on this page — the operator gets the Next.js error overlay and loses the whole form.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** ONE control conflating TWO stored fields: 'Paused' is an option in the cadence list, so pause state and interval share a widget. A redesign that splits pause into its own toggle must keep both keys written together, and must keep the minIntervalMinutes hidden input feeding the pause case. Pausing here is also the only pause affordance on this page — setAutomationPaused (actions.ts:446) exists but is NOT wired to any control in AdminScannerView. Status chip 'PAUSED' at :48 reads control.paused, so the header state flips only after this form is saved.

#### `policy-search-depth-select` — Search depth

- **Kind:** select · **Destructive:** reversible
- **Reach:** Right rail > Scanner cadence and budget > form field 4
- **Does:** Sets how many Tavily search credits each scheduled run may spend.
- **Backing:** src/components/scanner/AdminScannerView.tsx:608-610; parsed at src/lib/automation/settings.ts:119, validated at :103-107
- **Inputs:** name=scheduledSearchCreditsPerRun; options 1 / 2 / 3; defaultValue = String(control.scheduledSearchCreditsPerRun). Values outside SCHEDULED_SEARCH_CREDITS_PER_RUN fall back to the default.
- **Writes:** automation_settings.value->scheduledSearchCreditsPerRun; automation_settings.updated_at
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:458-459)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Same as policy-cadence-select — silent normalization, no inline error surface on write failure.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Coupled to the projection note below it: projectedMonthlyCredits (:30-33) multiplies this by the cadence, so changing either select makes the printed projection stale until the page reloads (the note renders from saved `control`, not from live form state).

#### `policy-monthly-tavily-cap-input` — Monthly search cap

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** Right rail > Scanner cadence and budget > form field 5
- **Does:** Sets the hard monthly ceiling on Tavily search credits.
- **Backing:** src/components/scanner/AdminScannerView.tsx:611; clamped at src/lib/automation/settings.ts:81-86
- **Inputs:** name=monthlyTavilyCreditCap; type=number, min=0, max=1000, step=1; defaultValue = control.monthlyTavilyCreditCap. Server clamps to MAX_MONTHLY_TAVILY_CREDIT_CAP and floors; negative/NaN falls back to the default.
- **Writes:** automation_settings.value->monthlyTavilyCreditCap; automation_settings.updated_at
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:458-459)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Out-of-range input is clamped server-side, not rejected — the operator can submit 999999 and see 1000 saved with no message. Write failure throws with no inline UI.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** The native max (1000) mirrors a server constant; if the constant changes and the attribute does not, the form silently blocks legal values. This cap is what produces the CAPPED status chip via runHasCapSkip (:35-40, :49) — a redesign must keep the chip and this field conceptually linked.

#### `policy-monthly-llm-cap-input` — Monthly LLM cap ($)

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** Right rail > Scanner cadence and budget > form field 6
- **Does:** Sets the monthly USD ceiling on LLM spend.
- **Backing:** src/components/scanner/AdminScannerView.tsx:612; clamped at src/lib/automation/settings.ts:88-92
- **Inputs:** name=monthlyLlmUsdCap; type=number, min=0, max=2, step=0.25; defaultValue = control.monthlyLlmUsdCap. Server clamps to MAX_MONTHLY_LLM_USD_CAP.
- **Writes:** automation_settings.value->monthlyLlmUsdCap; automation_settings.updated_at
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:458-459)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Clamped, not rejected. Write failure throws with no inline UI.
- **Tests:** tests/adminScannerView.test.ts:36 "keeps the owner-approved two-dollar LLM cap inside native form validation"
- **Quirks:** max="2" and step="0.25" are explicitly pinned by test — this is an owner-approved number, not an arbitrary attribute. Any redesign that swaps this for a slider, a preset picker, or a differently-attributed input will fail that test. The cap is also printed in the note below with .toFixed(2) (:613).

#### `policy-projection-note` — About N scheduled Tavily credits monthly at this setting… (op-note)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Right rail > Scanner cadence and budget > note above the save button
- **Does:** Prints the projected monthly credit burn, the caps, and the current cadence in words.
- **Backing:** src/components/scanner/AdminScannerView.tsx:613; projectedMonthlyCredits at :30-33; cadenceLabel at :23-28
- **Inputs:** none — reads saved `control`, not live form values
- **Writes:** read-only
- **Guard:** inherits page-admin-branch
- **Revalidates:** —
- **On failure:** Returns 0 credits when paused (:31).
- **Tests:** —
- **Quirks:** Stale-by-design: it describes the SAVED policy while sitting inside a form whose selects may already show different values. cadenceLabel has no branch for arbitrary intervals — anything that is not 60/120/360 renders as 'daily' (:23-27), so a new cadence option would be mislabeled.

#### `policy-save-button` — Save settings

- **Kind:** button · **Destructive:** reversible
- **Reach:** Right rail > Scanner cadence and budget > submit (last control in the workbench)
- **Does:** Submits the whole cadence/budget form to setScannerPolicy.
- **Backing:** src/components/scanner/AdminScannerView.tsx:614 (SubmitButton); component src/components/SubmitButton.tsx:6-21; action src/app/admin/actions.ts:457-468
- **Inputs:** Submits all six fields above as one FormData; parsed by scannerPolicyFromFormData (src/lib/automation/settings.ts:114-124).
- **Writes:** automation_settings row key='scanner': value (jsonb: paused, minIntervalMinutes, scheduledSearchCreditsPerRun, monthlyTavilyCreditCap, monthlyLlmUsdCap, modelPreset), updated_at — upsert onConflict key (settings.ts:143-153)
- **Guard:** requireAdmin() → redirect('/admin/login'); assertProductionWriteAllowed() → throw on Vercel preview (actions.ts:458-459)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; revalidatePublicSurfaces() → PUBLIC_DASHBOARD/PUBLIC_ISSUES/CURRENT_PATCH tags + /, /issues, /report, /scanner
- **On failure:** Any throw (auth redirect aside) is unhandled by this page — no error boundary, no inline message, no toast. The operator sees the framework error surface and the form's unsaved values are gone.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Disabled + aria-busy while pending, with pendingText 'Saving...' (note: three ASCII dots here, while every other pendingText on the page uses the … character — a real inconsistency: 'Removing lead…', 'Undoing…', 'Rejecting…'). No confirmation step even though saving immediately changes scheduled spend and revalidates every public page.

#### `signal-open-source-link` — Open source (per kept lead)

- **Kind:** link · **Destructive:** none
- **Reach:** Automatic records > What the scanner kept > lead card > provenance list > State row
- **Does:** Opens the lead's source URL in a new tab.
- **Backing:** src/components/scanner/AdminScannerView.tsx:163-165 (inside signalRow, :123-214)
- **Inputs:** href = signal.source_url (raw, not canonical_url)
- **Writes:** read-only
- **Guard:** none beyond page access
- **Revalidates:** —
- **On failure:** Dead/removed source URLs fail in the browser; nothing here validates them.
- **Tests:** —
- **Quirks:** target=_blank with rel="noreferrer noopener" — keep both. Note the link uses source_url while the teaching rule built by 'Remove lead' targets canonical_url ?? source_url (actions.ts:516), so the page the operator inspects is not always the URL the rule blocks.

#### `signal-remove-disclosure` — Remove bad lead

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Automatic records > lead card > per-lead disclosure (details.lead-feedback), rendered only when learning is available and the lead is not a Steam review
- **Does:** Reveals the per-lead teaching form.
- **Backing:** src/components/scanner/AdminScannerView.tsx:177-178; conditional chain at :169-176
- **Inputs:** none
- **Writes:** read-only (wrapper)
- **Guard:** Rendered only if feedbackLearningAvailable && !isSteamReview (:169, :171)
- **Revalidates:** —
- **On failure:** Replaced by a sentence in both fallback states: 'Scanner learning unlocks after the database schema update.' (:170) or the Steam-review explanation (:172-175).
- **Tests:** tests/adminScannerView.test.ts:154 "does not offer a shared-URL teaching action for a Steam review lead"; tests/adminScannerView.test.ts:264 "hides scanner-learning actions until the feedback schema is available"
- **Quirks:** Three-way conditional render, two of the three branches are text-only. isSteamReview checks BOTH signal.source and signal.source_type (:124) because either can carry the value — a redesign that checks only one reintroduces the shared-URL bug the server also rejects (actions.ts:512-514). Both fallback branches are pinned by tests.

#### `signal-id-hidden` — id (hidden input, signal form)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Automatic records > lead card > Remove bad lead > hidden field
- **Does:** Identifies which source_signals row the decision applies to.
- **Backing:** src/components/scanner/AdminScannerView.tsx:180; read at src/app/admin/actions.ts:473
- **Inputs:** value = signal.id
- **Writes:** selects the source_signals row that gets hidden
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); server re-reads the row and throws 'source signal not found' if absent (actions.ts:511)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Missing/blank id → throw 'bad input' (actions.ts:481-492).
- **Tests:** tests/adminActions.test.ts
- **Quirks:** none beyond being required

#### `signal-target-kind-hidden` — target_kind=signal (hidden input)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Automatic records > lead card > Remove bad lead > hidden field
- **Does:** Switches recordScannerDecision from its candidate path to its signal path.
- **Backing:** src/components/scanner/AdminScannerView.tsx:181; branch at src/app/admin/actions.ts:474, :495-543
- **Inputs:** value = "signal" (constant)
- **Writes:** determines whether the RPC receives p_signal_id or p_candidate_id
- **Guard:** Server allows only 'candidate' \| 'signal' (actions.ts:485); defaults to 'candidate' when absent (:474)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Any other value → throw 'bad input'.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Behavior-changing hidden input, and the ONLY thing distinguishing this form from the visually similar teaching form in ScannerFeedbackDesk (which omits it and therefore takes the candidate path). Merging the two forms in a redesign silently reroutes writes to the wrong table.

#### `signal-scope-hidden` — scope=exact_url (hidden input)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Automatic records > lead card > Remove bad lead > hidden field
- **Does:** Hard-locks the resulting scanner rule to this one page.
- **Backing:** src/components/scanner/AdminScannerView.tsx:182; enforced at src/app/admin/actions.ts:488
- **Inputs:** value = "exact_url" (constant)
- **Writes:** scanner_feedback_rules.scope_type / scope_value = the canonical page URL
- **Guard:** Server rejects any signal decision where scope !== 'exact_url' OR confirm_broad is set OR decision === 'relevant' (actions.ts:488)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Violation → throw 'bad input'.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Deliberate asymmetry with the observation form, which DOES offer a domain scope. A redesign that unifies the two teaching forms and exposes a scope select for signals will hit a server-side 'bad input' with no inline error. The scope copy at :202-205 ('Removes only this source URL… the issue itself is unchanged') is the operator's only explanation of this.

#### `signal-decision-select` — Why this lead is wrong

- **Kind:** select · **Destructive:** reversible
- **Reach:** Automatic records > lead card > Remove bad lead > field 1
- **Does:** Chooses the recorded reason code for hiding the lead and blocking the URL.
- **Backing:** src/components/scanner/AdminScannerView.tsx:185-190; validated by isScannerDecision at src/app/admin/actions.ts:483
- **Inputs:** name=decision, required, defaultValue="off_topic"; options off_topic / wrong_patch / not_issue_report / duplicate
- **Writes:** scanner_decisions.decision; scanner_feedback_rules.decision (and rule action derived from it)
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); isScannerDecision() allowlist; 'relevant' explicitly rejected for signals (actions.ts:488)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Unknown value → throw 'bad input' with no inline error surface.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Four options here, but isScannerDecision also accepts 'relevant' — which is unreachable from this form by design and would be rejected anyway. Option LABELS differ from the observation form's for the same value: 'not_issue_report' reads 'Not an issue report' here (:188) and 'Not patch context' there (:272). Same stored value, two labels — intentional, and a shared component would flatten it.

#### `signal-reason-textarea` — Operator reason (signal form)

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** Automatic records > lead card > Remove bad lead > field 2
- **Does:** Captures the free-text justification stored on the decision and the rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:194-200; validated at src/app/admin/actions.ts:486-487
- **Inputs:** name=reason, required, minLength=3, maxLength=500, placeholder 'What made this source irrelevant?'
- **Writes:** scanner_decisions.reason (btrim'd); scanner_feedback_rules.reason (btrim'd)
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); server re-checks 3..500 after trim
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Out-of-range → throw 'bad input'. Whitespace-only passes native minLength but fails server-side trim — that mismatch produces an error page, not a field message.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** The 3/500 bounds are duplicated in markup and in the action; they must move together.

#### `signal-remove-submit` — Remove lead and teach scanner

- **Kind:** button · **Destructive:** reversible
- **Reach:** Automatic records > lead card > Remove bad lead > submit
- **Does:** Hides this one source lead and records a permanent, undoable exact-URL block rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:206-208; action src/app/admin/actions.ts:470-543 (signal path :495-542); RPC supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:74-232
- **Inputs:** id, target_kind=signal, scope=exact_url, decision, reason
- **Writes:** scanner_decisions INSERT (id, signal_id, target_url, target_url_hash, source_domain, decision, reason) — migration :153-171; scanner_feedback_rules INSERT (id, decision_id, action, decision, scope_type, scope_value, reason, confirmed_at, expires_at) — migration :173-193; scanner_feedback_rules.revoked_at + .superseded_by_rule_id on any prior active rule with the same scope — migration :195-201; source_signals.public_status='hidden', .promoted_at=null, .promotion_reason='operator_feedback_blocked' — migration :211-217; issue_clusters.visibility_revision += 1 — migration :223-227; then refreshClusterVisibility() → rpc apply_cluster_visibility_refresh: issue_clusters stats (signal_count, direct_report_count, verified_report_count, public_signal_count, last_signal_at, auto_public, is_public) + source_signals visibility patches (src/lib/automation/run.ts:1863-1877, 1886-1889)
- **Guard:** requireAdmin() → redirect('/admin/login'); assertProductionWriteAllowed() → throw on preview; server-side Steam-review rejection (actions.ts:512-514); full input validation at :481-493
- **Revalidates:** /admin (actions.ts:538); /scanner (:539); /admin/source-monitor (:540); revalidatePublicSurfaces() (:541)
- **On failure:** Read failure → 'source signal read failed: …'. Missing row → 'source signal not found'. RPC failure → 'scanner decision write failed: …'. Steam review → 'Steam review signals cannot create URL feedback rules'. NONE of these render inline — the page has no error boundary for server actions.
- **Tests:** tests/adminActions.test.ts; tests/adminScannerView.test.ts:103
- **Quirks:** CRITICAL COUPLING: this section renders NO undo control. The only way to reverse a signal removal is the Undo button in the 'Active lessons' ledger at the very bottom of the page (FeedbackRulesPanel, src/components/scanner/ScannerFeedbackDesk.tsx:243-244). Move, collapse, or drop that ledger and this action becomes irreversible from the UI. Also note the undo RPC does NOT restore source_signals.public_status directly — it only bumps issue_clusters.visibility_revision and relies on refreshClusterVisibility to recompute (migration 20260724200000_observation_moderation.sql:201-212), so 'undo' is a recomputation, not a literal restore.

#### `older-leads-disclosure` — Browse N older lead(s)

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Automatic records > below the 6-card grid — conditional, only when more than 6 leads exist
- **Does:** Expands to the remaining kept leads, each with the full signalRow control set.
- **Backing:** src/components/scanner/AdminScannerView.tsx:630-637; split at :354-355
- **Inputs:** none
- **Writes:** read-only (wrapper) — contains a full copy of every signal control above
- **Guard:** inherits page-admin-branch; rendered only if olderSignals.length > 0
- **Revalidates:** —
- **On failure:** n/a — absent when there are 6 or fewer leads
- **Tests:** tests/adminScannerView.test.ts:103 is named "keeps every retained lead reachable", scoped to the retained leads supplied by the newest-20 query window.
- **Quirks:** Hard-coded split at index 6 (:354-355) against a query capped at 20 (src/lib/queries.ts:1152), so this can hold at most 14 leads and there is no pagination beyond 20 — leads 21+ are unreachable in the admin UI entirely. The test pins that every returned lead after index 6 remains behind a disclosure; it does not prove reachability beyond the query window. Singular/plural handled inline at :632.

#### `observation-open-source-link` — Open source (per context-lane item)

- **Kind:** link · **Destructive:** none
- **Reach:** Context lanes > Wire and Asks on the Brief > item card > domain line
- **Does:** Opens the observation's source URL in a new tab.
- **Backing:** src/components/scanner/AdminScannerView.tsx:246-248 (inside observationRow, :230-309)
- **Inputs:** href = observation.url
- **Writes:** read-only
- **Guard:** none beyond page access
- **Revalidates:** —
- **On failure:** Falls back to 'unknown domain' text when source_domain is null (:245); the link itself always renders.
- **Tests:** —
- **Quirks:** target=_blank + rel="noreferrer noopener".

#### `observation-undo-decision-id-hidden` — decision_id (hidden input, undo form)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Context lanes > item card > undo form — only when observation.decision_id is set
- **Does:** Identifies the recorded decision to reverse.
- **Backing:** src/components/scanner/AdminScannerView.tsx:254; read at src/app/admin/actions.ts:711
- **Inputs:** value = observation.decision_id (latest non-undone decision, resolved in src/lib/queries.ts:1285-1296)
- **Writes:** selects the scanner_decisions row to mark undone
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:709-710)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Blank → throw 'bad input' (actions.ts:712).
- **Tests:** tests/adminActions.test.ts
- **Quirks:** decision_id is scoped to the listed observations on purpose — a global newest-200 read could let an active decision fall past the cap and strand a hidden item with no Undo (comment at src/lib/queries.ts:1265-1266). A redesign that paginates observations must keep the decision lookup scoped to the visible page.

#### `observation-undo-submit` — Undo — restore item and revoke rule

- **Kind:** button · **Destructive:** reversible
- **Reach:** Context lanes > item card > undo form (replaces the reject disclosure when the item is already decided)
- **Does:** Marks the decision undone, revokes its rule, restores the observation to the public lane.
- **Backing:** src/components/scanner/AdminScannerView.tsx:258-260 (SubmitButton), form at :253; action src/app/admin/actions.ts:708-728; RPC supabase/migrations/20260724200000_observation_moderation.sql:157-216
- **Inputs:** decision_id only
- **Writes:** scanner_decisions.undone_at = now() (migration :171-175); scanner_feedback_rules.revoked_at = now() for every rule on that decision (migration :182-184); automation_rejected_candidates.decision_id / .feedback_rule_id / .decided_at = null, only where rescued_at is null (migration :188-193); patch_observations.is_public = true (migration :195-199); issue_clusters.visibility_revision += 1 when the decision was a signal decision (migration :201-212); then refreshClusterVisibility() when affected_cluster_id is returned (actions.ts:723)
- **Guard:** requireAdmin() → redirect('/admin/login'); assertProductionWriteAllowed() → throw on preview (actions.ts:709-710)
- **Revalidates:** /admin (actions.ts:724); /scanner (:725); /admin/source-monitor (:726); revalidatePublicSurfaces() (:727)
- **On failure:** RPC error → 'scanner decision undo failed: …'. Already-undone or unknown id → 'scanner decision was already undone or not found' (actions.ts:722). No inline error surface — framework error page.
- **Tests:** tests/adminScannerView.test.ts:203 "gives each public context item one explicit action and hidden items an undo"; tests/adminActions.test.ts
- **Quirks:** This is a REPLACEMENT, not an addition: an item shows EITHER the undo form OR the reject disclosure, never both (:252 ternary). The same action also backs the Active-lessons ledger undo. Undo restores the item to the public Brief immediately — the label says so, and it is accurate.

#### `observation-reject-disclosure` — Reject and teach…

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Context lanes > item card > per-item disclosure — only when moderation is available AND the item has no active decision
- **Does:** Reveals the reject-and-teach form for a public Wire/Asks item.
- **Backing:** src/components/scanner/AdminScannerView.tsx:263-264; conditional chain at :250-262
- **Inputs:** none
- **Writes:** read-only (wrapper)
- **Guard:** Rendered only if observationModerationAvailable && !observation.decision_id
- **Revalidates:** —
- **On failure:** When moderation is unavailable, replaced by 'Observation moderation unlocks after the database schema update.' (:251).
- **Tests:** tests/adminScannerView.test.ts:203 (asserts exactly one 'Reject and teach…' per undecided item, count check at :261)
- **Quirks:** DEAD-END STATE: an observation with is_public=false but no decision_id (hidden by anything other than a recorded decision) renders this reject form, and submitting it always fails server-side with 'observation is already hidden — undo its existing decision before deciding again' (actions.ts:653-655, mirrored in the RPC at migration :98-101). The UI has no way to recover such a row. The label text 'Reject and teach…' is duplicated in ScannerFeedbackDesk.tsx:91 — the test at :261 counts occurrences, so adding another instance of that exact string anywhere on the page breaks it.

#### `observation-id-hidden` — id (hidden input, observation form)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Context lanes > item card > Reject and teach… > hidden field
- **Does:** Identifies the patch_observations row to hide.
- **Backing:** src/components/scanner/AdminScannerView.tsx:266; read at src/app/admin/actions.ts:622
- **Inputs:** value = observation.id
- **Writes:** selects the patch_observations row
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); server re-reads and throws 'observation not found' if absent (actions.ts:650)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Blank → throw 'bad input'.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Unlike the signal form, there is no target_kind field — rejectObservationAndTeach is a dedicated action.

#### `observation-decision-select` — Why this item is wrong

- **Kind:** select · **Destructive:** reversible
- **Reach:** Context lanes > item card > Reject and teach… > field 1
- **Does:** Chooses the reason code recorded on the decision and the rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:269-274; allowlist OBSERVATION_DECISIONS at src/app/admin/actions.ts:611, checked at :631
- **Inputs:** name=decision, required, defaultValue="off_topic"; options off_topic / wrong_patch / not_issue_report / duplicate
- **Writes:** scanner_decisions.decision; scanner_feedback_rules.decision
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); OBSERVATION_DECISIONS allowlist (no 'relevant')
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Unknown value → throw 'bad input' (actions.ts:629-638), no inline surface.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** 'not_issue_report' is labeled 'Not patch context' here but 'Not an issue report' on the signal form (:188) — same stored value, deliberately different operator-facing wording per lane. Preserve both.

#### `observation-reason-textarea` — Operator reason (observation form)

- **Kind:** text-input · **Destructive:** reversible
- **Reach:** Context lanes > item card > Reject and teach… > field 2
- **Does:** Captures the justification stored on the decision and the rule.
- **Backing:** src/components/scanner/AdminScannerView.tsx:278-284; validated at src/app/admin/actions.ts:633-634
- **Inputs:** name=reason, required, minLength=3, maxLength=500, placeholder 'What made this item wrong for the public lanes?'
- **Writes:** scanner_decisions.reason (btrim'd); scanner_feedback_rules.reason (btrim'd)
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); server re-checks 3..500
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Out-of-range → throw 'bad input'; no inline field error.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Different placeholder from the signal form's — lane-specific copy, not boilerplate.

#### `observation-scope-select` — Rule scope

- **Kind:** select · **Destructive:** reversible
- **Reach:** Context lanes > item card > Reject and teach… > field 3
- **Does:** Chooses whether the learned block rule covers this page only or the entire source domain.
- **Backing:** src/components/scanner/AdminScannerView.tsx:288-291; parsed at src/app/admin/actions.ts:625-627
- **Inputs:** name=scope, required, defaultValue="exact_url"; options exact_url ('This exact page only') / source_domain ('Whole domain (needs confirmation)')
- **Writes:** scanner_feedback_rules.scope_type; scanner_feedback_rules.scope_value (canonical URL or bare domain, via scannerRuleScopeValue); scanner_feedback_rules.confirmed_at — now() for exact_url, now() only if confirm_broad for source_domain (migration 20260724200000:139)
- **Guard:** requireAdmin() + assertProductionWriteAllowed(); scope must be one of the two values or the action throws (actions.ts:626-627, 632)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Domain scope without confirm_broad → throw 'bad input' (actions.ts:635). scannerRuleScopeValue returning null (e.g. no source_domain on the row) → throw 'bad input' (:665).
- **Tests:** tests/adminActions.test.ts
- **Quirks:** HARD COUPLING with the checkbox below it: the option label literally says '(needs confirmation)' and the server enforces it, but nothing in the markup links the two — see observation-confirm-broad-checkbox. Also note a domain-scoped rule blocks that domain for FUTURE discovery across every lane, not just this patch.

#### `observation-confirm-broad-checkbox` — Confirm whole-domain rule (required only for domain scope)

- **Kind:** form · **Destructive:** reversible
- **Reach:** Context lanes > item card > Reject and teach… > field 4
- **Does:** Explicit second acknowledgement that a domain-wide block rule is intended.
- **Backing:** src/components/scanner/AdminScannerView.tsx:293-296; read at src/app/admin/actions.ts:628, enforced at :635
- **Inputs:** name=confirm_broad, type=checkbox, value="true", NOT marked required, unchecked by default
- **Writes:** scanner_feedback_rules.confirmed_at (null when a broad rule is unconfirmed — but that path is unreachable because the action throws first)
- **Guard:** Server: scope !== 'exact_url' && !confirmBroad → throw 'bad input' (actions.ts:635); mirrored in the RPC's confirmed_at CASE (migration 20260724200000:139)
- **Revalidates:** /admin; /scanner; /admin/source-monitor; + revalidatePublicSurfaces()
- **On failure:** Choosing 'Whole domain' and leaving this unchecked passes native validation, submits, and throws a bare 'bad input' Error — full error page, form contents lost, no explanation of which field was wrong.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** ASYMMETRY WORTH PRESERVING OR FIXING DELIBERATELY: the equivalent checkbox in ScannerFeedbackDesk.tsx:128 IS marked `required`, so that form can never submit an unconfirmed broad rule; this one is not, so it can. If a redesign unifies these two forms it must pick a side consciously — today they behave differently for the same server contract. Checking this box while scope is exact_url is harmless and ignored.

#### `observation-reject-submit` — Reject and teach

- **Kind:** button · **Destructive:** reversible
- **Reach:** Context lanes > item card > Reject and teach… > submit
- **Does:** Hides the item from the public Wire/Asks lane and records an undoable block rule in one transaction.
- **Backing:** src/components/scanner/AdminScannerView.tsx:301-303 (SubmitButton), form at :265; action src/app/admin/actions.ts:619-694; RPC supabase/migrations/20260724200000_observation_moderation.sql:24-153
- **Inputs:** id, decision, reason, scope, confirm_broad
- **Writes:** patch_observations.is_public = false (migration :93-96) — this doubles as the concurrency guard; scanner_decisions INSERT (id, observation_id, target_url, target_url_hash, source_domain, decision, reason) — migration :103-119; scanner_feedback_rules INSERT (id, decision_id, action='block', decision, scope_type, scope_value, reason, confirmed_at, expires_at=null) — migration :121-141; scanner_feedback_rules.revoked_at + .superseded_by_rule_id on prior active same-scope rules — migration :143-149
- **Guard:** requireAdmin() → redirect('/admin/login'); assertProductionWriteAllowed() → throw on preview (actions.ts:620-621); pre-check that the observation is still public (:653-655); RPC re-checks inside the advisory-locked transaction (migration :98-101)
- **Revalidates:** /admin (actions.ts:690); /scanner (:691); /admin/source-monitor (:692); revalidatePublicSurfaces() (:693)
- **On failure:** Missing migration → explicit message 'Observation moderation needs the 20260724200000_observation_moderation migration; the item was not changed.' (actions.ts:682-686). Already hidden → the 55000 exception surfaces. Read failure → 'observation read failed: …'. Other RPC failure → 'observation decision write failed: …'. None render inline.
- **Tests:** tests/adminScannerView.test.ts:203; tests/adminActions.test.ts
- **Quirks:** Publishes-adjacent: this immediately removes content from the public Brief with no confirmation dialog (only the domain-scope checkbox gates anything). The scope note at :297-300 ('Two records, one Undo') is the operator's only explanation that one click writes two audit rows. expires_at is hard-coded null (actions.ts:677) — observation rules never expire, unlike candidate rules which can carry an expiry.

#### `feedback-rules-panel-mount` — Active lessons — "What the scanner will remember"

- **Kind:** disclosure · **Destructive:** reversible
- **Reach:** Active lessons section (.feedback-ledger) — LAST section on the page
- **Does:** Renders the ledger of active scanner rules, each with an Undo control; or a schema-pending sentence.
- **Backing:** src/components/scanner/AdminScannerView.tsx:658-668 (mount at :664); panel src/components/scanner/ScannerFeedbackDesk.tsx:227-244 (undo form at :243-244)
- **Inputs:** Props: rules=feedbackRules (already filtered to unexpired at src/lib/queries.ts:1305-1307), nowIso
- **Writes:** delegated — the panel's Undo posts to undoScannerDecision: scanner_decisions.undone_at, scanner_feedback_rules.revoked_at, automation_rejected_candidates.decision_id/feedback_rule_id/decided_at, patch_observations.is_public, issue_clusters.visibility_revision
- **Guard:** Section always renders; the panel renders only if feedbackLearningAvailable (:663), else the fallback sentence at :666
- **Revalidates:** delegated to undoScannerDecision (src/app/admin/actions.ts:724-727)
- **On failure:** feedbackLearningAvailable false → 'Scanner learning unlocks after the database schema update.' (:666).
- **Tests:** tests/adminScannerView.test.ts:264
- **Quirks:** THIS IS THE RULE-REVOCATION PATH OF LAST RESORT for signal removals — the 'Automatic records' section offers no recovery of its own, so if this ledger is dropped, collapsed behind something unreachable, or moved off-page, 'Remove bad lead' becomes one-way. Even with the ledger, revocation is not full restoration: an unclustered signal remains hidden. It is currently the very last thing on a long page. The section note at :661 ('Visibility and learning stay separate…') is the page's statement of a core product invariant — copy worth carrying over verbatim.

**Surface notes.** INFORMATION ARCHITECTURE, IN RENDER ORDER (AdminScannerView.tsx:360-670)  1. Header — "Operator · The Observatory / Today's radar desk" (:362-376). Kicker, 44px title, dek, and .op-actions holding <ScanControls>. The two scan buttons are the first controls on the page. Always rendered.  2. Status line (:378-391). One-line inline readout: state chip (ACTIVE/RUNNING/PAUSED/CAPPED via scannerStatus at :42-51), last scan, next check, most-recent-kept-lead, plus one amber chip per paused integration. No controls. Conditional fragments: "MOST RECENT KEPT LEAD" only when latestFind exists; "NEXT CHECK PAUSED" when control.paused; integration chips only when a provider is paused.  3. Radar stat band (:393-455). Five KPI cells. ENTIRELY CONDITIONAL on radar.connected — renders null otherwise.  4. Funnel row OR fallback stat band (:457-516). Two mutually exclusive layouts with different metrics. Branch A (.desk-funnel: SegmentedFunnelBar + Awaiting/Published/Radar yield) requires radar.connected AND funnel7d.reviewed > 0. Branch B (.stat-band: Reviewed/Filtered/Awaiting/Published/composite) is the fallback. "Filtered" exists as a discrete number only in Branch B.  5. Action inbox (:518-535). Prose triage summary. Headline flips on attentionCount === 0; the explanatory paragraph swaps entirely on feedbackLearningAvailable; three fact spans below (failed runs 7d, optional teaching candidates, active lessons — the third also swaps to "Learning schema pending").  6. Operator workbench (:537-618) — two columns.    6a. Main column: "Teach the scanner · Optional" heading + <ScannerFeedbackDesk> (the retained-candidate teaching surface; its own controls live in ScannerFeedbackDesk.tsx and are not inventoried here, but they ARE part of this page).    6b. Right rail: "Latest run" block (conditional on latestRun) → "Scan history and diagnostics" disclosure (containing a nested "Raw funnel, skip, and error codes" disclosure) → "Scanner cadence and budget" disclosure containing the setScannerPolicy form (6 fields + note + Save).  7. Automatic records — "What the scanner kept" (:620-638). Grid of the 6 most recent kept leads, each with provenance, an external source link, and a three-way conditional teaching affordance (form / Steam-review note / schema-pending note). Below it, a "Browse N older leads" disclosure holding leads 7-20, conditional on there being more than 6. Empty state: "No kept source leads yet."  8. Context lanes — "Wire and Asks on the Brief" (:640-656). The 40 most recent current-patch Wire/Asks observations, across every visibility state, are returned. Each item shows EITHER an Undo form (if it carries an active decision) OR a "Reject and teach…" disclosure — never both. Empty state: "No observations recorded for this patch yet."  9. Active lessons — "What the scanner will remember" (:658-668). <FeedbackRulesPanel> or a schema-pending sentence. Last section on the page.  CONDITIONAL-STATE MATRIX A REDESIGN MUST EXERCISE - radar.connected = false → section 3 disappears entirely, section 4 forced to Branch B. - radar.funnel7d.reviewed = 0 → section 4 Branch B. - feedbackLearningAvailable = false → THREE coupled sites change: every lead's teaching form becomes one sentence (:169-170), the inbox paragraph and third fact span change (:523-525, :532), and the Active-lessons panel becomes a sentence (:666). One flag, three sections. - observationModerationAvailable = false → every observation's action becomes one sentence (:250-251). - signal.source/source_type = "steam_review" → that lead's teaching form is replaced by an explanation (:171-175). - observation.decision_id set → Undo replaces the reject disclosure (:252). - latestRun null / signals empty / observations empty / olderSignals empty → four separate empty or absent states.  CROSS-CUTTING FACTS - Every mutating control on this page is a server-action <form> with <SubmitButton> (disabled + aria-busy while pending). There is NO inline error surface for any of them — every server-side throw ("bad input", "…write failed", "observation is already hidden", "preview writes disabled") lands on the framework error page and the operator loses their typed reason. ScanControls is the sole exception: it has a role="alert" inline error line. If the reorg adds nothing else, an error boundary or per-form error surface is the single highest-value addition. - All four server actions share the identical guard pair (requireAdmin → redirect /admin/login; assertProductionWriteAllowed → throw on VERCEL_ENV=preview) and the identical revalidation set (/admin, /scanner, /admin/source-monitor, plus revalidatePublicSurfaces() → PUBLIC_DASHBOARD/PUBLIC_ISSUES/CURRENT_PATCH tags and /, /issues, /report, /scanner). Note /admin/source-monitor is revalidated by every action on this page — confirm that route still exists before pruning. - No sign-out, no nav, and no destructive-delete control lives in AdminScannerView. Nav and sign-out are in OperatorShell (src/components/dispatch/Chrome.tsx), outside this partition. - Data caps that bound the UI: signals 20 (queries.ts:1152), runs 10 but only 8 rendered (:1160 vs AdminScannerView:578/587), rejected candidates 30 (:1172), observations 40 (:1251), observation decisions 200 (:1273). Feedback rules have no explicit application limit but can stop at the hosted service cap before client expiry filtering (:1305-1307). - Dead logic to be aware of rather than faithfully port: optionalCandidates (:351-353) re-filters on fields the query already filters on, so it can never differ from rejectedCandidates; the modelPreset hidden input can never change its stored value; runs 9 and 10 are fetched and never rendered. - Vocabulary is locked (Phase 3b): published / watchlist / watched, tracked leads, reviewed vs vetted. The stat bands and the "Live · Watching · Kept" cell use it; renaming those labels is a product change, not a design change.

**Completeness qualification for the preceding Surface notes:** the rule query
has no explicit application `.limit`, but neither the
admin query nor scanner-enforcement query has count/range pagination, so the
hosted row cap can truncate both. Both current reads order only by non-unique
`created_at`; complete paging requires `created_at DESC, id DESC` (or an
equivalent unique cursor) and a tied-timestamp boundary regression. The
absence of a literal limit is not evidence that every active rule is visible,
recoverable, or enforced.

### Scanner teaching desk + rejected-candidate archive + visibility break-glass browser (3 components: src/components/scanner/ScannerFeedbackDesk.tsx, src/components/scanner/RejectedArchive.tsx, src/components/admin/VisibilityOverrideBrowser.tsx)

_34 controls · partition `inv:scanner-desk-components`_

#### `feedback-desk-search` — Search title, source, or rejection reason

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner section > toolbar above the candidate cards
- **Does:** Filters the undecided candidate list client-side and simultaneously switches the list from truncated-to-2 into show-everything mode.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:181-187 (input), :162-170 (filter memo)
- **Inputs:** type="search", uncontrolled placeholder "Search title, source, or rejection reason", value bound to local useState (line 154). No name attribute — never submitted. Matching is case-insensitive substring over four fields: candidate.title, candidate.source_domain, candidate.snippet, and plainSkipPhrase(candidate.reason) (line 166). No minimum length, no debounce, no max length.
- **Writes:** read-only
- **Guard:** NONE FOUND — pure client state. The surrounding page is already admin-gated by isAdmin() at src/app/scanner/page.tsx:21.
- **Revalidates:** —
- **On failure:** Cannot fail. A query with no matches renders an empty <div className="decision-list"> with no empty-state message — the operator sees the count readout say "0 matches" above a blank area (there is no zero-results copy on this component's search path, unlike RejectedArchive.tsx:85).
- **Tests:** —
- **Quirks:** This input is a two-in-one control and the coupling is easy to miss. When query is empty the list renders only DEFAULT_VISIBLE_CANDIDATES = 2 cards (line 10, applied at :191) plus a "Show N more" disclosure. The moment any character is typed, the slice becomes filtered.length (line 191) AND the "Show more" disclosure is removed entirely by the `!query &&` condition at line 200. So searching is the only way to see all candidates inline. A redesign that keeps the search but drops the truncation, or vice versa, silently changes how much is reachable. Also: the whole toolbar including this input is not rendered at all when undecided.length === 0 (early return at :172-174).

#### `feedback-desk-inspect-source` — Inspect source ↗

- **Kind:** link · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > each decision card, top-right of the heading
- **Does:** Opens the candidate's original URL in a new browser tab so the operator can read the page before deciding.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:56-58
- **Inputs:** href={candidate.url} — the raw stored URL, not the canonicalized one. target="_blank" rel="noreferrer noopener".
- **Writes:** read-only
- **Guard:** NONE FOUND — plain anchor, no interstitial, no confirmation.
- **Revalidates:** —
- **On failure:** Browser-level. A dead or malformed candidate.url produces a browser error page in the new tab; the desk is unaffected and nothing is recorded.
- **Tests:** —
- **Quirks:** This is the only place the operator can see the actual URL, and it is only visible on hover/status bar — the link text is the fixed string "Inspect source ↗". The card body never prints the URL. Combined with feedback-desk-reject-scope-preview showing "this exact page" instead of the canonical URL for exact_url scope, an operator can teach a rule without ever seeing the string being stored. Note it navigates to candidate.url while every rule stores canonicalizeUrl(candidate.url) (src/lib/automation/feedback.ts:73-78) — the inspected URL and the stored rule target can differ.

#### `feedback-desk-keep-relevant` — Keep as relevant

- **Kind:** button · **Destructive:** irreversible
- **Reach:** /scanner (admin) > Teach the scanner > each decision card > actions row, first control
- **Does:** Re-runs the candidate through deterministic or at-most-one-generation extraction to persist or re-observe a source signal, normally records a permanent allow-rule for the canonical exact-URL scope, and marks the candidate rescued. ID-only cost-audit GETs can follow a generation; the missing-RPC compatibility path omits the allow rule.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:79-87 (form) -> recordScannerDecision at src/app/admin/actions.ts:470-609
- **Inputs:** No visible fields. Four hidden inputs, all fixed at render time — see control feedback-desk-keep-relevant-payload for the exact values. Submitted via SubmitButton (src/components/SubmitButton.tsx:6-21), which disables itself and shows "Keeping..." while useFormStatus().pending is true.
- **Writes:** Always on successful rescue: automation_runs (insert via createRunLedger, then update at finalize — src/lib/automation/run.ts:2666 and the finally at :2744); source_signals (insert or reobserve upsert via persistOneSignal/upsertSignal — src/lib/automation/run.ts:1913); issue_clusters (stats + possible promotion via refreshClusterStats — src/lib/automation/run.ts:1922); automation_rejected_candidates.rescued_at (src/app/admin/actions.ts:598-602). Normal RPC path additionally writes scanner_decisions, scanner_feedback_rules action='allow', supersession fields on prior same-scope rules, and candidate decision fields; missing-RPC compatibility omits those. External: zero or one OpenRouter generation call, plus up to three ID-only cost-audit GETs when immediate cost is absent; zero Tavily/search credits.
- **Guard:** requireAdmin() at src/app/admin/actions.ts:471 (redirect to /admin/login), assertProductionWriteAllowed() at :472 (throws on VERCEL_ENV=preview). Input validation at :481-493. Second, independent validation inside the RPC (migration 20260722170106:98-141). RPC is security invoker, granted to service_role only (:301-302).
- **Revalidates:** revalidatePath("/admin"); revalidatePath("/scanner"); revalidatePath("/admin/source-monitor"); revalidatePublicSurfaces() -> tags public-dashboard, public-issues, current-patch + paths /, /issues, /report, /scanner
- **On failure:** Three distinct failure shapes. (1) rescueCandidateSignal throws (LLM down, no cluster resolves — "rescued signal did not resolve to a cluster", run.ts:1906): the action aborts BEFORE any decision row is written; the automation_runs ledger row is still finalized as failed in the finally at run.ts:2744, so a failed run appears in scan history with intent rescue_candidate. (2) The RPC errors: throws "scanner decision write failed: …" — but the signal from step 1 is already persisted, so a retry is safe by design (comment at actions.ts:564-567). (3) The rescue-mark update errors: throws "rescue mark failed: …" leaving the decision recorded but rescued_at null. All three land on src/app/error.tsx.
- **Tests:** tests/adminActions.test.ts:571-660 (recordScannerDecision suite); tests/adminActions.test.ts:509-552 ("reads the rejected candidate, persists it as a signal, and marks it rescued" — via the rescueRejectedCandidate wrapper, same code path)
- **Quirks:** THREE things a redesign will get wrong here. (a) A successful rescue creates a scan-history row and can spend on at most one OpenRouter generation call; ID-only cost-audit GETs can follow. A later failure can leave a failed run without a rescued lead, while a failure before ledger creation leaves no row. Missing configuration/allowance/budget uses deterministic extraction, and the path uses zero search credits. The generation prompt includes private candidate title/snippet/canonicalized source URL and unpublished cluster slugs/titles; current automation routing denies collection but lacks ZDR. Nothing in the live UI hints at that boundary. (b) It is NOT symmetric with Undo. undo_scanner_decision only returns candidates to the desk `where decision_id = p_decision_id and rescued_at is null` (migration 20260722170106:264-269), and a successful path sets rescued_at at actions.ts:600. So undoing a Keep-as-relevant revokes the allow rule but the candidate does NOT come back to the desk and the persisted source_signal is NOT removed. "Undo" is a partial undo only for this decision. (c) Legacy-database leniency is asymmetric: if the record_scanner_decision RPC is missing, a relevant decision silently continues without writing any decision or rule row (legacyRelevantRescue, actions.ts:591-595) — the signal is rescued and no Undo control ever appears for it. A rejection in the same situation throws. Also note the allow rule supersedes any prior block rule on the same canonical exact-URL scope (migration :195-201), which is the intended mechanism for correcting the scanner but is invisible in this UI.

#### `feedback-desk-keep-relevant-payload` — (hidden inputs on the Keep as relevant form)

- **Kind:** form · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > each decision card > actions row (not visible)
- **Does:** Fixes every parameter of the keep decision at render time so the operator submits a one-click, zero-choice allow rule.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:80-83
- **Inputs:** Exactly four hidden inputs, exact values: name="id" value={candidate.id}; name="decision" value="relevant"; name="scope" value="exact_url"; name="reason" value="Operator inspected this page and confirmed it is a relevant Crimson Desert issue lead." (verbatim, 92 chars, hardcoded at line 83). No confirm_broad is sent — unnecessary because scope is exact_url (server check at actions.ts:489).
- **Writes:** scanner_decisions.reason and scanner_feedback_rules.reason both receive that hardcoded sentence verbatim (btrimmed) — migration 20260722170106:170 and :190
- **Guard:** Server re-validates all four: isScannerDecision(decision), isScannerRuleScope(scope), reason length 3-500, and the exact_url/confirm_broad pairing — src/app/admin/actions.ts:481-493. Hidden values are attacker-controllable in principle; the server treats them as untrusted and the RPC validates again (migration :107-130).
- **Revalidates:** —
- **On failure:** If candidate.id no longer exists (expired and swept between render and click), the read at actions.ts:545-552 throws "rejected candidate not found" -> full error page.
- **Tests:** tests/adminActions.test.ts:509-552
- **Quirks:** The hardcoded reason string is a permanent audit-log entry that claims the operator "inspected this page" — the UI cannot verify they clicked Inspect source, and there is no way to edit or supplement it. Every keep decision in scanner_decisions.reason is therefore this identical sentence, making the reason column useless for distinguishing keeps. This is the mirror image of the reject path, which forces a 3-500 char typed reason. If the redesign gives Keep a reason field it must decide what happens to the existing rows carrying this sentence.

#### `feedback-desk-reject-disclosure` — Reject and teach…

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > each decision card > actions row, second control
- **Does:** Reveals the four-field teaching form. Until opened, none of the reject controls exist in the DOM.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:90-91 (<details className="decision-card__reject"> / <summary className="tap-btn">)
- **Inputs:** Native <details>/<summary>. Styled with the tap-btn class so it reads as a button, not a twisty. No open attribute — always starts closed.
- **Writes:** read-only
- **Guard:** Rendered only when feedbackLearningAvailable is true (ternary at line 89). That prop is computed as `!feedbackRulesResult.error` at src/lib/queries.ts:1304 — i.e. it is false when the scanner_feedback_rules table is missing (isMissingSupabaseRelation, queries.ts:1207).
- **Revalidates:** —
- **On failure:** N/A — client-only toggle.
- **Tests:** —
- **Quirks:** Conditional state: when feedbackLearningAvailable is false the entire disclosure is replaced by static text "Scanner learning unlocks after the database schema update." (line 138), while Keep as relevant stays live. A redesign must reproduce both branches or the desk will appear broken on a database that has not run migration 20260722170106. Also: each card's <details> is independent — opening one does not close others, and the open/closed state is native DOM state that survives re-renders but is destroyed if the card unmounts (which happens when the search query filters it out and back in).

#### `feedback-desk-reject-decision-select` — Why is it wrong?

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… > first field
- **Does:** Chooses which block-decision is recorded and stamped onto both the audit row and the feedback rule.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:96-101
- **Inputs:** name="decision", uncontrolled (defaultValue only). Exactly four options, exact submitted values: "off_topic" (label "Off-topic"), "wrong_patch" (label "Wrong patch"), "not_issue_report" (label "Not an issue report"), "duplicate" (label "Duplicate"). defaultValue is computed: candidate.reason === "wrong_patch" ? "wrong_patch" : "off_topic" (line 96). Note "relevant" — the fifth member of SCANNER_DECISIONS (src/lib/automation/feedback.ts:4-10) — is deliberately absent here; it is the Keep button's job.
- **Writes:** scanner_decisions.decision (migration 20260722170106:169); scanner_feedback_rules.decision (migration 20260722170106:187); scanner_feedback_rules.action — derived, not chosen: 'allow' iff decision='relevant', else 'block' (migration 20260722170106:143)
- **Guard:** isScannerDecision(decision) at src/app/admin/actions.ts:483; RPC re-checks the same five-value allowlist at migration 20260722170106:107-109.
- **Revalidates:** —
- **On failure:** An out-of-allowlist value (only reachable by tampering) throws "bad input" at actions.ts:492 before any database read.
- **Tests:** tests/adminActions.test.ts:571-660
- **Quirks:** The default is derived from the machine's own skip code but only handles ONE code: if the scanner rejected the page as source_not_issue_report, the dropdown still pre-selects "Off-topic", not "Not an issue report". So the option most likely to be correct is never the default. An operator who trusts the prefill records the wrong decision class, and the decision class is what FeedbackRulesPanel renders as the rule's headline label (ruleLabel, line 219-225). Second quirk: the stored decision value affects nothing about matching — matchScannerFeedbackRule (feedback.ts:101-123) keys only on action/scope/recency. The four block reasons are audit metadata and a display label, not behavior. A redesign is free to reword the labels but must keep the four stored values intact for existing rows.

#### `feedback-desk-reject-reason` — Operator reason

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… > second field
- **Does:** Captures the human justification stored on both the immutable decision row and the feedback rule.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:105-111
- **Inputs:** <textarea name="reason" minLength={3} maxLength={500} required>. Uncontrolled, prefilled via defaultValue with the template literal `Reviewed source: ${plainSkipPhrase(candidate.reason)}.` (line 110) — e.g. "Reviewed source: off topic.". plainSkipPhrase is src/lib/automation/runDisplay.ts:248-250.
- **Writes:** scanner_decisions.reason (btrimmed — migration 20260722170106:170); scanner_feedback_rules.reason (btrimmed — migration 20260722170106:190)
- **Guard:** Browser: required + minLength=3 + maxLength=500. Server: reason.length < 3 \|\| reason.length > 500 -> "bad input" (src/app/admin/actions.ts:476, :487-488), measured AFTER .trim(). RPC: char_length(btrim(p_reason)) not between 3 and 500 -> exception (migration 20260722170106:110-112).
- **Revalidates:** —
- **On failure:** Empty is blocked by the browser (required). Whitespace-only DOES satisfy required and minLength in the browser but trims to length 0 server-side -> throws "bad input" at actions.ts:492 -> full error page, typed content lost. Over 500 chars is blocked by maxLength client-side; a tampered submit throws "bad input" (the reject path does NOT silently truncate — contrast the override reason, which does).
- **Tests:** tests/adminActions.test.ts:571-660
- **Quirks:** The prefill is the trap. Because it is >3 chars and already valid, the path of least resistance is to submit the machine's own skip code restated as prose — which means scanner_decisions.reason frequently contains no human information. If a redesign removes the prefill, submissions that used to sail through will start hitting the required/minLength wall, changing the perceived friction of the whole desk. Note also that this field is the ONLY thing distinguishing a considered rejection from a reflex click, and it has no character counter despite a hard 500 cap.

#### `feedback-desk-reject-scope-select` — Apply this lesson to

- **Kind:** select · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… > third field
- **Does:** Chooses how wide the resulting block rule is: one page, one section of a site, or an entire domain.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:115-123; scope value computed by scannerRuleScopeValue at src/lib/automation/feedback.ts:69-82
- **Inputs:** name="scope", CONTROLLED (value={scope} + onChange setScope, backed by useState at line 39). Exactly three options, exact submitted values: "exact_url" (label "This exact page", default), "source_path" (label "This source section"), "source_domain" (label "This entire domain"). Stored scope_value is derived, not typed: exact_url -> canonicalizeUrl(candidate.url); source_path -> sourcePathScopeValue (reddit.com stops at r/<sub>, everything else at the first two path segments — feedback.ts:49-67); source_domain -> registrableDomain(candidate.source_domain).
- **Writes:** scanner_feedback_rules.scope_type (migration 20260722170106:188); scanner_feedback_rules.scope_value (migration 20260722170106:189); scanner_feedback_rules.confirmed_at — now() for exact_url, now() for a confirmed broad rule, NULL otherwise (migration 20260722170106:191)
- **Guard:** isScannerRuleScope(scope) at src/app/admin/actions.ts:484; the broad-rule pairing `scope !== "exact_url" && !confirmBroad` -> "bad input" at :489; RPC repeats both (migration 20260722170106:113-121). Pinned by tests/scannerFeedbackMigration.test.ts:22 which asserts the SQL literally contains `p_scope_type <> 'exact_url' and not p_confirm_broad`.
- **Revalidates:** —
- **On failure:** If the candidate URL cannot be parsed into the chosen scope, scannerRuleScopeValue returns null and the server throws "bad input" at actions.ts:562 — after the candidate read, before any write.
- **Tests:** tests/adminActions.test.ts:625-646 (broad scope with confirm_broad); tests/scannerFeedbackMigration.test.ts:22
- **Quirks:** This is the highest-blast-radius control in the component and it is the third field in a collapsed disclosure. Changing it away from exact_url conditionally MOUNTS a required checkbox below it (line 126) — the form silently grows a new blocking requirement mid-fill. State is per-card (useState is inside DecisionCard at line 39), so it resets to exact_url on every remount and never carries between cards. Selecting source_domain writes a rule that suppresses that entire domain from all FUTURE scanner intake (matchScannerFeedbackRule, feedback.ts:101-123) — but per the comment at src/lib/automation/run.ts:1736-1739, broad rules deliberately do NOT retroactively re-evaluate already-stored signals; only exact_url rules do. That asymmetry is invisible in this UI, where all three options look equivalent.

#### `feedback-desk-reject-scope-preview` — Rule target: <code>{scopeLabel}</code>

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… > line between the scope select and the confirm checkbox
- **Does:** Previews the exact string that will be stored as scanner_feedback_rules.scope_value before the operator confirms.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:40-45 (computation), :125 (render)
- **Inputs:** Derived, no input. scope === "exact_url" ? "this exact page" : (storedScopeValue ?? "scope unavailable"), where storedScopeValue = scannerRuleScopeValue(scope, {url, sourceDomain}).
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** When scannerRuleScopeValue returns null (unparseable URL, no registrable domain, empty path for source_path) it renders the literal text "scope unavailable".
- **Tests:** —
- **Quirks:** Two defects a redesign should not faithfully reproduce. (1) DEAD END: when it reads "scope unavailable" the Record decision button is still enabled, the checkbox still accepts a tick, and submitting throws "bad input" server-side (actions.ts:562) into a full error page. The UI warns but does not prevent. (2) ASYMMETRIC HONESTY: for exact_url it prints the prose "this exact page" instead of the canonical URL, so the one scope the operator picks 90% of the time is the one whose stored value they never see — even though canonicalizeUrl can differ from the URL behind Inspect source. The broad scopes, which are the dangerous ones, are the only ones shown literally.

#### `feedback-desk-reject-confirm-broad` — I understand this broader rule can affect future scanner results.

- **Kind:** checkbox · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… > appears only after switching scope away from "This exact page"
- **Does:** The mandatory acknowledgement that gates any rule wider than a single URL.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:126-131
- **Inputs:** <input type="checkbox" name="confirm_broad" value="true" required>. Conditionally rendered: `scope !== "exact_url" ? … : null`. Submitted only when checked; the server compares formData.get("confirm_broad") === "true" (actions.ts:478).
- **Writes:** scanner_feedback_rules.confirmed_at — set to now() when true, left NULL when a broad rule somehow arrives unconfirmed (migration 20260722170106:191)
- **Guard:** Browser required. Server: `(scope !== "exact_url" && !confirmBroad)` -> "bad input" (src/app/admin/actions.ts:489). RPC: `if p_scope_type <> 'exact_url' and not p_confirm_broad then raise exception 'broader feedback rules require explicit confirmation'` (migration 20260722170106:119-121). Three independent layers.
- **Revalidates:** —
- **On failure:** Unchecked: the browser blocks submission with a native validation bubble. Tampered submit: "bad input" at actions.ts:492 with no database access. Tampered RPC call: SQL exception 22023.
- **Tests:** tests/adminActions.test.ts:625-646; tests/adminActions.test.ts:793-808 (signal path rejects confirm_broad); tests/scannerFeedbackMigration.test.ts:22
- **Quirks:** CONDITIONAL EXISTENCE — this control is absent from the DOM entirely for the default scope, so any redesign that renders the form statically (all fields always visible) will either show a permanently-required checkbox that blocks exact_url submissions, or drop the requirement. Both break parity. The three-layer enforcement (browser/action/SQL) means the SQL will reject a broad rule even if the UI layer is rewritten, so a redesign that forgets the checkbox will surface as an opaque 22023 error page rather than a validation message. Also note the guard is defined negatively — it only fires for non-exact_url scopes, so a redesign that adds a fourth, wider scope inherits the requirement automatically.

#### `feedback-desk-reject-hidden-id` — (hidden input name="id" on the reject form)

- **Kind:** form · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… (not visible)
- **Does:** Binds the teaching form to one specific rejected candidate row.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:93
- **Inputs:** name="id" value={candidate.id} — the automation_rejected_candidates primary key.
- **Writes:** scanner_decisions.candidate_id (migration 20260722170106:164); automation_rejected_candidates.decision_id/.feedback_rule_id/.decided_at where id = this value (migration 20260722170106:203-209)
- **Guard:** Existence is checked twice: the action reads the row at src/app/admin/actions.ts:545-552 and throws "rejected candidate not found" if absent; the RPC independently re-checks with `not exists (select 1 from public.automation_rejected_candidates where id = p_candidate_id)` -> errcode P0002 (migration 20260722170106:132-136).
- **Revalidates:** —
- **On failure:** Stale id (candidate expired and was swept between page render and submit) -> "rejected candidate not found" -> full error page. This is a realistic race: candidates carry an expires_at and the desk is force-dynamic but not live-updating.
- **Tests:** tests/adminActions.test.ts:560-568 ("throws when the rejected candidate cannot be found")
- **Quirks:** Candidate ids are not stable across scans in the way the operator might assume — the desk is a 30-row, expiry-windowed view (src/lib/queries.ts:1167-1172), so an id that is valid on render can be gone minutes later with no UI signal. There is no optimistic-UI or refetch; the only recovery is the error page's Try again.

#### `feedback-desk-record-decision` — Record decision

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Teach the scanner > card > Reject and teach… > last control in the form
- **Does:** Submits the reject-and-teach form: writes an immutable decision row plus a block rule, supersedes any earlier rule on the same scope, and removes the candidate from the desk.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:132-134 (SubmitButton, className "tap-btn tap-btn--danger", pendingText "Recording...") -> form action recordScannerDecision at src/app/admin/actions.ts:470-609
- **Inputs:** Aggregates: hidden id, decision (4 values), reason (3-500 chars), scope (3 values), and confirm_broad when scope is broad. Does NOT send target_kind (defaults to "candidate", actions.ts:474) or expires_at (defaults to null, :479).
- **Writes:** scanner_decisions — full row insert: id, candidate_id, signal_id(null), target_url, target_url_hash (sha256 of the canonical URL via hashValue), source_domain, decision, reason (migration 20260722170106:153-171); scanner_feedback_rules — full row insert: id, decision_id, action('block'), decision, scope_type, scope_value, reason, confirmed_at, expires_at(null) (migration 20260722170106:173-193); scanner_feedback_rules.revoked_at + .superseded_by_rule_id on every prior active rule sharing scope_type+scope_value (migration 20260722170106:195-201); automation_rejected_candidates.decision_id/.feedback_rule_id/.decided_at (migration 20260722170106:203-209)
- **Guard:** requireAdmin() at actions.ts:471; assertProductionWriteAllowed() at :472; the compound validation at :481-493; then the RPC's own eight checks (migration 20260722170106:98-141). The RPC takes pg_advisory_xact_lock(20260709, 1) then a scope-keyed lock (migration :148-151) so a concurrent visibility refresh cannot clobber the decision.
- **Revalidates:** revalidatePath("/admin"); revalidatePath("/scanner"); revalidatePath("/admin/source-monitor"); revalidatePublicSurfaces() -> public-dashboard, public-issues, current-patch tags + /, /issues, /report, /scanner
- **On failure:** RPC error -> throws "scanner decision write failed: <message>" (actions.ts:594) -> full error page, nothing written (the whole RPC is one transaction). Unlike the relevant path, there is NO legacy-RPC-missing fallback for rejections (the legacyRelevantRescue guard at :591-592 requires decision === "relevant"), so on a database without migration 20260722170106 every rejection hard-fails while every keep silently half-succeeds.
- **Tests:** tests/adminActions.test.ts:571-660; tests/adminActions.test.ts:698-709 ("scanner decision write failed")
- **Quirks:** Styled tap-btn--danger, i.e. it reads as the destructive action — but it is the fully reversible one (FeedbackRulesPanel's Undo restores it, and undo DOES return the candidate to the desk here because rescued_at stays null; migration :264-269). The genuinely partially-irreversible control on the same card, Keep as relevant, is styled as the neutral primary. The visual danger hierarchy is inverted. Second: this one submit performs two conceptually separate acts (audit record + future-blocking rule) with no way to do only one. Third: after success the candidate disappears from the desk entirely because the server query filters decision_id IS NOT NULL (src/lib/queries.ts:1169) — there is no confirmation, no undo affordance in place, and no scroll anchor; the operator's only feedback is the card vanishing and the count changing.

#### `feedback-desk-learning-unavailable-notice` — Scanner learning unlocks after the database schema update.

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > each decision card > where the Reject and teach… disclosure would be
- **Does:** Replaces the entire reject-and-teach path with static text when the feedback schema is missing.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:137-139 (the else branch of the ternary opened at :89)
- **Inputs:** Driven by the feedbackLearningAvailable prop, default true (line 148), threaded from AdminScannerView.tsx:552, computed as `!feedbackRulesResult.error` at src/lib/queries.ts:1304.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** This IS the failure state. It is shown when the scanner_feedback_rules relation is missing (isMissingSupabaseRelation, src/lib/queries.ts:1207) — a degraded mode, not an error page.
- **Tests:** —
- **Quirks:** Conditional state that only appears on a database missing migration 20260722170106 — it will never show up in normal local or production testing, so a redesign is very likely to drop it. When it is active the card keeps Keep as relevant fully live (that path tolerates the missing RPC via legacyRelevantRescue at actions.ts:591-595), so the desk is half-functional rather than disabled. The same prop also swaps the section intro copy at AdminScannerView.tsx:523-526 and the Active lessons panel at :663-667 — three coupled surfaces driven by one boolean.

#### `feedback-desk-show-more` — Show {N} more optional candidates →

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner > below the first two decision cards
- **Does:** Expands the remaining undecided candidates beyond the first two.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:200-214 (<details className="decision-more">); DEFAULT_VISIBLE_CANDIDATES = 2 at line 10
- **Inputs:** Native <details>. Label text is computed: filtered.length - DEFAULT_VISIBLE_CANDIDATES. Rendered only when `!query && filtered.length > DEFAULT_VISIBLE_CANDIDATES` (line 200).
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** Ordering is load-bearing: the two cards outside the disclosure are simply the first two of a created_at-DESC, LIMIT 30 query (src/lib/queries.ts:1171-1172) — newest first, no priority or severity ranking. A redesign that reorders (e.g. by expiry urgency) changes which two candidates get the operator's attention by default. Second: this disclosure is mutually exclusive with search (the `!query` condition at :200) — typing anything destroys it and inlines everything, so the two browsing modes never coexist. Third: cards inside the disclosure are full DecisionCards with their own independent scope state, so a scope selected in a hidden card persists in memory while collapsed.

#### `feedback-desk-truncation-and-filter` — (automatic: undecided filter + 2-card truncation on load)

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner (runs on every page load)
- **Does:** Drops any candidate that already carries a rescue, decision, or rule, then shows only the two newest.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:156-161 (undecided memo), :191 (slice)
- **Inputs:** None. Filter predicate: !candidate.rescued_at && !candidate.decision_id && !candidate.feedback_rule_id.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A — pure derivation.
- **Tests:** tests/adminScannerView.test.ts:66-100 ("freezes teaching-desk relative times at the server-captured instant")
- **Quirks:** This client filter is fully redundant with the server query, which already applies .is("rescued_at", null).is("decision_id", null).is("feedback_rule_id", null) (src/lib/queries.ts:1167-1170) — EXCEPT on a legacy database, where the fallback query at queries.ts:1180-1188 drops the decision_id/feedback_rule_id filters entirely. So the client filter is the only thing keeping decided candidates off the desk in the degraded path. Removing it as "dead code" would regress that case. Related and separately pinned: all relative timestamps come from the server-passed nowIso prop (line 155), never Date.now(), specifically so server and client markup match — tests/adminScannerView.test.ts:66-100 asserts byte-identical markup across a one-hour clock jump. A redesign that switches relativeTime/expiryTime to live clocks fails that test and reintroduces hydration mismatch.

#### `feedback-desk-empty-state` — Nothing needs teaching right now. New auto-rejects remain private and expire on their own.

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Teach the scanner (replaces the whole component)
- **Does:** Short-circuits the entire desk — toolbar, search, and list — to a single sentence.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:172-174
- **Inputs:** Triggered by undecided.length === 0.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** This is an early return placed BEFORE the toolbar JSX, so in the empty state the search input does not exist at all. A redesign that renders a persistent toolbar above a conditional list is a behavior change (the operator would gain a search box that can only ever return nothing). The copy also carries a policy claim — that auto-rejects stay private and self-expire — which is enforced elsewhere (expires_at on automation_rejected_candidates); if the retention policy changes, this string is a stale promise.

#### `feedback-rules-undo` — Undo

- **Kind:** button · **Destructive:** reversible
- **Reach:** /scanner (admin) > Active lessons section ("What the scanner will remember") > right-hand meta column of each rule row
- **Does:** Marks the decision undone and revokes its feedback rule, returning an un-rescued candidate to the teaching desk.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:243-246 (form + hidden decision_id at :244) -> undoScannerDecision at src/app/admin/actions.ts:708-728
- **Inputs:** One hidden input: name="decision_id" value={rule.decision_id}. SubmitButton className "tap-btn tap-btn--sm", pendingText "Undoing...". No confirmation dialog, no reason field.
- **Writes:** scanner_decisions.undone_at = coalesce(undone_at, now()) where id = decision_id and undone_at is null (migration 20260722170106:247-251); scanner_feedback_rules.revoked_at = coalesce(revoked_at, now()) where decision_id = p_decision_id (migration 20260722170106:258-260); automation_rejected_candidates.decision_id=null, .feedback_rule_id=null, .decided_at=null — ONLY where rescued_at is null (migration 20260722170106:264-269); issue_clusters.visibility_revision = visibility_revision + 1 when the undone decision was a signal decision (migration 20260722170106:277-281)
- **Guard:** requireAdmin() at src/app/admin/actions.ts:709; assertProductionWriteAllowed() at :710; non-empty decision_id at :711-712. The RPC takes pg_advisory_xact_lock(20260709, 1) (migration :245) and is granted to service_role only (:303-304).
- **Revalidates:** revalidatePath("/admin"); revalidatePath("/scanner"); revalidatePath("/admin/source-monitor"); revalidatePublicSurfaces()
- **On failure:** RPC error -> "scanner decision undo failed: <message>". If the RPC returns undone !== true (already undone, or the id does not exist) the action throws "scanner decision was already undone or not found" (actions.ts:722). Both land on the full error page. A double-click, or two tabs open on the same rule, produces that error — the second submit is not idempotent from the operator's point of view even though the SQL is.
- **Tests:** tests/adminActions.test.ts:811-829 ("revokes the learning rule without touching cluster visibility"); tests/adminActions.test.ts:830-844 ("recomputes the affected signal cluster after undo")
- **Quirks:** Labelled "Undo" but it is not a full inverse. (a) scanner_decisions rows are never deleted — undone_at is stamped, the audit row is immutable by design (comment at migration :262-263). (b) For a Keep-as-relevant it does NOT return the candidate to the desk and does NOT remove the persisted source_signal, because of the `and rescued_at is null` clause at migration :269. (c) There is no confirmation and no re-do; undoing a broad domain rule that took a scope-confirmation to create takes one unguarded click to destroy. (d) The panel lists rules, but the form submits rule.decision_id, not rule.id — one decision could in principle back multiple rules, and Undo revokes ALL rules sharing that decision_id (migration :260). (e) FeedbackRulesPanel renders the active rules returned by one unpaginated, created_at-desc read and offers no search. The hosted row cap can truncate older active rules, so absence of an app limit is not complete or unbounded recovery.

#### `feedback-rules-label` — KEEP / BLOCK OFF-TOPIC / BLOCK WRONG PATCH / BLOCK NON-ISSUE / BLOCK DUPLICATE

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin) > Active lessons > headline of each rule row
- **Does:** Derives the rule's display headline from its action and decision columns.
- **Backing:** src/components/scanner/ScannerFeedbackDesk.tsx:219-225 (ruleLabel), rendered at :237
- **Inputs:** rule.action ('allow' -> "KEEP", short-circuits first) then rule.decision mapped to three explicit strings, with "BLOCK DUPLICATE" as the unconditional fallback return at line 224.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** The fallback is silent and wrong-by-default: any decision value that is not off_topic/wrong_patch/not_issue_report and not action='allow' renders as "BLOCK DUPLICATE". Today only 'duplicate' reaches it, so it looks correct — but adding a fifth block reason to SCANNER_DECISIONS (src/lib/automation/feedback.ts:4-10) mislabels every new rule as a duplicate with no type error. Also note the CSS class is interpolated from the raw column (`feedback-rule__state--${rule.action}`, line 237), so only .feedback-rule__state--allow and --block exist; a new action value renders unstyled.

#### `rejected-archive-search` — Search title, domain, or rejection reason

- **Kind:** text-input · **Destructive:** none
- **Reach:** UNREACHABLE — RejectedArchive is not mounted on any page (see notes). Intended reach was an operator archive list.
- **Does:** Filters the passed-in candidate list client-side and switches the list out of its 3-item truncation.
- **Backing:** src/components/scanner/RejectedArchive.tsx:53-59 (input), :34-42 (matches memo)
- **Inputs:** type="search", className "w-full", value bound to useState (line 33), placeholder "Search title, domain, or rejection reason". No name — never submitted. Matches case-insensitive substring over THREE fields: candidate.title, candidate.source_domain, plainSkipPhrase(candidate.reason). Note it does NOT search snippet, unlike ScannerFeedbackDesk which searches four fields including snippet (ScannerFeedbackDesk.tsx:166).
- **Writes:** read-only
- **Guard:** NONE FOUND at the component level; the component is not mounted so no route guard applies to it either.
- **Revalidates:** —
- **On failure:** Cannot fail. Zero matches renders "No rejected candidates match that search." (line 85).
- **Tests:** —
- **Quirks:** Same search/truncation coupling as the teaching desk but with different constants and different copy: 3 visible instead of 2 (line 44), "Show {N} more before they expire →" instead of "Show {N} more optional candidates →". Two near-identical search+truncate+disclosure implementations exist in the codebase with divergent field lists and thresholds; a redesign consolidating them must pick which behavior wins. The sr-only label is hand-rolled inline styles (lines 50-52) rather than the .sr-only class used at ScannerFeedbackDesk.tsx:180.

#### `rejected-archive-status` — {N} matching candidates / {N} recent candidates loaded

- **Kind:** automatic · **Destructive:** none
- **Reach:** UNREACHABLE — component not mounted
- **Does:** Announces the current result count to screen readers as the query changes.
- **Backing:** src/components/scanner/RejectedArchive.tsx:61-63
- **Inputs:** Derived. role="status" aria-live="polite". Text switches on `searching` (query.trim().length > 0, line 43): matches.length when searching, candidates.length otherwise.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** This is the only live-region count in the partition — ScannerFeedbackDesk's equivalent (line 188) is a bare <span> with no role and no aria-live, and VisibilityOverrideBrowser's has role="status" but no aria-live (line 50). If the redesign consolidates these three components' result counters, this is the accessible one to standardize on. Note the unsearched label says "loaded", correctly signalling that the list is a windowed subset, not a total.

#### `rejected-archive-open-source` — Open source

- **Kind:** link · **Destructive:** none
- **Reach:** UNREACHABLE — component not mounted
- **Does:** Opens the candidate's URL in a new tab.
- **Backing:** src/components/scanner/RejectedArchive.tsx:17-19
- **Inputs:** href={candidate.url}, target="_blank", rel="noreferrer noopener", className "dispatch-link". Rendered inline inside the meta line after the domain and the plain rejection reason.
- **Writes:** read-only
- **Guard:** NONE FOUND
- **Revalidates:** —
- **On failure:** Browser-level only.
- **Tests:** —
- **Quirks:** Same affordance as the teaching desk's "Inspect source ↗" but different label and different placement (inline in a metadata sentence vs. a top-right link). If both surfaces survive the redesign they should not keep two names for one action.

#### `rejected-archive-rescue` — Rescue

- **Kind:** button · **Destructive:** irreversible
- **Reach:** UNREACHABLE — component not mounted. Intended reach: right side of each archive row.
- **Does:** Re-extracts the candidate deterministically or with at most one OpenRouter generation call, persists or re-observes a source signal, normally records a permanent canonical exact-URL allow rule, and marks it rescued — identical to the teaching desk's Keep as relevant. ID-only cost-audit GETs can follow; the missing-RPC path records no rule.
- **Backing:** src/components/scanner/RejectedArchive.tsx:22-27 (form, hidden id at :23) -> rescueRejectedCandidate at src/app/admin/actions.ts:697-706 -> recordScannerDecision at :470
- **Inputs:** One hidden input: name="id" value={candidate.id}. SubmitButton className "tap-btn tap-btn--sm", pendingText "Rescuing...". The action then synthesizes the rest of the payload server-side with fixed values (actions.ts:700-704): decision="relevant", reason="Operator reviewed this candidate and marked it relevant." (verbatim), scope="exact_url".
- **Writes:** Always on successful rescue: automation_runs, source_signals, issue_clusters, and automation_rejected_candidates.rescued_at. Normal RPC path additionally writes scanner_decisions, scanner_feedback_rules plus supersession fields, and candidate decision fields; missing-RPC compatibility omits those. External: zero or one OpenRouter generation call (MAX_RESCUE_LLM_CALLS = 1), up to three ID-only cost-audit GETs, and zero search credits.
- **Guard:** GUARD ORDERING WART: rescueRejectedCandidate checks `if (!id) throw new Error("bad input")` at src/app/admin/actions.ts:699 BEFORE any authentication. requireAdmin() and assertProductionWriteAllowed() run one level down, at the top of recordScannerDecision (:471-472). No data is read or written before the guard, so this is not an auth bypass — but an unauthenticated caller gets "bad input" instead of the /admin/login redirect, which is an information-ordering inconsistency with every other action in this file.
- **Revalidates:** revalidatePath("/admin"); revalidatePath("/scanner"); revalidatePath("/admin/source-monitor"); revalidatePublicSurfaces()
- **On failure:** Missing id -> "bad input" (actions.ts:699). Candidate gone -> "rejected candidate not found" (actions.ts:552). LLM/cluster-resolution failure -> throws out of rescueCandidateSignal with the run ledger finalized as failed. RPC missing -> silently swallowed by legacyRelevantRescue (actions.ts:591-595): the signal is created but no decision or rule row exists, so no Undo ever appears. All hard failures land on src/app/error.tsx.
- **Tests:** tests/adminActions.test.ts:509-552 ("reads the rejected candidate, persists it as a signal, and marks it rescued"); tests/adminActions.test.ts:554-559 ("throws when the rejected candidate id is missing"); tests/adminActions.test.ts:560-568 ("throws when the rejected candidate cannot be found")
- **Quirks:** The single most dangerous label-vs-behavior mismatch in this partition. "Rescue" on a small secondary button reads like moving a row between lists. A successful action can spend on one OpenRouter generation call plus ID-only cost-audit GETs, normally writes a permanent allow-rule into the scanner's future decision-making, creates an automation_runs entry that shows up in the operator's scan history as a manual run, and sets rescued_at — which permanently excludes the candidate from Undo's restore clause (migration 20260722170106:269). A later failure can instead leave only a failed run; a failure before ledger creation leaves no run. Missing provider allowance uses deterministic extraction; a missing decision RPC omits the rule. The action's own doc comment calls itself a "Compatibility action for older forms" (actions.ts:696), confirming this button is a legacy entry point into the modern decision pipeline. Because the component is unmounted, this button is currently unreachable while the action behind it stays exported and tested — a redesign deleting the component should decide whether to also retire rescueRejectedCandidate or keep it as an API-level compatibility shim.

#### `rejected-archive-show-more` — Show {N} more before they expire →

- **Kind:** disclosure · **Destructive:** none
- **Reach:** UNREACHABLE — component not mounted
- **Does:** Reveals archive rows beyond the first three.
- **Backing:** src/components/scanner/RejectedArchive.tsx:71-82; slice boundaries at :44-45
- **Inputs:** Native <details className="pt-1"> with <summary className="cursor-pointer text-sm dispatch-link" style={{ listStyle: "none" }}>. Rendered only when hidden.length > 0, and `hidden` is forced to [] whenever searching (line 45).
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** The summary sets listStyle: "none" inline, removing the native disclosure triangle and relying entirely on the dispatch-link styling plus the trailing arrow character for affordance. A redesign that normalizes summary styling will change whether this reads as clickable. The copy "before they expire" is a real constraint — candidates carry expires_at and the desk's server query filters on it (src/lib/queries.ts:1167) — but this component receives whatever list it is handed and does no expiry filtering of its own, so the urgency claim is only true if the caller passes an expiry-windowed list.

#### `rejected-archive-empty` — No rejected candidates match that search.

- **Kind:** automatic · **Destructive:** none
- **Reach:** UNREACHABLE — component not mounted
- **Does:** Replaces the row list when the filter returns nothing.
- **Backing:** src/components/scanner/RejectedArchive.tsx:84-86
- **Inputs:** Triggered by visible.length === 0.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** The copy assumes a search is active, but the same branch also fires when the component is handed an entirely empty candidates array with no query typed — in which case it reads "No rejected candidates match that search" with no search having been performed. A genuine zero-data empty state is missing. Contrast ScannerFeedbackDesk, which has a real zero-data message (line 173) but no zero-results-for-query message: between the two components the two empty states exist exactly once each, in opposite places.

#### `override-browser-open` — Create a new override →

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Exception ledger > "Visibility overrides" disclosure > below the list of currently-forced clusters
- **Does:** Opens the break-glass search panel. Nothing inside it exists in the DOM until this is opened.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:27-28 (<details className="ledger-nested" aria-label="Create visibility override"> / <summary className="ledger-nested__summary">)
- **Inputs:** Native <details>, no open attribute, always starts closed.
- **Writes:** read-only
- **Guard:** Page-level: `await requireAdmin()` at src/app/admin/page.tsx:25. No additional gate on the disclosure itself.
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** This is the THIRD nested disclosure level on /admin: the section is a <details> ("Visibility overrides", page.tsx:227-238), this is a <details> inside it, and each search result is a <details> inside that. Four interactions (open, open, type 2 chars, open result) before a single form field is visible. React state (the query) is preserved when the outer details collapse — because <details> only hides content, it does not unmount — so reopening restores the previous search and results. A redesign that swaps <details> for conditional rendering will silently start clearing the query on collapse.

#### `override-browser-count` — {N} automatic records

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > right side of the intro block
- **Does:** States how many clusters are currently engine-owned and therefore eligible to be overridden.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:38 (renders clusters.length)
- **Inputs:** clusters.length, where clusters = autoRows from src/app/admin/page.tsx:47 = returned issue_cluster rows with a falsy admin_visibility_override. The current read is one unpaginated, title-ordered request (src/lib/adminClusters.ts:19-24), so this is not a trustworthy all-cluster total beyond the hosted cap.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** If readAdminClusters hits a missing-column error it falls back to a legacy select (src/lib/adminClusters.ts:37-47) that still returns id/title/admin_visibility_override/is_public, so the count retains its meaning for the rows returned; only admin_visibility_reason and admin_visibility_changed_at degrade to null. Both current and legacy reads can still truncate successfully at the hosted cap.
- **Tests:** —
- **Quirks:** The word "records" here is doing vocabulary work — per the project's locked number-vocabulary this counts engine-owned issue clusters, not published issues. The number deliberately excludes forced clusters (they live in the list above), so it DROPS by one every time an override is applied and rises when one is reset. An operator watching this number will see it move for reasons unrelated to the scanner. The returned cluster list is shipped to the client as props on every /admin render, but today it is service-capped rather than a proven complete or deliberately bounded payload.

#### `override-browser-search` — Issue title

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > the only always-visible field
- **Does:** Searches engine-owned issue clusters by title; results only appear at 2+ characters.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:40-48 (input), :18-24 (matches memo), RESULT_LIMIT = 8 at :13
- **Inputs:** type="search", visible <span>Issue title</span> label, placeholder "Search issue title", value bound to useState (line 16). No name — never submitted. Matching: `cluster.title.toLowerCase().includes(needle)` where needle = query.trim().toLowerCase() (line 17). Gate: `needle.length < 2 ? [] : …` (line 20). Result cap: .slice(0, 8).
- **Writes:** read-only
- **Guard:** NONE FOUND on the input itself. The panel is inside a requireAdmin()-gated page (src/app/admin/page.tsx:25).
- **Revalidates:** —
- **On failure:** Cannot fail — pure client filtering over an already-loaded array. Under 2 characters returns [] (not "no results" — a deliberately different state, see override-browser-status).
- **Tests:** —
- **Quirks:** FOUR behaviors a redesign must preserve exactly. (1) TITLE ONLY — it does not search cluster id, slug, fix_status, or is_public. Two clusters with the same or similar titles are indistinguishable in the results, and the result row shows only title + PUBLIC/PRIVATE, never an id (line 62-64). Overriding the wrong duplicate is possible and invisible. (2) 2-CHARACTER MINIMUM is a deliberate safety gate, not a perf optimization — the status copy at line 52 explains it as "Automatic records stay out of the page until you search," i.e. the design intent is that you cannot browse the full list and click around. A redesign adding a default-visible list breaks that intent. (3) HARD CAP OF 8 with a "+" indicator (line 55) — if your target is the 9th match you must type more, and nothing tells you which 8 you got (they are title-ordered because the source array is, adminClusters.ts:24). (4) No debounce, and line 55 recomputes the full unsliced filter a second time purely to decide whether to print "+".

#### `override-browser-status` — Type at least 2 characters… / No matching engine-owned issues. / {N}[+] matching issues.

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > between the search box and the results
- **Does:** Reports which of three search states the panel is in.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:50-56
- **Inputs:** Nested ternary on needle.length < 2, then matches.length === 0. role="status", NO aria-live. The "+" suffix is appended when the unsliced match count exceeds RESULT_LIMIT (line 55).
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** Three distinct states share one element and only two of them look like search feedback; the first ("Type at least 2 characters. Automatic records stay out of the page until you search.") is really a policy statement about why the list is hidden. The "+" is the ONLY signal that results were truncated at 8 — it is a single character appended to a number and is easy to lose in a redesign, after which operators would silently believe they had seen every match. role="status" without aria-live is inconsistent with RejectedArchive.tsx:61 which sets both.

#### `override-result-disclosure` — {cluster.title} · {PUBLIC|PRIVATE} · ENGINE OWNED · Override…

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > each of up to 8 search results
- **Does:** Expands one search result into its override form. Identifies the cluster and states its current public visibility.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:60-65
- **Inputs:** Native <details className="override-create"> keyed by cluster.id. Summary contains three spans: the title, a mono-label reading `{cluster.is_public ? "PUBLIC" : "PRIVATE"} · ENGINE OWNED`, and an <i>Override…</i>.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** "ENGINE OWNED" is hardcoded, not derived — it is true only because the parent passes autoRows (src/app/admin/page.tsx:47, clusters with no admin_visibility_override). If a redesign ever feeds this component the full cluster list, every row will still claim ENGINE OWNED while some are forced. The PUBLIC/PRIVATE badge is the operator's only view of current state before overriding, and it reflects is_public — the effective visibility — not auto_public, so a cluster the engine wants private but that is public for another reason reads simply PUBLIC. Multiple result disclosures can be open simultaneously, each with a half-filled form; there is no indication which one a submit belongs to beyond proximity.

#### `override-visibility-select` — Temporary visibility

- **Kind:** select · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides > Create a new override → > open a result > first field
- **Does:** Chooses which direction to force the issue's public visibility.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:70-73
- **Inputs:** name="visibility", uncontrolled, defaultValue="force_hidden". EXACTLY TWO options, exact submitted values: "force_hidden" (label "Force hidden", the default) and "force_public" (label "Force public"). The third value the action accepts — "auto" (VISIBILITY_OVERRIDES at src/app/admin/actions.ts:194) — is NOT offered here.
- **Writes:** issue_clusters.admin_visibility_override = the submitted value (migration 20260722170106:456); issue_clusters.is_public = true for force_public, false for force_hidden (migration 20260722170106:463-467); issue_clusters.visibility_restore_is_public and .visibility_restore_auto_public — snapshot of is_public/auto_public taken on first override so "auto" can restore later (migration 20260722170106:446-455); issue_clusters.admin_visibility_changed_at = now() (migration 20260722170106:458); issue_clusters.visibility_revision = visibility_revision + 1 (migration 20260722170106:468); source_signals.public_status='hidden', .promoted_at=null, .promotion_reason='admin_force_hidden' for EVERY signal in the cluster — force_hidden only (migration 20260722170106:475-481)
- **Guard:** Server allowlist `VISIBILITY_OVERRIDES.includes(visibility)` at src/app/admin/actions.ts:204 -> "bad input". RPC allowlist at migration 20260722170106:435-437 -> exception 22023. Both accept 'auto' even though this select cannot produce it.
- **Revalidates:** revalidatePath("/admin"); revalidatePublicSurfaces() -> tags public-dashboard, public-issues, current-patch + paths /, /issues, /report, /scanner
- **On failure:** Tampered value -> "bad input" before any database contact (actions.ts:204). Nonexistent cluster -> the RPC's `if not found then raise exception 'issue cluster not found'` (migration 20260722170106:471-473) -> "…" error page.
- **Tests:** tests/adminActions.test.ts:314-330 ("force_public writes the escape hatch and immediately refreshes effective visibility"); tests/adminActions.test.ts:332-348 ("force_hidden removes a quiet cluster from public reads before the deeper refresh"); tests/adminActions.test.ts:419-427 ("rejects unknown visibility values")
- **Quirks:** FIVE things. (1) THE DEFAULT IS THE DESTRUCTIVE ONE — force_hidden is preselected, so the lowest-effort submit removes an issue from the public board. (2) THE TWO OPTIONS ARE NOT SYMMETRIC IN SIDE EFFECTS: force_hidden additionally rewrites every source_signals row in the cluster to public_status='hidden' with promotion_reason='admin_force_hidden' (migration :475-481); force_public touches no signals. (3) THE TWO OPTIONS ARE NOT SYMMETRIC IN REFRESH EITHER: src/app/admin/actions.ts:227 reads `if (visibility !== "force_hidden") await refreshClusterVisibility(clusterId)` — force_hidden deliberately SKIPS the deep recompute (pinned by tests/adminActions.test.ts:332-348 which asserts refreshClusterVisibility was NOT called). A redesign that "tidies" that condition changes behavior. (4) NO 'auto' HERE: the only way back to engine control is the separate "Reset to automatic" button on the forced-cluster cards at src/app/admin/page.tsx:255-261 — a different component, a different part of the page. The pair is a two-piece control split across two files; deleting or relocating either strands the other. (5) Reset-to-automatic restores is_public and auto_public from the snapshot columns but does NOT itself clear source_signals.promotion_reason='admin_force_hidden' (the RPC's signal update is inside the `if p_visibility = 'force_hidden'` branch only); restoring those signals depends on the refreshClusterStats recompute that runs afterwards (src/lib/automation/run.ts:1719-1774). I did not fully trace whether that recompute re-promotes them, so treat force_hidden's effect on individual signals as not-verified-reversible.

#### `override-reason` — Why are you overriding the engine?

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > open a result > second field
- **Does:** Captures the mandatory written justification, which is displayed on the forced-cluster card until the override is reset.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:75-78
- **Inputs:** <textarea name="reason" minLength={3} maxLength={500} required>. NO defaultValue — starts empty, unlike the teaching desk's prefilled reason (ScannerFeedbackDesk.tsx:110). No placeholder, no character counter.
- **Writes:** issue_clusters.admin_visibility_reason = btrim(reason) (migration 20260722170106:457); set to NULL when visibility='auto' (same line)
- **Guard:** Browser: required + minLength=3 + maxLength=500. Server: `const reason = String(formData.get("reason") ?? "").trim().slice(0, 500)` then `if (visibility !== "auto" && (reason.length < 3 \|\| !confirmed)) throw new Error("override reason and confirmation required")` — src/app/admin/actions.ts:202, :205. RPC: `if p_visibility <> 'auto' and (p_reason is null or char_length(btrim(p_reason)) not between 3 and 500) then raise exception 'visibility override reason required'` (migration 20260722170106:438-440).
- **Revalidates:** —
- **On failure:** BLANK REASON, precisely: (a) Truly empty -> the browser blocks submit with a native "Please fill out this field" bubble; nothing reaches the server. (b) 1-2 characters -> blocked by minLength client-side. (c) Whitespace-only (e.g. "   ") -> required is satisfied (non-empty) and minLength counts the spaces, so the browser lets it through; the server .trim()s it to length 0 and throws "override reason and confirmation required" (actions.ts:205) — a full-page src/app/error.tsx, no field highlight, all typed state and the open disclosures lost, NOTHING written (the throw precedes createServiceClient at :207). (d) With JS/validation bypassed entirely, the RPC independently rejects it. (e) Over 500 chars -> silently .slice(0, 500)'d at actions.ts:202 and stored truncated, NOT rejected — the client maxLength normally prevents reaching this.
- **Tests:** tests/adminActions.test.ts:429-437 ("requires a reason and explicit confirmation before forcing visibility" — asserts the throw AND that mocks.rpc was never called); tests/adminActions.test.ts:314-330 and :332-348 (assert the reason is passed through to the RPC verbatim as p_reason)
- **Quirks:** THE ROLLING-DEPLOY HOLE: if the RPC resolves to the old two-argument signature, src/app/admin/actions.ts:214-224 catches the PostgREST "function not found" error and RETRIES with only p_cluster_id and p_visibility — silently DROPPING the reason. The override still applies; admin_visibility_reason stays null; the forced-cluster card then renders its fallback copy "Existing override created before reason tracking." (src/app/admin/page.tsx:263). So a required field can be discarded without any error, and the UI explains it away as legacy data. This retry is deliberately narrow (isMissingSupabaseRpc only — real failures still throw, pinned by tests/adminActions.test.ts:394-405 "does not hide a real visibility RPC failure behind the legacy fallback"), but the reason-loss consequence is real. Second quirk: 'auto' bypasses the reason requirement entirely (actions.ts:205, migration :438), so clearing an override needs no justification while creating one does.

#### `override-confirm` — I understand this immediately changes the public Issue Board until I reset it.

- **Kind:** checkbox · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > open a result > third field
- **Does:** The mandatory break-glass acknowledgement.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:79-82
- **Inputs:** <input type="checkbox" name="confirm_override" value="true" required>, wrapped in <label className="decision-form__confirm"> — the same class the scanner desk's broad-rule confirm uses (ScannerFeedbackDesk.tsx:127). Server reads `formData.get("confirm_override") === "true"` (src/app/admin/actions.ts:203). Unlike the scanner's confirm_broad, this checkbox is ALWAYS rendered, never conditional.
- **Writes:** Nothing directly — it is a precondition. There is no confirmed_at analogue on issue_clusters; compare scanner_feedback_rules.confirmed_at which does persist the scanner-side acknowledgement (migration 20260722170106:191).
- **Guard:** Browser required. Server: folded into the same condition as the reason at src/app/admin/actions.ts:205 -> "override reason and confirmation required". NOT re-checked by the RPC — migration 20260722170106:435-440 validates only the visibility value and the reason. Unlike confirm_broad (which the SQL enforces at migration :119-121), this acknowledgement exists ONLY in the browser and the server action.
- **Revalidates:** —
- **On failure:** Unchecked -> native browser validation bubble. Tampered/bypassed -> "override reason and confirmation required" thrown before createServiceClient (actions.ts:205-207), so nothing is written. Bypassing the action and calling the RPC directly would succeed with no acknowledgement — the database does not know this checkbox exists.
- **Tests:** tests/adminActions.test.ts:429-437 (asserts mocks.rpc was NOT called when confirmation is absent)
- **Quirks:** Weaker enforcement than its scanner-side twin: confirm_broad is validated in the browser, the action, AND the SQL; confirm_override stops at the action. A redesign that reimplements this form without the checkbox loses the safeguard entirely with no database-level backstop. The copy makes a specific promise — "until I reset it" — that depends on the separate Reset-to-automatic control living in a different component (src/app/admin/page.tsx:255-261); if that button moves or disappears, this sentence becomes false. Note also the label text is the only place the operator is told the change is immediate; there is no post-submit confirmation.

#### `override-hidden-cluster-id` — (hidden input name="cluster_id")

- **Kind:** form · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create a new override → > open a result (not visible)
- **Does:** Binds the override form to one specific issue cluster.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:67
- **Inputs:** name="cluster_id" value={cluster.id} — the issue_clusters primary key.
- **Writes:** issue_clusters row selected by `where id = p_cluster_id` (migration 20260722170106:469); source_signals rows selected by `where cluster_id = p_cluster_id` on force_hidden (migration 20260722170106:480)
- **Guard:** Non-empty check at src/app/admin/actions.ts:204 -> "bad input". Existence enforced by the RPC's `if not found then raise exception 'issue cluster not found' using errcode = 'P0002'` (migration 20260722170106:471-473).
- **Revalidates:** —
- **On failure:** Empty -> "bad input" before any database contact. Nonexistent -> P0002 surfaced as the raw RPC message on the error page.
- **Tests:** tests/adminActions.test.ts:313-437 (every case passes cluster_id="cluster-one")
- **Quirks:** The cluster id is never shown to the operator anywhere in this component — not in the summary (which shows only title + PUBLIC/PRIVATE), not in the form. Combined with title-only search, an operator has no way to disambiguate two similarly-titled clusters before committing a break-glass change to the public board. If the redesign keeps a search-then-override flow, surfacing the id or slug in the result row is the single highest-value addition.

#### `override-apply` — Apply break-glass override

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides > Create a new override → > open a result > last control in the form
- **Does:** Immediately forces the chosen issue public or hidden on the live public board, records the reason and timestamp, and (for force_hidden) hides every source signal in the cluster.
- **Backing:** src/components/admin/VisibilityOverrideBrowser.tsx:83-85 (SubmitButton, className "tap-btn tap-btn--danger", pendingText "Applying...") -> setClusterVisibilityOverride at src/app/admin/actions.ts:197-232
- **Inputs:** Aggregates cluster_id (hidden), visibility (force_hidden\|force_public), reason (3-500 chars after trim), confirm_override ("true").
- **Writes:** issue_clusters.visibility_restore_is_public (snapshot of is_public on first override); issue_clusters.visibility_restore_auto_public (snapshot of auto_public on first override); issue_clusters.admin_visibility_override; issue_clusters.admin_visibility_reason; issue_clusters.admin_visibility_changed_at; issue_clusters.auto_public (preserved on force; restored from snapshot only on 'auto'); issue_clusters.is_public; issue_clusters.visibility_revision (+1); source_signals.public_status/.promoted_at/.promotion_reason for every signal in the cluster — force_hidden only; (all of the above: supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:444-481)
- **Guard:** requireAdmin() at src/app/admin/actions.ts:198; assertProductionWriteAllowed() at :199; visibility allowlist + non-empty cluster_id at :204; reason+confirmation at :205. RPC re-validates visibility and reason (migration 20260722170106:435-440) and takes pg_advisory_xact_lock(20260709, 1) (migration :442) — the global visibility write lock, so a concurrent promotion recompute cannot race it. RPC is security invoker, granted to service_role only (migration :485-486).
- **Revalidates:** revalidatePath("/admin"); revalidatePublicSurfaces() -> revalidateTag public-dashboard / public-issues / current-patch ("max") + revalidatePath /, /issues, /report, /scanner; NOTE: both are inside a `finally` (src/app/admin/actions.ts:228-231), so revalidation happens even when the post-write refresh throws — pinned by tests/adminActions.test.ts:406-418
- **On failure:** Four paths. (1) Validation -> "bad input" or "override reason and confirmation required", nothing written. (2) RPC error that is NOT a missing-signature error -> rethrown verbatim (e.g. "permission denied"), nothing written; pinned by tests/adminActions.test.ts:394-405. (3) RPC missing the 3-arg signature -> silent retry with the 2-arg legacy signature, DROPPING the reason (actions.ts:220-224); if that also errors, its message is thrown. (4) The override succeeds but refreshClusterVisibility throws -> the error propagates to the error page, but the try/finally at :226-231 has already fired both revalidations, so the applied override IS reflected on the public surfaces despite the visible failure — deliberate, pinned by tests/adminActions.test.ts:406-418 ("revalidates the applied override when the immediate refresh fails"). The operator sees a server error for a change that actually took effect.
- **Tests:** tests/adminActions.test.ts:314-330; tests/adminActions.test.ts:332-348; tests/adminActions.test.ts:349-364 ("auto clears the override back to engine control"); tests/adminActions.test.ts:365-393 ("retries the legacy visibility RPC only when the new signature is missing"); tests/adminActions.test.ts:394-405; tests/adminActions.test.ts:406-418; tests/adminActions.test.ts:419-427; tests/adminActions.test.ts:429-437
- **Quirks:** The highest-consequence control in the partition: it changes what the public sees, instantly, with no preview, no diff, and no post-submit confirmation. After a successful submit the result row DISAPPEARS from this browser (the cluster now has admin_visibility_override, so it moves from autoRows to forcedRows at src/app/admin/page.tsx:46-47 and re-renders as an override-card above) — the operator's only feedback is the row vanishing from search and a new card appearing further up the page. That relocation is the confirmation, and it is easy for a redesign to break by rendering both lists from one array. Second: failure case (4) above means "error page" and "change applied" are not mutually exclusive here — any redesign adding optimistic UI or an error toast must not imply the change was rolled back. Third: pendingText is "Applying..." and SubmitButton disables during pending (src/components/SubmitButton.tsx:17), which is the only double-submit protection; there is no idempotency key, though re-applying the same override is harmless because the snapshot columns use coalesce (migration :449, :454) to avoid overwriting the original pre-override state.

**Surface notes.** MOUNTING / RENDER MODE  1. ScannerFeedbackDesk.tsx — "use client" (line 1). Exports TWO components, mounted separately:    - ScannerFeedbackDesk mounted at src/components/scanner/AdminScannerView.tsx:549, inside <section className="operator-workbench__main" aria-label="Teach the scanner"> under the heading "Teach the scanner · Optional" / "Review the pattern, not a dropdown farm."    - FeedbackRulesPanel mounted at src/components/scanner/AdminScannerView.tsx:664, inside <section className="feedback-ledger" aria-label="Active scanner feedback rules"> under "Active lessons" / "What the scanner will remember".    - AdminScannerView.tsx is a SERVER component (no "use client"; first line is an import). It is rendered by src/app/scanner/page.tsx:47 inside <OperatorShell active="scanner">. Route is /scanner, `export const dynamic = "force-dynamic"` (page.tsx:15).    - Route guard is NOT requireAdmin: src/app/scanner/page.tsx:21 uses the non-throwing `isAdmin()`. Anonymous visitors get PublicScannerView instead of a redirect. Everything in this partition is admin-branch-only.    - Data comes from getAutomationAdminData() (src/lib/queries.ts:1162-1210): rejectedCandidates is already filtered to expires_at > now, rescued_at IS NULL, decision_id IS NULL, feedback_rule_id IS NULL, ordered created_at desc, LIMIT 30. feedbackRules is filtered to revoked_at IS NULL and (expires_at IS NULL OR expires_at > now), ordered created_at desc, with no explicit app limit but also no range pagination, so the hosted service cap still applies.  2. RejectedArchive.tsx — "use client" (line 1). **NOT MOUNTED ANYWHERE.** A grep of src/ returns only its own definition (src/components/scanner/RejectedArchive.tsx:32). The only other hits in the repo are stale Turbopack build artifacts under .next/dev/static/chunks/. It renders on zero pages today. Its server action `rescueRejectedCandidate` IS still exported and still covered by tests (tests/adminActions.test.ts:509-569). Parity implication: this file is dead UI over a live action. If the redesign deletes it, nothing user-visible changes; if the redesign "preserves" it, it will be preserving a surface no operator can currently reach.  3. VisibilityOverrideBrowser.tsx — "use client" (line 1). Mounted at src/app/admin/page.tsx:272, inside the "Visibility overrides" <details> of <section className="rule-band" aria-label="Exception ledger"> (page.tsx:170, disclosure summary at :228). src/app/admin/page.tsx is a SERVER component with a hard `await requireAdmin()` at line 25 and `dynamic = "force-dynamic"` (line 19). Route is /admin, shell is <OperatorShell active="review">.    - Its `clusters` prop is `autoRows` = the returned issue_cluster rows with admin_visibility_override falsy (page.tsx:47), read by one unpaginated, title-ordered readAdminClusters request (src/lib/adminClusters.ts:19-24). Forced clusters in that same returned array are excluded by construction and rendered as override-cards ABOVE it (page.tsx:246-270); rows omitted at the service cap reach neither surface.  SHARED GUARD STACK (all three components' write paths) Every server action here begins with `await requireAdmin()` then `assertProductionWriteAllowed()`. - requireAdmin (src/lib/adminGuard.ts:20-22) redirects to /admin/login when the signed ADMIN_COOKIE fails verification, or when SESSION_SECRET is unset/empty (adminGuard.ts:7-11 — no secret means nobody is admin). - assertProductionWriteAllowed (src/lib/previewGuard.ts:7-9) throws "preview writes disabled" whenever VERCEL_ENV === "preview". Every control in this partition is inert on preview deploys. - All three RPCs are `security invoker` with `revoke all ... from public, anon, authenticated` and `grant execute ... to service_role` (supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:291-304, :485-486). The actions use createServiceClient(), so RLS is bypassed by service_role and the app-layer guard is the real boundary.  SHARED FAILURE BEHAVIOR No control in this partition has an inline error slot, a toast, or a useActionState error channel. Every server-side rejection is a thrown Error out of a server action, which lands on src/app/error.tsx — a full-page "Server error / Something broke on our side." with a "Try again" button. The operator loses all client state (search query, scope selection, typed reason) and gets no field-level indication of what was wrong. This is uniform across ScannerFeedbackDesk, RejectedArchive, and VisibilityOverrideBrowser.  SHARED REVALIDATION recordScannerDecision / undoScannerDecision revalidate /admin, /scanner, /admin/source-monitor, then revalidatePublicSurfaces(). setClusterVisibilityOverride revalidates /admin then revalidatePublicSurfaces(). revalidatePublicSurfaces (src/lib/revalidate.ts:10-22) fires tags public-dashboard, public-issues, current-patch (all "max") and paths /, /issues, /report, /scanner — and swallows every error in a bare catch, so a revalidation failure is invisible.  LAYOUT / GROUPING OBSERVATIONS - ScannerFeedbackDesk renders a toolbar row (search + count) then a card list. Each card is a self-contained <article className="decision-card"> with a heading, optional snippet, a 3-step numbered provenance list ("Discovered / Screened / Held private", lines 63-76 — display only, no controls), then the action row. - The action row is deliberately asymmetric: "Keep as relevant" is a bare always-visible button; "Reject and teach…" is a <details> that must be opened before any of its four fields exist in the DOM. - VisibilityOverrideBrowser is a disclosure inside a disclosure inside a disclosure: /admin > "Visibility overrides" <details> > "Create a new override →" <details> > per-result <details>. Three clicks plus a 2-character search before any control appears. - Empty states: ScannerFeedbackDesk returns a bare <p className="decision-empty"> and renders NO toolbar and NO search when there are zero undecided candidates (lines 172-174) — the search box vanishes rather than showing an empty result set. FeedbackRulesPanel likewise short-circuits to a <p> (lines 229-231). RejectedArchive keeps its search box and shows "No rejected candidates match that search." (line 85). VisibilityOverrideBrowser keeps its search and shows a status line (lines 50-56). - Accessibility inconsistency worth preserving deliberately or fixing deliberately: ScannerFeedbackDesk's search label uses the `.sr-only` class (line 180); RejectedArchive's identical label uses hand-rolled inline clip styles (lines 50-52); VisibilityOverrideBrowser's label is fully visible ("Issue title", line 41). Only RejectedArchive's count readout has role="status" aria-live="polite" (line 61). VisibilityOverrideBrowser's status has role="status" but no aria-live (line 50). ScannerFeedbackDesk's count (line 188) is a plain <span> with no live region at all.  CONTROLS THE UI DOES NOT EXPOSE (schema/action capability that exists but has no widget) - recordScannerDecision accepts `target_kind` = "candidate" \| "signal" (actions.ts:474, :485). ScannerFeedbackDesk never submits it, so it always defaults to "candidate". The signal path is driven by AdminScannerView's signalRow, outside this partition. - recordScannerDecision accepts `expires_at` (actions.ts:479-480) and the RPC stores it as scanner_feedback_rules.expires_at. No control in this partition submits it — every rule taught here is permanent until undone. - setClusterVisibilityOverride accepts visibility "auto" (actions.ts:194), but VisibilityOverrideBrowser's select offers only force_hidden and force_public. "auto" is reachable only from the "Reset to automatic" button on forced rows at src/app/admin/page.tsx:255-261 (outside this partition). The two surfaces are a matched pair — deleting either strands the other.

**Completeness qualification for the preceding Surface notes:** `feedbackRules` has no explicit
`.limit`, but that does not make the read complete. The admin and enforcement
queries both need stable range pagination; the admin surface additionally
needs an exact count before it can claim `showing N of M`.

The same service-cap qualification applies to `readAdminClusters`: both its
current-column and rolling-deploy legacy selects are unpaginated and ordered
only by title. Neither may be described as every cluster until both paths page
in stable title/id order.

### /admin/compile, /admin/login, /admin/source-monitor, and the operator chrome (OperatorShell + OPERATOR_NAV in src/components/dispatch/Chrome.tsx)

_27 controls · partition `inv:admin-secondary-pages`_

#### `compile-auth-gate` — requireAdmin() (no visible label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Fires on every GET of /admin/compile before anything renders
- **Does:** Redirects an unauthenticated visitor to /admin/login; otherwise lets the page render.
- **Backing:** src/app/admin/compile/page.tsx:26 -> src/lib/adminGuard.ts:20-22 (requireAdmin) -> src/lib/adminGuard.ts:13-18 (isAdmin) -> verifySessionToken(cookie cd_admin, SESSION_SECRET)
- **Inputs:** Cookie cd_admin (HMAC session token, 12h maxAge set by /api/admin/login); env SESSION_SECRET
- **Writes:** read-only
- **Guard:** This IS the guard. Session cookie verified against SESSION_SECRET. If SESSION_SECRET is unset/blank, isAdmin() returns false for everyone (adminGuard.ts:7-11,14-15).
- **Revalidates:** —
- **On failure:** No try/catch. A missing SESSION_SECRET does not error, it silently denies -> redirect loop feel: /admin/compile -> /admin/login -> sign-in POST 500s -> "Wrong password."
- **Tests:** —
- **Quirks:** The page is force-dynamic (page.tsx:8), so this runs on every request — there is no cached/stale-auth window. requireAdmin() redirects (throws NEXT_REDIRECT); it never returns false, so a redesign cannot use it for conditional rendering the way /scanner uses isAdmin().

#### `compile-runs-history-query` — (automatic) Previous runs query

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every load of /admin/compile; result renders in the "Previous runs" block at the bottom of the page
- **Does:** Reads the 10 most recent dossier runs, newest first, to build the run history list.
- **Backing:** src/app/admin/compile/page.tsx:31-35 — supabase.from("dossier_runs").select("id, created_at, provider").order("created_at", {ascending:false}).limit(10)
- **Inputs:** None (no filters, no pagination). Hard limit 10.
- **Writes:** read-only
- **Guard:** Service-role client (src/lib/supabase createServiceClient) — bypasses RLS entirely; the only gate is compile-auth-gate above it. dossier_runs is deny-all RLS (supabase/migrations/20260705192906_schema.sql:85).
- **Revalidates:** —
- **On failure:** The error field is DISCARDED — only `{ data: runs }` is destructured (page.tsx:31). A failed read yields runs === undefined, `(runs ?? [])` === [], and the page prints "No runs yet." A dead database is indistinguishable from an empty history.
- **Tests:** tests/e2e/public-visual.spec.ts:1015 asserts the "Previous runs" label is visible but does not force the read to fail. Phase 4 requires a forced-failure regression proving the error cannot render as "No runs yet."
- **Quirks:** Ordering matters and is load-bearing: newest-first + limit(10) is the only reason the newest run is reachable at all — there is no pagination, no "show more", no date filter. Run 11 and older become unreachable except by a URL someone saved. Swallowed error means a redesign that adds an error state has no signal to render it from unless the query is changed too.

#### `compile-run-url-param` — ?run=<uuid> (URL parameter, no visible control)

- **Kind:** route · **Destructive:** none
- **Reach:** /admin/compile?run=<id> — reached by clicking a row in Previous runs, by the redirect after Compile now, or by a saved URL
- **Does:** Loads one dossier run's markdown and renders the output block (timestamp + mode line, textarea, copy button). Absent the param, the whole output block does not exist.
- **Backing:** src/app/admin/compile/page.tsx:25 (searchParams), :38-41 (select markdown, provider, created_at .eq("id", run).single()), :71-82 (conditional render)
- **Inputs:** `run` — free-form string from the query string. NOT validated: no uuid check, no allowlist against the 10 listed runs. Passed straight into .eq("id", run).
- **Writes:** read-only
- **Guard:** compile-auth-gate only. Any signed-in operator can fetch ANY dossier_runs row by id, including runs older than the 10 listed.
- **Revalidates:** —
- **On failure:** The error field is discarded again — only `{ data }` is destructured (page.tsx:39). A bad uuid, a deleted run, or a DB failure all produce current === null and the page renders with NO output block and NO message. The operator sees the form and the run list and no explanation.
- **Tests:** No selected-run failure test exists. Phase 4 must distinguish missing/malformed input from another database failure, and neither may look like no run was selected.
- **Quirks:** Biggest conditional-state trap on the page: the textarea, the "Generated ... · MODE" line, the copy button, and the "Focus the box to select all." note ALL exist only when ?run= resolves. A redesign that previews the page without a run param will never see half of it. Also, the type says `{ run?: string }` but Next hands back string[] for a repeated `?run=a&run=b` — that path lands in .eq() untyped and silently yields nothing.

#### `compile-ai-availability-probe` — (automatic) features().ai probe

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load of /admin/compile; drives the checkbox's enabled state, its label text, and its color
- **Does:** Decides whether the AI drafting option is offered at all. When false the checkbox is disabled, the whole label greys to var(--dispatch-faint), and the label text changes.
- **Backing:** src/app/admin/compile/page.tsx:29 (aiAvailable = features().ai), :62 (color), :64 (disabled), :65 (label text) -> src/lib/env.ts:28-40,132-134 — requires BOTH a non-empty OPENROUTER_API_KEY and an approved OPENROUTER_AUTOMATION_MODEL
- **Inputs:** env OPENROUTER_API_KEY, OPENROUTER_AUTOMATION_MODEL
- **Writes:** read-only
- **Guard:** n/a (read of process.env)
- **Revalidates:** —
- **On failure:** hasApprovedAutomationModel swallows the throw and returns false (env.ts:19-26) — an unapproved model id degrades to "disabled, no AI key configured", which misstates the actual cause.
- **Tests:** —
- **Quirks:** Two visual states of the same label that a redesign must both carry: "Draft with AI (free OpenRouter prose model)" vs "Draft with AI: disabled, no AI key configured". The disabled copy blames a missing key even when the key is present but the model is not approved. The greyed color is inline (`style`), not a class — a CSS-only restyle will not pick it up.

#### `compile-use-ai-checkbox` — Draft with AI (free OpenRouter prose model) / Draft with AI: disabled, no AI key configured

- **Kind:** checkbox · **Destructive:** none
- **Reach:** /admin/compile > the rule-topped band directly under the page header, left of the Compile now button
- **Does:** When checked, asks the compile action to send the complete deterministic dossier to OpenRouter for a prose rewrite; that user message contains private approved-report issue titles, reproduction steps, and evidence URLs; unpublished issue-cluster titles, fix status, and confidence; and public source URLs. Unchecked (or disabled) compiles deterministically without a provider request.
- **Backing:** src/app/admin/compile/page.tsx:60-66 (input name="use_ai", no value attr) -> read at src/app/admin/actions.ts:284 `formData.get("use_ai") === "on"`, gated again at :375 `if (useAi && features().ai)`
- **Inputs:** Unchecked sends nothing; checked sends the browser default "on". Disabled inputs are not submitted at all, so disabled == unchecked on the wire.
- **Writes:** External: the complete generated Markdown goes to OpenRouter with `data_collection: "deny"` and `zdr: true` routing requirements. Indirectly stores dossier_runs.provider and dossier_runs.markdown — see compile-now-button.
- **Guard:** Double-gated: `disabled={!aiAvailable}` client-side (page.tsx:64) AND `features().ai` re-checked server-side (actions.ts:375). Tampering with the DOM to re-enable it cannot force an AI call.
- **Revalidates:** —
- **On failure:** If AI drafting returns a caught failure, non-OK response, non-free cost, or short content, draftDossierWithAi returns null and the action keeps deterministic markdown. The fetch has no timeout, and a long nonconforming response is accepted, so neither case reaches the claimed fallback today.
- **Tests:** tests/ai.test.ts pins the free provider routing but not a representative compileDossier user message containing every private approved-report and unpublished-cluster field, unchecked/disabled no-call paths, or the UI disclosure.
- **Quirks:** The current adjacent copy under-discloses the external payload and presents the prompt's prose-only instruction as enforcement. Phase 4 must name the private approved-report issue titles/repro notes/evidence URLs and unpublished cluster titles/status/confidence, then validate deterministic structure before accepting the response. Named `use_ai` and compared against the literal "on" — if a redesign gives the input an explicit `value`, the server comparison breaks silently and AI drafting stops working with no error. The checkbox is coupled to the compile-ai-availability-probe for its disabled state and to the op-note beside the button for its meaning; splitting them loses both the transfer disclosure and the preservation contract. The label wraps the input (`.report-check`, globals.css:2121) rather than using htmlFor.

#### `compile-now-button` — Compile now

- **Kind:** button · **Destructive:** reversible
- **Reach:** /admin/compile > compile band, immediately right of the AI checkbox
- **Does:** Submits the compile form, building and saving a new dossier run, then lands the operator on that run.
- **Backing:** src/app/admin/compile/page.tsx:59 (form action={compileDossier}), :67 (button, no type attr -> default submit) -> src/app/admin/actions.ts:281-396
- **Inputs:** Only the use_ai checkbox. No other fields; no patch selector, no date range, no confirmation step.
- **Writes:** dossier_runs.markdown; dossier_runs.provider; dossier_runs.stats (JSON: totalSignals, totalDirectReports, totalVerifiedReports, pendingCount); dossier_runs.id / created_at via column defaults (supabase/migrations/20260705192906_schema.sql:72-78); Reads only: bug_reports, issue_clusters, source_signals, approved_excerpts, official_patch_notes
- **Guard:** await requireAdmin() at actions.ts:282, then assertProductionWriteAllowed() at :283 (src/lib/previewGuard.ts:7-9 — throws "preview writes disabled" when VERCEL_ENV === "preview")
- **Revalidates:** None. No revalidatePath/revalidateTag call anywhere in compileDossier. Freshness comes only from `export const dynamic = "force-dynamic"` (page.tsx:8).; redirect(`/admin/compile?run=${run.id}`) at actions.ts:395
- **On failure:** Every read failure throws with a labelled message via throwReadError (actions.ts:83-85), and the dossier_runs insert throws on error (actions.ts:394). There is no in-page error slot — the throw bubbles to the ROOT error boundary src/app/error.tsx, which is a public-chrome page (crimson topline, "Something broke on our side.", a "Try again" button). The operator loses the amber operator chrome and the whole compile page. On Vercel preview it fails this way 100% of the time.
- **Tests:** tests/e2e/public-visual.spec.ts:1013 asserts the button is visible (it is never clicked — the write path has no test); tests/e2e/public-visual.spec.ts:1017 screenshot admin-compile.png
- **Quirks:** No loading/pending state at all — no useFormStatus, no disabled-while-submitting. compileDossier does up to five Supabase round-trips plus an optional OpenRouter call, so the operator can double-click and write two dossier_runs rows. Also: this is the only writer on the page, and it always inserts (never updates), so history grows unbounded while only the newest 10 are listed. The button has no `type`, relying on the HTML default — a redesign that moves it out of the <form> silently turns it into a no-op.

#### `compile-dossier-server-action` — compileDossier (server action, no visible label)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** Invoked only by the Compile now form on /admin/compile; not exported to any route
- **Does:** Aggregates approved reports, clusters, public source signals, approved excerpts and the pending count into a deterministic markdown dossier, optionally rewrites it with AI, saves it, and redirects to it.
- **Backing:** src/app/admin/actions.ts:281-396; deterministic builder src/lib/dossier.ts via buildDeterministicDossier (actions.ts:345-371); AI path src/lib/ai.ts:35-65
- **Inputs:** FormData with a single optional key `use_ai`. Server-side caps that a redesign must not assume away: approved_excerpts limit 1000 (actions.ts:313), repro notes first 15 (actions.ts:365), evidence URLs first 30 deduped (actions.ts:367-369), source_signals restricted to public_status = "public" (actions.ts:304).
- **Writes:** dossier_runs.markdown; dossier_runs.provider; dossier_runs.stats
- **Guard:** requireAdmin() (actions.ts:282) + assertProductionWriteAllowed() (actions.ts:283)
- **Revalidates:** none — redirect only
- **On failure:** Throws to the root error boundary (see compile-now-button). Note the AI branch cannot fail the run: ai.ts returns null on any error and the deterministic text is saved instead.
- **Tests:** —
- **Quirks:** provider is a free-form string written from ai.ts's attempt name; the page's modeLabel (page.tsx:21-23) treats ONLY the exact string "deterministic" as deterministic and uppercases everything else as "AI DRAFT · X". A future provider string change silently relabels history rows. Also note this action reads the current patch with the SERVICE client (actions.ts:286), bypassing the 300s cache the shell uses — the dossier can name a newer patch than the footer.

#### `compile-run-mode-line` — Generated <date> · DETERMINISTIC | AI DRAFT · <PROVIDER>

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin/compile?run=… > first line of the output block
- **Does:** States when the shown run was generated (America/New_York, en-US) and whether the prose is deterministic or AI-drafted.
- **Backing:** src/app/admin/compile/page.tsx:73-75; runDateLabel :10-19; modeLabel :21-23
- **Inputs:** current.created_at, current.provider
- **Writes:** read-only
- **Guard:** inherits compile-auth-gate
- **Revalidates:** —
- **On failure:** An unparseable created_at renders "Invalid Date" — no guard.
- **Tests:** —
- **Quirks:** Timezone is HARD-CODED to America/New_York here, while the operator footer dateline uses UTC (Chrome.tsx:13-23). Two clocks on one screen. Same formatter is reused for every row of the run list, so changing one changes both.

#### `dossier-output-textarea` — (unlabeled read-only textarea containing the dossier markdown)

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin/compile?run=… > output block, under the mode line
- **Does:** Displays the generated dossier text and selects ALL of it automatically the moment it receives focus, so the operator can copy with one keystroke.
- **Backing:** src/components/DossierOutput.tsx:5-15 (readOnly, rows=24, defaultValue={markdown}, onFocus -> currentTarget.select()); mounted at src/app/admin/compile/page.tsx:76
- **Inputs:** None — readOnly. It is a focus target, not an entry field.
- **Writes:** read-only
- **Guard:** inherits compile-auth-gate
- **Revalidates:** —
- **On failure:** No failure path. Uses defaultValue (uncontrolled), so it never re-syncs after mount.
- **Tests:** —
- **Quirks:** Two hidden couplings a redesign will break: (1) the select-on-focus behavior is the entire meaning of the sibling note "Focus the box to select all." — drop one and the other lies; (2) it is the documented fallback for the copy button's failure message ("Copy failed — select the text instead"). It has NO label and no aria-label — a screen reader announces an unlabeled text box. rows={24} is fixed, so long dossiers scroll inside it.

#### `copy-dossier-button` — Copy to clipboard / Copied ✓ / Copy failed — select the text instead

- **Kind:** button · **Destructive:** none
- **Reach:** /admin/compile?run=… > output block, on the row below the textarea
- **Does:** Copies the run's markdown to the system clipboard. Never regenerates anything.
- **Backing:** src/components/DossierOutput.tsx:18-36 (navigator.clipboard.writeText, setTimeout 2500 back to idle); mounted at src/app/admin/compile/page.tsx:78
- **Inputs:** None; the markdown is baked into the client component's props at render.
- **Writes:** System clipboard only
- **Guard:** inherits compile-auth-gate
- **Revalidates:** —
- **On failure:** Handled: the try/catch sets state "failed" and the BUTTON LABEL becomes the error message — "Copy failed — select the text instead". There is no separate error element. This fires on any insecure context or denied clipboard permission.
- **Tests:** —
- **Quirks:** The button label is also the status display and the error display — three jobs, one node, and the widest label is ~40 characters, so the button visibly resizes on failure. State auto-resets after 2500ms via a setTimeout that is never cleared on unmount. Not announced to assistive tech (no aria-live).

#### `compile-select-all-note` — Focus the box to select all.

- **Kind:** disclosure · **Destructive:** none
- **Reach:** /admin/compile?run=… > output block, right of the copy button
- **Does:** Tells the operator the manual copy path exists (it is the instruction for the textarea's onFocus select).
- **Backing:** src/app/admin/compile/page.tsx:79
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** inherits compile-auth-gate
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** —
- **Quirks:** Pure text, but load-bearing: it is the only documentation of the select-on-focus behavior and the only recovery instruction when the clipboard API is blocked. Delete the textarea's onFocus and this sentence becomes false.

#### `compile-run-history-link` — <Month D, YYYY, h:mm AM/PM> (one link per run, up to 10)

- **Kind:** link · **Destructive:** none
- **Reach:** /admin/compile > "Previous runs" block at the bottom; each row is the date link plus a right-aligned mode tag
- **Does:** Reloads /admin/compile?run=<id>, replacing the output block with that historical run.
- **Backing:** src/app/admin/compile/page.tsx:88-95 — plain <a href={`/admin/compile?run=${item.id}`}>, mode tag at :93
- **Inputs:** The run id is interpolated into the href unencoded.
- **Writes:** read-only
- **Guard:** inherits compile-auth-gate
- **Revalidates:** —
- **On failure:** A stale/deleted id lands on the page with no output block and no message (see compile-run-url-param).
- **Tests:** tests/e2e/public-visual.spec.ts:1015 pins the surrounding "Previous runs" label only
- **Quirks:** Uses a raw <a>, not next/link — every history click is a FULL page reload, unlike the operator nav. There is no active/current marker: the run you are currently viewing looks identical to the other nine. The row is a two-column baseline flex (globals.css:2720), so a long mode tag and a long date collide rather than wrap.

#### `login-password-input` — Password

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin/login > centered sign-in card, under the "Operator console" kicker and "Sign in" heading
- **Does:** Collects the shared admin password. Autofocuses on page load.
- **Backing:** src/app/admin/login/LoginForm.tsx:37-46 (id="password", type="password", controlled by useState, autoFocus at :44); label htmlFor="password" at :38
- **Inputs:** Free text, no maxLength, no pattern, no trim. NO `name` attribute (value travels in React state, not form encoding) and NO `autoComplete` attribute.
- **Writes:** read-only — the value is sent to /api/admin/login (owned by another agent) and never stored client-side beyond component state
- **Guard:** n/a — this is the pre-auth surface
- **Revalidates:** —
- **On failure:** n/a on its own.
- **Tests:** tests/e2e/public-visual.spec.ts:66-69 signs in by POSTing the API directly — this input is never typed into by any test
- **Quirks:** Missing autoComplete="current-password" here, while the OTHER sign-in form (footer popover, src/components/AdminControls.tsx:111) DOES set it — password managers behave differently on the two forms. autoFocus steals focus from the skip link on load. The value is never cleared on failure (AdminControls.tsx:65 clears its copy on success; this one does not).

#### `login-submit-button` — Sign in / Checking...

- **Kind:** button · **Destructive:** none
- **Reach:** /admin/login > full-width button at the bottom of the sign-in card
- **Does:** POSTs {password} as JSON to /api/admin/login and, on success, client-navigates to /admin.
- **Backing:** src/app/admin/login/LoginForm.tsx:52-54 (button, no type -> submit, disabled={busy \|\| password.length === 0}); handler :12-24 — fetch POST /api/admin/login, then res.ok ? router.push("/admin") : setError(true)
- **Inputs:** Client-side validation is exactly ONE rule: the button is disabled while the password field is empty or a request is in flight. No length, format, or trim validation. No CAPTCHA/turnstile on this form.
- **Writes:** Sets the httpOnly cookie cd_admin server-side (12h) — performed by the API route, not by this component
- **Guard:** None client-side by design. The real check is server-side password comparison; the route also sleeps 750ms before returning 401.
- **Revalidates:** No revalidatePath — navigation is router.push("/admin") at LoginForm.tsx:22
- **On failure:** Any non-OK response renders exactly one message: "Wrong password." in --crimson (LoginForm.tsx:47-51). That includes a genuine 401, a 400 invalid-JSON, and a 500 from a missing ADMIN_PASSWORD or SESSION_SECRET. WORSE: the fetch has NO try/catch — an offline/network throw rejects inside onSubmit, so setBusy(false) never runs and the button stays disabled reading "Checking..." forever with no error shown. Only a page reload recovers.
- **Tests:** —
- **Quirks:** Label-vs-reality mismatch: "Wrong password." is also what a misconfigured deployment shows, so an env outage looks like operator error. The error paragraph is not aria-live and is not associated with the input, so it is silent for screen readers. There is no rate-limit or lockout feedback surfaced. The 750ms server delay on a bad password means the "Checking..." state is always visible for at least that long — a redesign that removes the busy label will look frozen.

#### `login-admin-controls-suppression` — (the footer "Admin" button, deliberately absent here)

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin/login > footer — where every public page shows an "Admin" button, this page shows nothing
- **Does:** Suppresses the footer sign-in popover on every path starting with /admin, so the login page does not present two competing sign-in forms.
- **Backing:** src/components/AdminControls.tsx:29 — `if (pathname?.startsWith("/admin")) return null;` (comment at :27-28 states the reason); mounted from the public footer at src/components/dispatch/Chrome.tsx:80
- **Inputs:** usePathname()
- **Writes:** read-only
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/e2e/public-visual.spec.ts:1020-1032 exercises the footer popover on public pages only
- **Quirks:** This is path-string coupling, not component coupling: move the login page to any route that does not start with /admin (e.g. /operator/login, /sign-in) and the footer popover reappears — two password fields on one screen, which is the exact bug the guard was added to fix. Conversely, the footer Admin button is the ONLY discoverable entry point to the console from the public site, and it disappears the moment you land here.

#### `login-public-chrome-nav` — THE BRIEF / ISSUE BOARD / OBSERVATORY / METHOD / FILE A REPORT →

- **Kind:** nav · **Destructive:** none
- **Reach:** /admin/login > top nameplate nav (the login page renders PublicShell, not OperatorShell)
- **Does:** Five public destinations remain fully reachable from the signed-out console page: / , /issues, /scanner, /about, /report.
- **Backing:** src/app/admin/login/page.tsx:8 (PublicShell) -> src/components/dispatch/Chrome.tsx:31-43 (PUBLIC_NAV), rendered :45-61; nameplate branch :134-147
- **Inputs:** Mobile shows the `short` labels (BRIEF / ISSUES / OBSERVATORY / METHOD / REPORT) via .dispatch-nav__full/.dispatch-nav__short.
- **Writes:** read-only
- **Guard:** none — public
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** —
- **Quirks:** OWNED BY THE PUBLIC-CHROME PARTITION — listed here only so the login page's inventory is complete. The login page is deliberately public-chromed (crimson topline, comment at src/app/admin/login/page.tsx:4-5): amber operator chrome must NOT appear until after authentication. No nav item is marked active on this page (`active` is never passed), so the login page is the one page with zero aria-current.

#### `login-public-chrome-footer` — Method · Privacy · Source

- **Kind:** nav · **Destructive:** none
- **Reach:** /admin/login > footer, above the fold-less bottom rule
- **Does:** Links to /about, /about#privacy, and the external SOURCE_URL (new tab, rel=noreferrer noopener).
- **Backing:** src/components/dispatch/Chrome.tsx:63-84 (PublicFooter), links :72-79
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** none — public
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** —
- **Quirks:** OWNED BY THE PUBLIC-CHROME PARTITION; noted for login-page parity. The AdminControls slot at Chrome.tsx:80 renders null here (see login-admin-controls-suppression), so this footer has three links where public pages have four items.

#### `source-monitor-redirect` — /admin/source-monitor (no UI — the page has no visible content)

- **Kind:** route · **Destructive:** none
- **Reach:** Only by typing the URL or following an old bookmark/link. It is NOT in OPERATOR_NAV and nothing in src/ links to it.
- **Does:** It is a STUB, not a live page: the component body is a single unconditional redirect("/scanner") that runs during render. An operator who visits it never sees a frame of this route — the browser lands on /scanner. Signed in, /scanner renders the OperatorShell admin scanner view; signed OUT it renders the PUBLIC observatory view (it does not bounce to login), so an unauthenticated visitor to /admin/source-monitor silently ends up on a public page.
- **Backing:** src/app/admin/source-monitor/page.tsx:1-7 (entire file); target behavior at src/app/scanner/page.tsx:20-22 (isAdmin() branch, non-throwing)
- **Inputs:** None. Query strings and hashes are NOT forwarded — redirect("/scanner") is a bare literal.
- **Writes:** read-only
- **Guard:** NONE FOUND. There is no requireAdmin()/isAdmin() call in this file — an anonymous visitor is redirected, not challenged. The auth decision happens after the hop, inside /scanner.
- **Revalidates:** —
- **On failure:** Cannot fail; redirect() throws NEXT_REDIRECT by design. Default Next behavior is a 307 from a server component render.
- **Tests:** No test covers the redirect. docs/superpowers/plans/design_handoff_editorial_dispatch/AUDIT.md:212 and :252 flag it as a regression check that was never written; ACCEPTANCE.md:61 records the redirect as a preserved contract.
- **Quirks:** DELETE-BAIT: the file looks like dead code (7 lines, no UI, unlinked), but seven live revalidatePath("/admin/source-monitor") calls still target it — src/app/admin/actions.ts:442, 453, 466, 540, 607, 692, 726 — and three of them are PINNED BY TESTS (tests/adminActions.test.ts:469, 503, 549). Removing the route leaves seven revalidations pointing at nothing; removing the revalidations breaks three tests. Note the calls are already near-useless: revalidating a redirect stub refreshes no data, and the real surface /scanner is force-dynamic. The redirect also loses the query string, so any bookmarked filter is dropped silently.

#### `operator-nav-report-review` — REPORT REVIEW

- **Kind:** nav · **Destructive:** none
- **Reach:** Every OperatorShell page (/admin, /admin/compile, /scanner-as-admin) > amber console nav, first item
- **Does:** Client-side navigation to /admin, the report review workspace.
- **Backing:** src/components/dispatch/Chrome.tsx:155 (OPERATOR_NAV entry, key "review"), rendered as next/link at :191-198
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** The link itself is unguarded markup; /admin enforces its own requireAdmin().
- **Revalidates:** —
- **On failure:** n/a — a next/link prefetch/navigation; if the session expired mid-visit the destination redirects to /admin/login.
- **Tests:** —
- **Quirks:** aria-current="page" is driven by the `active` prop each page passes (Chrome.tsx:195). /admin/compile passes active="compile" and /scanner passes active="scanner", so "review" is only ever highlighted from /admin itself. The OperatorNavKey union (Chrome.tsx:10) has exactly three members — a redesign adding a fourth operator page must widen that type or it silently cannot be highlighted.

#### `operator-nav-scanner-monitor` — SCANNER MONITOR

- **Kind:** nav · **Destructive:** none
- **Reach:** Every OperatorShell page > amber console nav, second item
- **Does:** Navigates to /scanner — the same URL the PUBLIC nav calls "OBSERVATORY".
- **Backing:** src/components/dispatch/Chrome.tsx:156 (key "scanner") -> src/app/scanner/page.tsx:20-60 (role-aware: admin sees AdminScannerView in OperatorShell, anonymous sees PublicScannerView in PublicShell)
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** Destination uses isAdmin() (non-throwing) rather than requireAdmin(), so it degrades to the public view instead of redirecting.
- **Revalidates:** —
- **On failure:** If the operator's 12h session lapses, this link quietly returns the PUBLIC observatory instead of the admin dashboard — no error, no sign-in prompt, just fewer controls.
- **Tests:** —
- **Quirks:** ONE ROUTE, TWO LABELS: /scanner is "OBSERVATORY" in PUBLIC_NAV (Chrome.tsx:40) and "SCANNER MONITOR" here. A redesign that unifies naming must change both or the operator and public vocabularies drift. This is also the destination that /admin/source-monitor redirects to — three names for one page.

#### `operator-nav-compile-dossier` — COMPILE DOSSIER

- **Kind:** nav · **Destructive:** none
- **Reach:** Every OperatorShell page > amber console nav, third item
- **Does:** Navigates to /admin/compile.
- **Backing:** src/components/dispatch/Chrome.tsx:157 (key "compile"), rendered :191-198
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** Destination enforces requireAdmin() (src/app/admin/compile/page.tsx:26).
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/e2e/public-visual.spec.ts:1011 navigates to /admin/compile directly rather than via this link
- **Quirks:** Always links to the bare /admin/compile, never to the most recent run — so arriving via the nav always shows the page in its no-output state even when runs exist.

#### `operator-nav-export-csv` — EXPORT CSV

- **Kind:** link · **Destructive:** none
- **Reach:** Every OperatorShell page > amber console nav, fourth item — visually identical to the three page links beside it
- **Does:** NOT A PAGE. Attempts to download bug-report rows as CSV: the response carries content-disposition: attachment; filename="cd-reports-YYYY-MM-DD.csv". The current one-page read can omit older rows at the hosted service cap.
- **Backing:** src/components/dispatch/Chrome.tsx:158 (key "export") and the special-case branch at :186-190 that renders a plain <a> instead of next/link; endpoint src/app/api/admin/export/route.ts:31-48 (guard :32, headers :42-47)
- **Inputs:** None. No date range, status filter, or column picker — it exports the fixed 22 columns for each row the one-page query returns, newest first. (The route itself belongs to the API-routes partition; listed here because it is a NAV control.)
- **Writes:** read-only — but for every returned row it EXFILTRATES private description, repro_steps, hardware_specs, driver_os and pers_id
- **Guard:** isAdmin() at src/app/api/admin/export/route.ts:32, returning 401 JSON. Note this is a plain GET with no CSRF token and no confirmation.
- **Revalidates:** —
- **On failure:** On a query error the route returns JSON {"error":"query_failed"} with status 500; on an expired session it returns {"error":"unauthorized"} 401. Either way the browser DISPLAYS RAW JSON in a new context instead of downloading — the operator gets a JSON blob, not an error UI, because a nav <a> has no failure handling.
- **Tests:** —
- **Quirks:** THE ODD ONE OUT — the single most breakable item in this partition. It is styled exactly like its three page-link siblings and sits in a list of destinations, but it downloads a file containing personal data instead of navigating. The <a>-vs-<Link> distinction is REQUIRED (Chrome.tsx:186-190): render it with next/link and the client router tries to navigate to an attachment response. It also carries no aria-current branch, has no download attribute, no size warning, and no confirmation — one stray click on a shared screen exports every row the route returns, while the current service-capped read can silently omit older reports.

#### `operator-signout-button` — Sign out

- **Kind:** button · **Destructive:** reversible
- **Reach:** Every OperatorShell page > last item in the amber console nav, styled like a nav link but rendered as a form submit button
- **Does:** Clears the operator session cookie and sends the browser to /admin/login.
- **Backing:** src/components/dispatch/Chrome.tsx:201-205 (<form action={signOutAdmin} style={{display:"contents"}}> wrapping a type="submit" button with class dispatch-nav__link dispatch-nav__link--signout) -> src/app/admin/actions.ts:39-43
- **Inputs:** Empty FormData — signOutAdmin takes no arguments and reads nothing from the request.
- **Writes:** Cookie cd_admin — overwritten with "" and maxAge 0, httpOnly, path "/" (src/app/admin/actions.ts:41; cookie name from src/lib/session.ts:3)
- **Guard:** NONE FOUND — signOutAdmin does NOT call requireAdmin() or assertProductionWriteAllowed(). Harmless (clearing an absent cookie is a no-op) but worth knowing it is the only unguarded action in this partition.
- **Revalidates:** No revalidatePath/revalidateTag; redirect("/admin/login") at src/app/admin/actions.ts:42
- **On failure:** No error path — cookies().set cannot fail here and the redirect always fires. If SESSION_SECRET later changes, stale cookies fail verification anyway.
- **Tests:** —
- **Quirks:** Two structural traps: (1) `style={{display:"contents"}}` on the wrapping form is load-bearing — it makes the form invisible to the nav's flex layout so the button aligns with the links; a redesign that switches the nav to grid or drops that style will visibly misplace Sign out; (2) it is a <button> masquerading as a nav link via dispatch-nav__link (globals.css:328-329), so keyboard and screen-reader users meet a button where the other four items are links. No confirmation step, and it sits immediately after EXPORT CSV — the two most disruptive controls are adjacent.

#### `operator-nameplate-home-link` — Crimson Desert Report Hub (nameplate wordmark)

- **Kind:** link · **Destructive:** none
- **Reach:** Every OperatorShell page > centre of the nameplate row, above the console nav
- **Does:** Leaves the console for the public homepage (/).
- **Backing:** src/components/dispatch/Chrome.tsx:177-181 (<Link href="/">)
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** none
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** —
- **Quirks:** The only exit from the console that is not Sign out, and it is not in OPERATOR_NAV — easy to miss when the nav is rebuilt from the OPERATOR_NAV array alone. It does NOT sign the operator out; the session survives, so returning to /admin restores the console.

#### `operator-patch-metadata-load` — OPERATOR · v<family> CONSOLE (automatic footer label)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Fires on render of EVERY OperatorShell page; result appears in the operator footer's link row
- **Does:** Reads the current official patch and reduces it to a major.minor family key for the footer badge.
- **Backing:** src/components/dispatch/Chrome.tsx:169-170 (getCurrentPatchMetadata + patchFamilyKey), rendered :214 -> src/lib/officialPatch.server.ts:95-104 (unstable_cache, revalidate 300, tag CURRENT_PATCH_TAG) and src/lib/patchWatch.ts:38-43
- **Inputs:** official_patch_notes where is_current = true, newest published_at
- **Writes:** read-only
- **Guard:** Runs before/independently of the page's own auth check — but OperatorShell is only rendered by pages that already called requireAdmin()/isAdmin().
- **Revalidates:** Consumes the CURRENT_PATCH_TAG cache tag; refreshes at most every 300s
- **On failure:** Fully swallowed: a read error or a throw returns fallbackCurrentPatchMetadata() (officialPatch.server.ts:87-92), and an unparseable version makes patchFamilyKey return null, which renders the plain string "OPERATOR CONSOLE" with no version. The operator is never told the patch lookup failed.
- **Tests:** —
- **Quirks:** This await makes OperatorShell an ASYNC server component (Chrome.tsx:162) — every operator page must be a server component and must await it. A redesign that turns the shell into a client component breaks all three operator pages at once. The 300s cache also means the footer version can disagree with the dossier, which reads the patch uncached through the service client (src/app/admin/actions.ts:286).

#### `operator-session-footnote` — Operator surfaces are never linked publicly. Sessions expire 12 hours after sign-in.

- **Kind:** disclosure · **Destructive:** none
- **Reach:** Every OperatorShell page > footer note, above the console badge
- **Does:** States the session policy the operator is actually subject to (absolute 12h TTL, not idle timeout).
- **Backing:** src/components/dispatch/Chrome.tsx:209-212; the 12h figure is real — maxAge 12*60*60 on the cd_admin cookie in the login route
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** tests/e2e/public-visual.spec.ts:1007 asserts /12 hours after sign-in/ is visible; :1006 asserts the words "after inactivity" appear ZERO times on the page
- **Quirks:** Copy-locked by test: an e2e assertion actively FORBIDS the phrase "after inactivity" anywhere on operator pages, and requires the exact phrase "12 hours after sign-in". A redesign that rewords this footer will fail the suite, and rightly so — the cookie is an absolute TTL, not a sliding one.

#### `skip-to-content-link` — Skip to content

- **Kind:** link · **Destructive:** none
- **Reach:** First focusable element on EVERY page in this partition (login, compile, and all operator pages) — visually hidden until focused, then pinned top-left
- **Does:** Jumps focus to #main-content, the <main> both shells render.
- **Backing:** src/app/layout.tsx:59-64 (root layout, sr-only + focus:not-sr-only); targets are src/components/dispatch/Chrome.tsx:148 (PublicShell main) and :208 (OperatorShell main)
- **Inputs:** n/a
- **Writes:** read-only
- **Guard:** none
- **Revalidates:** —
- **On failure:** If a redesigned shell drops id="main-content", the link silently jumps nowhere.
- **Tests:** —
- **Quirks:** Cross-partition coupling: the anchor lives in the root layout, the target id lives in BOTH shells. On /admin/login the login field's autoFocus (LoginForm.tsx:44) pulls focus away immediately after load, so the skip link is effectively unreachable on that page without shift-tabbing back.

**Surface notes.**

SCOPE: this partition covers `/admin/compile`, `/admin/login`, `/admin/source-monitor`, and the OperatorShell/OPERATOR_NAV portion of Chrome. It follows compileDossier, signOutAdmin, requireAdmin, preview gating, AI drafting, DossierOutput/CopyDossierButton, and dossier_runs far enough to state the operator contract; the login and export routes are detailed in their own partition.

LAYOUT: `/admin/compile` reads pagehead → compile form → optional selected-run output → previous-runs list. The newest selected run sits between creation and history. Its only empty state is "No runs yet."; no `?run=` yields no output explanation, and a failed history read is indistinguishable from no runs.

AUTH SURFACES: the full-page `/admin/login` form and footer popover post to the same endpoint but differ in autocomplete, password clearing, and cancellation. E2E covers the footer flow and a valid direct login POST, not the full-page LoginForm client behavior or invalid route branches. `tests/adminActionsAuth.test.ts:149-186` pins compileDossier's unauthenticated stop-before-work boundary; :188-204 separately proves signOutAdmin deliberately skips auth/DB work, clears the cookie, and redirects to `/admin/login`. Compile's authorized read/assemble/insert/redirect/AI-fallback behavior remains untested.

REMAINING CONTROL GAPS: EXPORT CSV on this branch, CopyDossierButton/DossierOutput behavior, history-link and `?run=` loading, LoginForm client behavior, and `/admin/source-monitor` redirect lack focused behavior tests. Static E2E coverage still pins compile chrome and screenshots.

NO SHARED ADMIN LAYOUT: each operator page mounts OperatorShell and its own auth guard; there is no admin loading or error boundary and no middleware. A server-action throw therefore falls through to the global error surface and loses operator chrome and typed form state. Crimson vs amber chrome remains the only persistent session-state tell, with no countdown or expiry warning. The nav deliberately mixes links, a sensitive download, and a sign-out mutation that look visually related but have different semantics.

### src/app/api/admin/** (login, export, scan, scan/status, status) and the /scanner admin-vs-public role gate

_7 controls · partition `inv:admin-api-routes`_

#### `admin-login-post` — POST (src/app/api/admin/login/route.ts)

- **Kind:** api-route · **Destructive:** none
- **Reach:** Not navigable. Called by fetch from two places: the full-page sign-in form at /admin/login (src/app/admin/login/LoginForm.tsx:16) and the footer "Admin" popover sign-in form on public pages (src/components/AdminControls.tsx:55). Also hit directly by e2e (tests/e2e/public-visual.spec.ts:67).
- **Does:** Verifies a submitted password and, on success, sets the admin session cookie that every other admin control in the app checks.
- **Backing:** src/app/api/admin/login/route.ts:5-27
- **Inputs:** JSON body { password?: string }. No length cap, no format validation, no CSRF token, no captcha, no rate limit, no attempt lockout. Unparseable body -> 400 invalid_json (route.ts:9-11). Missing/empty password short-circuits into the 401 branch via the \|\| at route.ts:13. Comparison is passwordMatches (src/lib/session.ts:26-34): scryptSync both candidate and actual with SESSION_SECRET as salt, then timingSafeEqual.
- **Writes:** cookie cd_admin (name from src/lib/session.ts:3); no database write; no audit/log row of any kind
- **Guard:** NONE — this is the unauthenticated entry point by design. Its own correctness depends on requiredEnv("ADMIN_PASSWORD") and requiredEnv("SESSION_SECRET") (src/lib/env.ts:136-143), both of which throw when unset or set to the literal "" / '' placeholders. There is no middleware.ts in this repo, so nothing guards this route from outside.
- **Revalidates:** —
- **On failure:** Bad JSON -> 400 {error:"invalid_json"}. Wrong or missing password -> a hardcoded 750ms sleep then 401 {error:"invalid_credentials"} (route.ts:14-15). Missing ADMIN_PASSWORD or SESSION_SECRET -> requiredEnv throws inside the condition at route.ts:13, unhandled, so Next returns a 500; both clients only test res.ok and render "Wrong password." (LoginForm.tsx:22-23, AdminControls.tsx:61-64), so a misconfigured server is indistinguishable from a bad password to the operator.
- **Tests:** tests/session.test.ts:6-40 (token round-trip, expiry, tampering, passwordMatches); tests/e2e/public-visual.spec.ts:66-69 (signInAsAdmin helper); tests/e2e/public-visual.spec.ts:1030-1041 (sign-in flow); NO route-level test file exists for this handler
- **Quirks:** Cookie contract, exact (route.ts:19-25): name cd_admin, httpOnly true, secure ONLY when NODE_ENV === "production", sameSite "lax", path "/", maxAge 43200 (12h). The token is `${expiresAt}.${HMAC-SHA256(expiresAt, SESSION_SECRET)}` (src/lib/session.ts:6-10) — it carries no identity, no nonce, no session id, so it CANNOT be revoked server-side; sign-out only deletes the browser's copy and a copied cookie stays valid for its full 12h. Two independent 12h constants must stay in sync: the cookie maxAge at route.ts:24 and DEFAULT_TTL_MS at src/lib/session.ts:4. The 750ms delay is applied only on the failure path, so response timing leaks success vs failure. No rate limiting anywhere on /api/admin/** — the only rate limiters in the codebase are on the public routes src/app/api/reports/route.ts and src/app/api/confirmations/route.ts. Both callers hardcode router.push("/admin") on success, discarding where the operator came from, so signing in from the footer on /scanner bounces you to /admin.

#### `admin-login-delete` — DELETE (src/app/api/admin/login/route.ts)

- **Kind:** api-route · **Destructive:** reversible
- **Reach:** UNREACHABLE from the UI. A grep for `method: "DELETE"` across src/ returns zero hits; nothing in the app calls this handler.
- **Does:** Clears the admin session cookie.
- **Backing:** src/app/api/admin/login/route.ts:29-33
- **Inputs:** none — no body is read, no params, no headers inspected.
- **Writes:** cookie cd_admin set to "" with maxAge 0; no database write
- **Guard:** NONE FOUND — no isAdmin() check. Low impact (it can only clear the caller's own cookie) and unreachable cross-origin without fetch, but it is genuinely unguarded.
- **Revalidates:** —
- **On failure:** Cannot fail; unconditionally returns 200 {ok:true}.
- **Tests:** —
- **Quirks:** DEAD CODE that duplicates the live sign-out. The visible "Sign out" button (src/components/dispatch/Chrome.tsx:201-205) submits a form to the signOutAdmin SERVER ACTION (src/app/admin/actions.ts:39-41), not to this route. Two implementations of one behavior, and they are not identical: the server action and this DELETE both clear cd_admin with httpOnly/path/maxAge:0, but neither re-sends `secure` or `sameSite`, unlike the POST set at route.ts:19-25. A redesign that deletes this handler loses nothing; a redesign that keeps it should know it is wired to nothing, and a redesign that removes the Chrome.tsx sign-out form thinking "the API route covers it" would leave the operator with no way to sign out.

#### `admin-export-csv` — EXPORT CSV

- **Kind:** api-route · **Destructive:** none
- **Reach:** Operator console top nav, fourth item, rendered as a plain <a> rather than a next/link (src/components/dispatch/Chrome.tsx:154-159, 186-189). Present on every OperatorShell page: /admin, /scanner, /admin/compile.
- **Does:** Attempts to download every bug_reports row as a CSV file. The current single unpaginated select can stop at the hosted PostgREST row cap, so older rows can be omitted silently. This is the only bulk data-exfiltration control on the surface.
- **Backing:** src/app/api/admin/export/route.ts:31-48
- **Inputs:** none. GET with no query params: no date range, no moderation_status filter, no platform/patch filter, no pagination, and no column selection. There is no explicit app limit or way to export a subset, but the one-shot read is still subject to the hosted service row cap.
- **Writes:** read-only (SELECT on bug_reports only)
- **Guard:** if (!(await isAdmin())) return 401 (export/route.ts:32). isAdmin (src/lib/adminGuard.ts:13-18) is cookie-only: a non-placeholder SESSION_SECRET plus a valid unexpired HMAC in cd_admin. No second factor, no re-prompt, no confirmation step before a bulk export. The query then runs with the Supabase SERVICE ROLE key (src/lib/supabase.ts:18-24), which bypasses the deny-all RLS that locks bug_reports (supabase/migrations/20260705192906_schema.sql:82).
- **Revalidates:** —
- **On failure:** Not admin -> 401 JSON {error:"unauthorized"}. Supabase error -> 500 JSON {error:"query_failed"} (route.ts:39), with the real error swallowed. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY -> requiredEnv throws, unhandled, generic 500. Because the control is a raw <a> navigation, ALL of these render as raw JSON in a browser tab — an operator with an expired session sees {"error":"unauthorized"} instead of being redirected to /admin/login. Zero rows still downloads a header-only CSV.
- **Tests:** tests/csv.test.ts:4-24 (csvEscape and buildCsv only); NO test exists for this route — no auth test, no column-set test, no filename test
- **Quirks:** EXACTLY WHAT LEAVES THE SYSTEM PER RETURNED ROW (COLUMNS at export/route.ts:6-29, 22 columns, ordered created_at desc): id, created_at, patch_version, platform, category, severity, frequency, issue_title, description, repro_steps, expected_behavior, actual_behavior, location_quest, hardware_specs, graphics_mode, driver_os, troubleshooting_tried, pers_id, official_report_submitted, evidence_url, moderation_status, cluster_id. There is NO moderation_status filter, so every returned state leaves — pending, approved, rejected AND spam — but the unpaginated read does not prove every stored row was returned. It includes the complete private free text of each returned submission (description, repro_steps, expected_behavior, actual_behavior, troubleshooting_tried, location_quest, issue_title), not the sanitized approved_excerpts. PII/identifying fields included: pers_id — the submitter's Pearl Abyss PERS report ID, a personal account identifier (schema.sql:33; form field src/app/report/ReportForm.tsx:413-414); evidence_url — usually a link to the submitter's own YouTube/Reddit/X post, i.e. deanonymizing (ReportForm.tsx:418-419); hardware_specs and driver_os — free text the user typed (ReportForm.tsx:383-384). Two columns are deliberately withheld: submitter_ip_hash and duplicate_fingerprint (schema.sql:38-39) are in the table but NOT in COLUMNS, so no IP material leaves. Filename: cd-reports-YYYY-MM-DD.csv where the date is new Date().toISOString().slice(0,10) — UTC, so an operator west of UTC can get a file dated tomorrow. Headers: content-type text/csv; charset=utf-8, content-disposition attachment (route.ts:44-45). Format hazards: buildCsv joins with CRLF and emits NO UTF-8 BOM (src/lib/csv.ts:11), so Excel mojibakes non-ASCII report text; csvEscape (csv.ts:1-4) quotes only on ",\n\r and does NOT neutralize a leading =, +, - or @, so a report body starting with = is a live formula on open (CSV injection). Coupling: the single COLUMNS array is used both as the Supabase select list (route.ts:37) and as the CSV header row (route.ts:41) — editing the header silently changes what is queried, and one typo'd name fails the entire export into the generic 500.

#### `admin-scan-start` — POST (src/app/api/admin/scan/route.ts) — driven by "Run capped scan now" and "Test scan without publishing"

- **Kind:** api-route · **Destructive:** irreversible
- **Reach:** /scanner (admin branch only) > ScanControls. Two buttons: "Test scan without publishing" sends mode=dry_run, "Run capped scan now" sends mode=manual (src/components/ScanControls.tsx:140-155, fetch at :106-110).
- **Does:** Starts a scanner automation run in the background and returns its run id immediately; the run itself keeps executing after the response.
- **Backing:** src/app/api/admin/scan/route.ts:11-37
- **Inputs:** JSON { mode }. Accepted values are exactly "manual" and "dry_run" (route.ts:21-23); anything else, including unparseable JSON which is coerced to "" at route.ts:16-20, returns 400 bad_mode. Note "scheduled" is a valid AutomationMode in the engine (src/lib/automation/run.ts:76) but is deliberately NOT accepted here. No other parameters: budget, query count and cadence all come from the stored policy, not the request.
- **Writes:** automation_runs (INSERT: started_at, status='running', mode, budget_monthly_usd, budget_remaining_before_usd, skips, progress — src/lib/automation/run.ts:2030-2051; UPDATE on finish at run.ts:2096-2103); automation_settings (READ only, via getAutomationControlState — src/lib/automation/settings.ts:129-133); then, in the background run: source_signals, issue_clusters, automation_rejected_candidates, signal_observation_events, steam_pulse_snapshots, steam_review_receipts, and platform_context_snapshots. `scanner_feedback_rules` is READ only for matching at run.ts:447-470; scans do not teach or revoke rules. mode=manual additionally runs syncOfficialPatchNote (run.ts:2502-2508), which dry_run skips; external spend: Tavily search credits and OpenRouter LLM tokens — real money, not reversible
- **Guard:** Two gates in order: isAdmin() -> 401 unauthorized (route.ts:12), then isVercelPreview() -> 403 preview_writes_disabled (route.ts:13, backed by src/lib/previewGuard.ts:3-5 checking VERCEL_ENV === "preview"). Cookie-only auth, no CSRF token, no confirmation dialog, no rate limit. The only throttle is the best-effort already-running check inside startAutomationScan.
- **Revalidates:** inside after(), and ONLY when mode === "manual" (route.ts:31-34): revalidatePublicSurfaces(); which is revalidateTag PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG and revalidatePath "/", "/issues", "/report", "/scanner" (src/lib/revalidate.ts:10-22); mode=dry_run revalidates NOTHING, by design
- **On failure:** 401 unauthorized / 403 preview_writes_disabled / 400 bad_mode / 409 scan_already_running (route.ts:28). NOT handled: getAutomationControlState throws on a settings read error (settings.ts:134) and startAutomationScan throws if createRunLedger fails (run.ts:2052-2054) — both escape as an unhandled 500 whose body is not the {error} shape the client parses, so ScanControls' res.json() throws and the operator sees "Could not reach the scan API. Check your connection and try again." (ScanControls.tsx:126-127) instead of the real cause. If the serverless instance dies before after() runs, the revalidation is silently lost — the status route exists partly to cover that gap. revalidatePublicSurfaces itself try/catches and gives up quietly (revalidate.ts:19-21).
- **Tests:** tests/adminScanRoute.test.ts:98 (401 without starting a scan); tests/adminScanRoute.test.ts:105 (403 in Vercel preview); tests/adminScanRoute.test.ts:113 (400 on bad/missing mode); tests/adminScanRoute.test.ts:123 (returns runId, registers after()); tests/adminScanRoute.test.ts:145 (409 already running); tests/adminScanRoute.test.ts:153 (after() revalidates for manual); tests/adminScanRoute.test.ts:176 (after() does not revalidate for dry_run)
- **Quirks:** maxDuration = 300 (route.ts:9) caps the whole background run at 5 minutes on Vercel; a longer run is truncated by the platform, not by this code. The already-running check is explicitly documented as BEST EFFORT AND NOT A LOCK (src/lib/automation/run.ts:186-192): sweep -> check -> create is not atomic and there is no DB unique constraint on status='running', so two simultaneous starts can both create runs and the 409 is not a guarantee. LABEL/BEHAVIOR MISMATCH WORTH FLAGGING: the scanner policy's `paused` flag is read here (route.ts:25) but never enforced — `paused` is only consulted on the scheduled path (src/lib/automation/schedule.ts:54), so "Run capped scan now" still spends money and publishes while the operator-facing pause control says scans are paused. Button labels do not contain the wire values ("Test scan without publishing" = dry_run, "Run capped scan now" = manual); a redesign that renames the buttons must not touch the strings. Both buttons share one disabled gate, disabled={scanning \|\| starting !== null} (ScanControls.tsx:143, 151), so starting either one disables both. Ordering matters: the isAdmin check precedes the preview check, so a non-admin on a preview deployment gets 401 not 403.

#### `admin-scan-status-poll` — GET (src/app/api/admin/scan/status/route.ts)

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** /scanner (admin branch). Polled every 2500ms by ScanControls whenever it holds a run id (POLL_MS at src/components/ScanControls.tsx:40, poll loop at :61-100). runId is seeded at mount from the server-rendered activeRunId prop, so simply LOADING /scanner while a run is live starts this polling with no operator action.
- **Does:** Returns one automation_runs row by id for the progress readout, and opportunistically completes housekeeping the POST side may have dropped.
- **Backing:** src/app/api/admin/scan/status/route.ts:25-53
- **Inputs:** query param id (required). Missing -> 400 missing_id (route.ts:27-28). NOT validated as a UUID and not otherwise sanitized before being passed to .eq("id", id) (route.ts:36) — a malformed id that the column type rejects surfaces as 500 read_failed rather than 400 or 404.
- **Writes:** automation_runs (UPDATE, on EVERY request, via sweepStaleRuns at route.ts:31): status='failed', finished_at=now, errors=['stale_running_run'] for any row still 'running' whose started_at is older than STALE_RUN_MINUTES (src/lib/automation/run.ts:167-184); automation_runs (SELECT id, status, mode, progress, skips, errors, started_at, finished_at); Next.js cache tags and paths, conditionally — see revalidates
- **Guard:** isAdmin() -> 401 unauthorized (route.ts:26). No per-run ownership or scoping check — any admin session can read any run id. Uses the service-role Supabase client, bypassing RLS.
- **Revalidates:** conditionally (route.ts:43-50), only when row.mode === 'manual' AND row.status !== 'running' AND finished_at is within RECENT_FINISH_WINDOW_MS (2 minutes): revalidatePublicSurfaces() — same tags/paths as the POST route; a dry_run row never revalidates, at any age
- **On failure:** 401 unauthorized / 400 missing_id / 404 not_found (route.ts:40) / 500 read_failed (route.ts:38). sweepStaleRuns swallows its own errors by design and never fails the request (run.ts:181-183). Client behavior: a 401 stops polling, clears the run id and shows "Your session expired — sign in again to check the scan." while noting the scan keeps running server-side (ScanControls.tsx:64-70); four consecutive non-401 failures stop polling with "Lost contact with the scan — refresh the page to check its status." (ScanControls.tsx:87-91).
- **Tests:** tests/adminScanRoute.test.ts:195 (401 for non-admins); tests/adminScanRoute.test.ts:201 (400 when id missing); tests/adminScanRoute.test.ts:206 (404 unknown id); tests/adminScanRoute.test.ts:213 (200 echoes progress for a running row); tests/adminScanRoute.test.ts:230 (revalidates for a manual row finished 30s ago); tests/adminScanRoute.test.ts:251 (does not revalidate for a dry_run row finished 30s ago); tests/adminScanRoute.test.ts:268 (500 when the read errors)
- **Quirks:** A GET WITH WRITE SIDE EFFECTS — it both mutates automation_runs (the stale sweep, on every single call) and busts the public page cache. Any redesign that adds link prefetching, a browser-visible "refresh status" link, or a devtools replay pointed at this URL will trigger stale sweeps and cache invalidation as a side effect. The double revalidation is deliberate redundancy, documented at route.ts:9-11: removing this poll removes the safety net for a POST after() callback killed with its serverless instance. That net is time-bounded — a poll arriving more than 2 minutes after finished_at silently loses it, so a slower poll interval degrades correctness. ScanControls seeds runId from the activeRunId prop at mount ONLY and explicitly ignores later prop changes (comment at ScanControls.tsx:45), so a redesign that remounts ScanControls on router.refresh() would restart polling on every refresh. When the run finishes, the client calls router.refresh() (ScanControls.tsx:80), which re-renders the whole /scanner admin page — that coupling is what makes fresh results appear.

#### `admin-session-probe` — GET (src/app/api/admin/status/route.ts)

- **Kind:** api-route · **Destructive:** none
- **Reach:** Not navigable. Called by the public footer "Admin" button popover to decide whether to show the password form or jump straight to /admin (src/components/AdminControls.tsx:9, invoked at :41).
- **Does:** Reports whether the caller's own browser currently holds a valid admin session.
- **Backing:** src/app/api/admin/status/route.ts:4-6
- **Inputs:** none — no params, no body. Reads only the cd_admin cookie via isAdmin().
- **Writes:** read-only
- **Guard:** NONE FOUND — intentionally unauthenticated, since it IS the session probe. Disclosure is limited to a boolean about the caller's own cookie; it reveals nothing about other sessions and does not confirm whether an admin password exists.
- **Revalidates:** —
- **On failure:** Has no failure branch and cannot 4xx/5xx in normal operation: isAdmin() returns false rather than throwing when SESSION_SECRET is missing or is the literal "" / '' placeholder (src/lib/adminGuard.ts:8-10, 14). Client-side, any network error or non-ok response is caught and treated as not-admin (AdminControls.tsx:12-15), so failure degrades to showing the password form.
- **Tests:** tests/adminStatusRoute.test.ts:9-30 (reports whether the current browser has an admin session); tests/e2e/public-visual.spec.ts:1045-1053 (pins that exactly ONE status request fires per activation, even when the request takes 1.5s)
- **Quirks:** The only route in this partition with no `export const dynamic` declaration (the two scan routes both set force-dynamic); it is dynamic anyway because isAdmin() reads cookies(). It sets NO cache-control header — the sole caller compensates with cache: "no-store" (AdminControls.tsx:9), so any new caller that forgets that can be served a stale boolean. AdminControls memoizes the answer in component state and only ever fetches when admin === null (AdminControls.tsx:39), so a session that expires while the tab is open still shows the operator as signed in until a reload — and the e2e test at public-visual.spec.ts:1053 asserts exactly one request, which will fail if a redesign re-polls. The footer Admin button that triggers this is hidden entirely on /admin* paths (AdminControls.tsx:29) to avoid two competing sign-in forms, so this probe never fires there.

#### `scanner-role-gate` — ScannerPage (route /scanner)

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner. Reached publicly from the public nav as "OBSERVATORY" (pinned tests/e2e/public-visual.spec.ts:377, 508) and from the operator nav as "SCANNER MONITOR" (src/components/dispatch/Chrome.tsx:156). Same URL for both audiences.
- **Does:** On every page load, decides from the session cookie alone whether to render the operator dashboard or the public transparency page — one URL, two entirely different pages.
- **Backing:** src/app/scanner/page.tsx:20-68; the decision is `const admin = await isAdmin()` at :21 and the `if (!admin)` branch at :25
- **Inputs:** none. No query param, no toggle, no preview switch — there is no way for a signed-in operator to see the public view without signing out, and no way for a visitor to request the admin view.
- **Writes:** read-only
- **Guard:** isAdmin() (page.tsx:21) — deliberately the non-throwing boolean check, NOT requireAdmin(). The comment at page.tsx:17-19 states the reason explicitly: requireAdmin() redirects to /admin/login, and anonymous visitors must get the public transparency view instead of being bounced. isAdmin resolves to a valid unexpired HMAC in cd_admin plus a non-placeholder SESSION_SECRET (src/lib/adminGuard.ts:13-18).
- **Revalidates:** nothing — `export const dynamic = "force-dynamic"` (page.tsx:15) means every request re-renders and re-queries, so there is no cache for this page to invalidate
- **On failure:** No error boundary in this file: if getPublicScannerData, getPatchRadarData, getIssuesData or getAutomationAdminData throws, the whole page 500s. Short of throwing, PublicScannerView degrades on its own to a "Scanner unavailable" state (src/components/scanner/PublicScannerView.tsx:44), which is what tests/e2e/n0.spec.ts:43-45 pins at N=0. The operator branch is less honest: getPatchRadarData converts either automation-run read failure into `connected=false` with `runs7d.failed=0`, then AdminScannerView can render "Nothing requires intervention." while hiding the disconnected radar band.
- **Tests:** tests/e2e/public-visual.spec.ts:871-928 (public scanner shows Source Radar without admin data; asserts private candidate text, the private mapped-candidate string, forum.example.com and the mount-input-rumor id are all absent from the HTML, and that "Scanner settings & budget" has zero matches); tests/e2e/public-visual.spec.ts:930-967 (admin scanner leads with Source Radar, kept-signal links, teaching search, cadence/budget); tests/e2e/n0.spec.ts:43-45 ("Scanner unavailable" at N=0); tests/metadata.test.ts:78 (metadata only, not the gate)
- **Quirks:** WHAT AN UNAUTHENTICATED VISITOR SEES: PublicShell(active="observatory") wrapping PublicScannerView with exactly five props — data (scoreboard), radar, integrations, patchVersion, leadQuestions (page.tsx:31-39). None of runs, signals, rejectedCandidates, observations, observationModerationAvailable, feedbackRules, feedbackLearningAvailable, control, activeRun, latestRealRun, latestFind or nowIso are computed or sent on that branch — those exist only on the admin branch (page.tsx:43-64). ASYMMETRIC FETCH: getIssuesData() is awaited ONLY on the public branch (page.tsx:26) and drives leadQuestions, which is filtered to clusters with candidateSignalCount > 0 and sorted descending (page.tsx:27-29) — so the public list can legitimately render empty, and the admin page never computes it at all; a redesign that shares one component across both branches must supply this. SHARED PREFIX: scoreboard and radar are fetched in a Promise.all BEFORE the branch (page.tsx:22), so the public request pays for both queries too, and applyLlmCircuitToStatuses mutates the integrations list using scoreboard.llmPaused (page.tsx:23) — the public integrations badge therefore depends on a scoreboard field, not on env alone. LAYOUT COUPLING: only the admin branch wraps its view in <div className="dispatch-container"> (page.tsx:47); the public branch relies on PublicShell for width. Swapping or unifying shells will change page width unless that wrapper moves with it. nowIso is computed per-render and passed only to the admin view (page.tsx:44). There is no signed-in indicator on the public branch and no "view as public" control, so an operator can never verify what visitors see except by signing out.

**Surface notes.** SCOPE: this covers only src/app/api/admin/** (5 route files, 6 HTTP handlers) plus the role-gate decision in src/app/scanner/page.tsx. The admin UI pages themselves (/admin, /admin/compile, the /admin/login page shell), the server actions in src/app/admin/actions.ts, and the AdminScannerView/ScanControls component internals belong to other partitions — I read them only far enough to establish each route's callers, request shape and error rendering.  CROSS-CUTTING FACTS A REDESIGN MUST NOT LOSE:  1. There is NO middleware.ts anywhere in the repo (verified by glob). Every admin route enforces its own guard inline, as the first statement of the handler. Two handlers have no guard at all and that is deliberate: POST /api/admin/login (the entry point) and GET /api/admin/status (the session probe). If a redesign introduces middleware, those two must stay exempt or the footer Admin popover and the login form both break.  2. There is NO rate limiting, CSRF token, captcha or lockout on any /api/admin/** route. The only rate limiters in src/ are on the public routes src/app/api/reports/route.ts and src/app/api/confirmations/route.ts. Password guessing against POST /api/admin/login is throttled only by a 750ms sleep on the failure path.  3. Auth is a single 12-hour bearer cookie with no server-side session record. The token is `${expiresAt}.${HMAC(expiresAt, SESSION_SECRET)}` (src/lib/session.ts:6-10) — no identity, no nonce, no revocation. Sign-out deletes the browser's copy only. Rotating SESSION_SECRET is the only way to invalidate outstanding sessions, and doing so also changes the password-comparison salt in passwordMatches (session.ts:31-32), so it is not a free operation.  4. Two of these routes have effects their HTTP method does not advertise. GET /api/admin/scan/status writes to automation_runs (stale sweep, every call) and can revalidate every public page. GET /api/admin/export uses the service-role key to return private columns for the rows in one potentially service-capped reports-table page. Neither is safe to prefetch.  5. Error responses are JSON, but three of these controls are reached by browser navigation or by a client that only checks res.ok, so real failures render as either raw JSON in a tab (EXPORT CSV on an expired session) or as a misleading message ("Wrong password." for a missing ADMIN_PASSWORD env; "Could not reach the scan API." for a settings-read failure). A redesign that adds proper error surfaces here is fixing a real defect, not adding polish.  6. Dead/unreachable: DELETE /api/admin/login is called by nothing. The live sign-out is the signOutAdmin server action (src/app/admin/actions.ts:39-41) behind the nav button at src/components/dispatch/Chrome.tsx:201-205.  7. Test coverage is uneven and should inform how far a redesign can move safely. Well pinned: the two scan routes (tests/adminScanRoute.test.ts, 13 cases), the status probe (tests/adminStatusRoute.test.ts), the scanner role gate (two e2e specs asserting the public page does NOT contain admin strings). Not pinned at all: the login route handler (no route test — only session-lib units and an e2e happy path) and the export route (no test whatsoever; tests/csv.test.ts covers the formatter, not the column set, the auth check, or the absence of a moderation filter). The export COLUMNS array is the single highest-consequence untested constant in this partition.  8. Method coverage: only the handlers listed exist. No OPTIONS, HEAD or CORS headers are defined, so these are same-origin fetch only and any undefined method returns Next's default 405.

### Authentication and authorization enforcement (guard layer): src/lib/adminGuard.ts, src/lib/session.ts, src/lib/previewGuard.ts, src/lib/crypto.ts, admin parts of src/lib/env.ts, and every admin-reachable entry point in src/app

_37 controls · partition `inv:auth-guard-layer`_

#### `guard-require-admin-redirect` — requireAdmin()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on page load / action invocation for every server-rendered admin surface that opts in
- **Does:** Throws a Next redirect to /admin/login when the browser has no valid admin session.
- **Backing:** src/lib/adminGuard.ts:20-22
- **Inputs:** None. Reads the cd_admin cookie via isAdmin().
- **Writes:** read-only
- **Guard:** Self — this IS the guard. Depends on adminSessionSecret() (adminGuard.ts:7) and verifySessionToken() (session.ts:12).
- **Revalidates:** —
- **On failure:** Never returns false — it redirects (throws NEXT_REDIRECT). If SESSION_SECRET is unset it redirects unconditionally, locking out even the real operator. Inside a server action the redirect surfaces to the client as a navigation, not an error toast.
- **Tests:** tests/adminGuard.test.ts; tests/adminActions.test.ts:10,24 (mocked)
- **Quirks:** Redirect target /admin/login is hardcoded with NO returnTo/next param, and both sign-in forms then push a hardcoded /admin (LoginForm.tsx:22, AdminControls.tsx:68). A deep link to /admin/compile?run=... loses its destination on every expiry. If the redesign adds new admin pages, deep-link-after-login is already broken for them.

#### `guard-is-admin-boolean` — isAdmin()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Called by API routes that must answer 401 instead of redirecting, and by /scanner to branch between two audiences
- **Does:** Returns a boolean for whether the current cookie is a valid admin session, without redirecting.
- **Backing:** src/lib/adminGuard.ts:13-18
- **Inputs:** None. cookies().get(ADMIN_COOKIE)?.value.
- **Writes:** read-only
- **Guard:** Self. Returns false (fails closed) when adminSessionSecret() is null.
- **Revalidates:** —
- **On failure:** Returns false on any of: missing secret, missing cookie, malformed token, bad signature, expired timestamp. No distinction between them is exposed to the caller, so no route can tell 'expired' from 'never signed in'.
- **Tests:** tests/adminStatusRoute.test.ts; tests/adminScanRoute.test.ts:15,99,196
- **Quirks:** This is the ONLY reason /scanner serves anonymous visitors instead of bouncing them (src/app/scanner/page.tsx:17-21, comment explicitly calls this out). Swapping it for requireAdmin during a reorg would silently delete the entire public transparency view.

#### `guard-admin-session-secret` — adminSessionSecret()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs first inside every isAdmin()/requireAdmin() call
- **Does:** Resolves SESSION_SECRET, returning null for missing, whitespace-only, or literally-quoted-empty values.
- **Backing:** src/lib/adminGuard.ts:7-11
- **Inputs:** process.env.SESSION_SECRET (injectable env param for tests).
- **Writes:** read-only
- **Guard:** N/A — env reader.
- **Revalidates:** —
- **On failure:** Returns null, which makes isAdmin() false and requireAdmin() redirect. Fails closed by design and never throws.
- **Tests:** tests/adminGuard.test.ts:14-25
- **Quirks:** Rejects the literal strings "\"\"" and "''" (line 9) because .env files sometimes carry quoted-empty values — a silently accepted secret of '""' would otherwise make every session forgeable by anyone who guesses it. This defensive check is invisible and easy to drop in a refactor. Deliberately does NOT use requiredEnv() (which throws), so the guard path and the login path disagree about missing config.

#### `guard-session-token-mint` — createSessionToken()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs once inside POST /api/admin/login on a correct password
- **Does:** Builds the cookie value: an expiry timestamp plus its HMAC-SHA256 signature.
- **Backing:** src/lib/session.ts:6-10 (DEFAULT_TTL_MS at :4)
- **Inputs:** secret (SESSION_SECRET), optional ttlMs, default 12 h.
- **Writes:** cookie cd_admin (set at src/app/api/admin/login/route.ts:19)
- **Guard:** Only reachable after passwordMatches() returns true (login route.ts:13).
- **Revalidates:** —
- **On failure:** createHmac throws if secret is empty; the login route already threw at requiredEnv before this point, so in practice unreachable.
- **Tests:** tests/session.test.ts:8-28
- **Quirks:** The signed payload is the expiry and nothing else — no session id, no issued-at, no key version. Two sign-ins in the same millisecond produce byte-identical cookies, and there is no way to revoke one session without rotating SESSION_SECRET (which also re-keys every stored IP hash, see notes). The 12 h TTL is duplicated in three places that must stay in sync: session.ts:4, login route.ts:24 (maxAge 43200), Chrome.tsx:211 (user-visible copy).

#### `guard-session-token-verify` — verifySessionToken()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every guarded page load, action, and API call
- **Does:** Validates token shape, signature, and expiry in constant time.
- **Backing:** src/lib/session.ts:12-24
- **Inputs:** token string from the cd_admin cookie, secret.
- **Writes:** read-only
- **Guard:** Self.
- **Revalidates:** —
- **On failure:** Returns false for undefined token, wrong part count, non-numeric expiry, length mismatch, signature mismatch, or past expiry. Never throws.
- **Tests:** tests/session.test.ts:13-28
- **Quirks:** Order matters and is security-relevant: the /^\d+$/ shape check (line 17) runs BEFORE the HMAC, and the length compare (line 21) runs BEFORE timingSafeEqual (which throws on unequal lengths). Expiry is checked LAST (line 23), after the signature — so an attacker cannot use timing on expiry to probe the secret. Reordering these during cleanup would introduce a crash or a leak.

#### `guard-password-compare` — passwordMatches()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs once per sign-in attempt, from either sign-in surface
- **Does:** Compares the submitted password to ADMIN_PASSWORD by scrypt-deriving both sides with SESSION_SECRET as the salt, then constant-time comparing.
- **Backing:** src/lib/session.ts:26-34
- **Inputs:** candidate (user input, no length or charset validation), actual (ADMIN_PASSWORD), comparisonSecret (SESSION_SECRET).
- **Writes:** read-only
- **Guard:** N/A — this is the credential check itself.
- **Revalidates:** —
- **On failure:** Throws Error('comparison secret required') if the secret is empty (line 27). Returns false on mismatch. Both derived buffers are always 64 bytes, so timingSafeEqual cannot throw here.
- **Tests:** tests/session.test.ts:32-40
- **Quirks:** scryptSync is called TWICE per attempt (candidate and actual) at Node defaults, synchronously — roughly 200 ms of blocked event loop per sign-in attempt, with no rate limit in front of it (see login route). No verifier is stored, by explicit design (comment at session.ts:28-30): ADMIN_PASSWORD lives in plaintext env and is re-derived every time. Changing SESSION_SECRET does not invalidate the password, only the sessions and the IP hashes.

#### `guard-preview-write-assert` — assertProductionWriteAllowed()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs immediately after requireAdmin() in all 12 guarded server actions
- **Does:** Throws on Vercel preview deploys so preview traffic cannot write to the production database.
- **Backing:** src/lib/previewGuard.ts:7-9
- **Inputs:** None (reads VERCEL_ENV).
- **Writes:** read-only
- **Guard:** N/A — environment gate, not identity. Always paired second, after requireAdmin.
- **Revalidates:** —
- **On failure:** Throws Error('preview writes disabled') — an unhandled server-action error, surfaced to the operator as a generic error boundary, NOT a friendly message.
- **Tests:** tests/adminActions.test.ts:443,870
- **Quirks:** Ordering is load-bearing: identity check first, so an unauthenticated preview visitor gets a redirect instead of an error that reveals the deploy type. Every guarded action repeats the same two lines by hand — there is no wrapper, so a new action added during a reorg gets neither guard unless someone remembers both.

#### `guard-preview-env-check` — isVercelPreview()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs at the top of write-bearing API routes
- **Does:** Reports whether VERCEL_ENV === 'preview' so a route can return a clean 403 instead of throwing.
- **Backing:** src/lib/previewGuard.ts:3-5
- **Inputs:** None.
- **Writes:** read-only
- **Guard:** N/A.
- **Revalidates:** —
- **On failure:** Cannot fail; a missing VERCEL_ENV simply reads as not-preview (production behavior).
- **Tests:** tests/adminScanRoute.test.ts:16,106; tests/confirmationsRoute.test.ts:69
- **Quirks:** Applied inconsistently. Present: /api/admin/scan (route.ts:13), /api/cron/keepalive (:19), /api/reports (:16), /api/confirmations (:35). ABSENT: /api/admin/scan/status, which writes automation_runs through sweepStaleRuns; and /api/cron/source-preview, which spends Tavily budget from a preview deploy. See those entries.

#### `guard-required-env-throw` — requiredEnv()

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs inside POST /api/admin/login and inside the two public IP-hashing routes
- **Does:** Returns a trimmed env value or throws 'Missing required env var: NAME'.
- **Backing:** src/lib/env.ts:136-143
- **Inputs:** One of the four literal names SUPABASE_URL \| SUPABASE_SERVICE_ROLE_KEY \| ADMIN_PASSWORD \| SESSION_SECRET.
- **Writes:** read-only
- **Guard:** N/A.
- **Revalidates:** —
- **On failure:** Throws. In POST /api/admin/login the throw is uncaught, so a missing ADMIN_PASSWORD or SESSION_SECRET yields HTTP 500, not 401.
- **Tests:** tests/env.test.ts:205-223
- **Quirks:** Rejects quoted-empty values ('""' / "''") at line 140 the same way adminSessionSecret does — the same defensive rule written twice in two files with two different failure modes (throw vs null). A redesign that unifies them must decide which behavior wins; making adminGuard throw would turn a locked-out admin into a 500 on every public page that touches the guard.

#### `guard-no-global-middleware` — (no middleware.ts)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Global — or rather, its absence is global
- **Does:** Nothing. There is no edge/middleware layer, so no request is authenticated before it reaches a route handler.
- **Backing:** No src/middleware.ts and no middleware.* anywhere outside node_modules (verified by glob); no src/app/admin/layout.tsx either
- **Inputs:** N/A
- **Writes:** read-only
- **Guard:** NONE FOUND — protection is entirely per-route and opt-in.
- **Revalidates:** —
- **On failure:** Silent. A new route under src/app/admin or src/app/api/admin that omits requireAdmin/isAdmin is publicly reachable with no error, no warning, and no test failure.
- **Tests:** —
- **Quirks:** This is the structural risk for the reorganization. Today the /admin URL prefix carries NO authority of its own — /admin/login and /admin/source-monitor sit under it unguarded (correctly), and the most privileged operator surface (/scanner admin view) sits OUTSIDE it. Any assumption of the form 'everything under /admin is protected' is false in both directions.

#### `guard-cron-bearer-keepalive` — CRON_SECRET bearer check (keepalive)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** GET /api/cron/keepalive — called by the Cloudflare Worker in cloudflare/scanner-cron and by .github/workflows/hourly-scan.yml
- **Does:** Rejects any caller whose Authorization header is not exactly `Bearer <CRON_SECRET>`.
- **Backing:** src/app/api/cron/keepalive/route.ts:12-18
- **Inputs:** Authorization request header.
- **Writes:** read-only at the guard; the route body writes source_signals.raw_text, source_signals.raw_expires_at and automation_runs
- **Guard:** Shared bearer secret, not an admin session. An operator with a valid cd_admin cookie CANNOT call this route.
- **Revalidates:** —
- **On failure:** 500 {'error':'cron secret missing'} when CRON_SECRET is unset (fails closed before comparing); 401 {'error':'unauthorized'} on mismatch; 403 preview_writes_disabled on preview deploys.
- **Tests:** tests/automationRun.test.ts:4526,4545,4565
- **Quirks:** Plain string equality on the header (line 16), not timing-safe — unlike the session path, which is. Two entirely different auth schemes now coexist (cookie HMAC vs shared bearer); a redesign that consolidates 'admin actions' must not accidentally put the cron route behind the cookie, or the Worker and the GitHub Action both break silently at 401.

#### `guard-cron-bearer-source-preview` — CRON_SECRET bearer check (source preview)

- **Kind:** automatic · **Destructive:** none
- **Reach:** GET /api/cron/source-preview?queries=N — no in-app caller; invoked manually per docs/OPERATIONS.md:82
- **Does:** Same bearer check, then runs a capped Tavily search preview and returns the raw result.
- **Backing:** src/app/api/cron/source-preview/route.ts:13-19 (guard), :21 (work)
- **Inputs:** Authorization header; ?queries clamped to 0..2 (route.ts:4-10).
- **Writes:** read-only (no DB write), but consumes external Tavily API quota
- **Guard:** Shared CRON_SECRET bearer. No admin session, no preview guard.
- **Revalidates:** —
- **On failure:** 500 when CRON_SECRET unset; 401 on mismatch; an upstream Tavily failure propagates as an unhandled 500.
- **Tests:** —
- **Quirks:** The ONLY admin-adjacent route with no isVercelPreview() check, so a preview deployment holding the same CRON_SECRET burns production Tavily budget. Also unreachable from any UI — it exists purely as a curl target documented in docs/OPERATIONS.md, so a UI-driven redesign will not notice if it disappears.

#### `guard-robots-disallow` — robots.txt disallow

- **Kind:** automatic · **Destructive:** none
- **Reach:** Generated at /robots.txt on every deploy
- **Does:** Asks crawlers not to index /admin* or /api*.
- **Backing:** src/app/robots.ts:9
- **Inputs:** None.
- **Writes:** read-only
- **Guard:** N/A — obscurity, not access control. Enforces nothing.
- **Revalidates:** —
- **On failure:** Silent; a non-compliant crawler ignores it.
- **Tests:** —
- **Quirks:** Does NOT list /scanner, which is correct only because /scanner has a genuine public view. If the reorg moves operator tooling to a new prefix (e.g. /operator or /console), this disallow list must move with it or the new admin surface becomes crawlable.

#### `guard-session-secret-doubles-as-ip-salt` — SESSION_SECRET reused as IP hash salt

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every public report submission and every confirmation tap — not an admin surface, but coupled to the admin secret
- **Does:** Salts hashIp() with the same secret that signs admin sessions.
- **Backing:** src/lib/crypto.ts:16-18; callers src/app/api/reports/route.ts:40 and src/app/api/confirmations/route.ts:62
- **Inputs:** x-forwarded-for first hop; SESSION_SECRET.
- **Writes:** bug_reports.submitter_ip_hash; record_issue_confirmation RPC arg p_voter_ip_hash
- **Guard:** None on the hashing itself; the surrounding routes have their own gates (Turnstile, same-origin, preview).
- **Revalidates:** —
- **On failure:** requiredEnv throws if SESSION_SECRET is unset, so the public report and confirmation endpoints 500 — meaning an unset admin secret also takes down public submissions.
- **Tests:** tests/crypto.test.ts; tests/reportsRoute.test.ts; tests/confirmationsRoute.test.ts:32
- **Quirks:** Hidden coupling with real consequences: rotating SESSION_SECRET is the ONLY way to revoke an admin session, and doing so silently invalidates every stored IP hash — resetting the per-hour submission rate limit (reports route.ts:47) and the one-tap-per-voter confirmation dedupe. Nothing in the admin UI mentions this. If the redesign adds a 'sign out everywhere' control, this is what it will actually break.

#### `page-admin` — /admin (Report review)

- **Kind:** route · **Destructive:** none
- **Reach:** /admin — operator nav item REPORT REVIEW
- **Does:** Renders the moderation queue, cluster tables and break-glass forms.
- **Backing:** src/app/admin/page.tsx:24-26 (guard at :25); dynamic = 'force-dynamic' at :19
- **Inputs:** None on load.
- **Writes:** read-only on load
- **Guard:** await requireAdmin() — src/app/admin/page.tsx:25, first statement in the component.
- **Revalidates:** —
- **On failure:** No session -> redirect to /admin/login. Supabase read failures are NOT caught here; a failed query surfaces as the Next error boundary.
- **Tests:** tests/adminClusters.test.ts; tests/queriesAdminCompatibility.test.ts
- **Quirks:** force-dynamic (:19) is required — with static rendering the cookie read in requireAdmin would be a build-time error. Any move to a shared layout guard must keep the per-page dynamic declaration.

#### `page-admin-compile` — /admin/compile (Compile Pearl Abyss dossier)

- **Kind:** route · **Destructive:** none
- **Reach:** /admin/compile — operator nav item COMPILE DOSSIER; also reached from ?run=<id> links in the Previous runs list
- **Does:** Reads the newest 10 dossier runs, renders the compile form and run history, and, when `?run` is present, reads and renders that previously generated dossier.
- **Backing:** src/app/admin/compile/page.tsx:25-26 (guard at :26); dynamic = 'force-dynamic' at :8
- **Inputs:** searchParams.run — an arbitrary string passed straight into .eq('id', run).single() at :39 with no validation.
- **Writes:** read-only on load
- **Guard:** await requireAdmin() — src/app/admin/compile/page.tsx:26.
- **Revalidates:** —
- **On failure:** No session -> redirect. The newest-10 query discards `error`, so a real read failure becomes "No runs yet." A missing, malformed, or otherwise failed `?run` `.single()` query also discards `error`; `current` stays null and the page silently renders without the dossier. Both paths counterfeit an ordinary empty/no-selection state.
- **Tests:** tests/dossier.test.ts covers only the pure builder; no page-read test forces either `dossier_runs` failure.
- **Quirks:** Guard runs BEFORE `await searchParams` (:26 then :27) — correct ordering that a refactor could easily invert. Phase 4 must keep the status neutral rather than rendering a green zero, surface newest-10 history failures, and distinguish a missing/malformed selected run from no run selected while surfacing other selected-run read failures.

#### `page-admin-login` — /admin/login (Sign in)

- **Kind:** route · **Destructive:** none
- **Reach:** /admin/login — the redirect target of every requireAdmin() failure
- **Does:** Renders the full-page operator sign-in form inside public chrome.
- **Backing:** src/app/admin/login/page.tsx:6-14
- **Inputs:** None on load.
- **Writes:** read-only
- **Guard:** NONE FOUND — intentionally public; it is the sign-in surface. Note it also performs no reverse check: an already-signed-in operator sees the login form again rather than being sent to /admin.
- **Revalidates:** —
- **On failure:** Cannot fail on load — no data fetch, no cookie read.
- **Tests:** tests/e2e/public-visual.spec.ts:67
- **Quirks:** Deliberately renders PublicShell, not OperatorShell (comment at page.tsx:4-5): amber operator chrome must never appear to a signed-out visitor. It is also the only /admin/* page with no `dynamic` export and no data access. If the reorg wraps /admin in a guarded layout, THIS page must be excluded or sign-in becomes an infinite redirect loop.

#### `page-admin-source-monitor` — /admin/source-monitor (legacy redirect)

- **Kind:** route · **Destructive:** none
- **Reach:** /admin/source-monitor — old bookmarks and stale in-app links only; no current nav item points here
- **Does:** Immediately redirects to /scanner.
- **Backing:** src/app/admin/source-monitor/page.tsx:5-7
- **Inputs:** None.
- **Writes:** read-only
- **Guard:** NONE FOUND — no requireAdmin, no isAdmin. It redirects unconditionally, so an anonymous visitor lands on the PUBLIC /scanner view. No information leaks, but the URL confirms the path exists.
- **Revalidates:** —
- **On failure:** Cannot fail.
- **Tests:** —
- **Quirks:** Dead-ish but load-bearing in an unexpected way: eleven revalidatePath('/admin/source-monitor') calls still fire across the server actions (actions.ts:442,453,466,540,607,692,726) for a route that only redirects. Deleting the page without deleting those calls leaves revalidations pointing at nothing; deleting the calls without checking is harmless. Either way, this is exactly the kind of file a reorg deletes silently.

#### `page-scanner-admin-view` — /scanner (The Observatory — admin view)

- **Kind:** route · **Destructive:** none
- **Reach:** /scanner — operator nav item SCANNER MONITOR, and the public Observatory nav item; same URL for both audiences
- **Does:** Serves the public transparency view to anonymous visitors and the full operator scanner console (runs, signals, rejected candidates, observations, feedback rules, controls) to a signed-in admin.
- **Backing:** src/app/scanner/page.tsx:20-21 (isAdmin at :21), public branch :25-41, admin branch :43-62
- **Inputs:** None on load.
- **Writes:** read-only on load
- **Guard:** await isAdmin() — src/app/scanner/page.tsx:21. Non-throwing branch, NOT requireAdmin. Anonymous visitors are served, not redirected.
- **Revalidates:** —
- **On failure:** isAdmin() false for any reason (expired, unset SESSION_SECRET, bad cookie) silently downgrades the operator to the public view with no message. An operator whose session just expired sees a working page and simply loses every control.
- **Tests:** tests/adminScannerView.test.ts; tests/queries.test.ts
- **Quirks:** The single most reorg-fragile entry point. It is the ONLY admin surface outside the /admin prefix, it is not covered by robots.ts:9, and the silent downgrade means a guard regression here produces no error — just a page that quietly stops offering the operator anything. The comment at :17-19 exists specifically to stop someone 'fixing' isAdmin into requireAdmin.

#### `api-admin-login-post` — POST /api/admin/login

- **Kind:** api-route · **Destructive:** none
- **Reach:** Called by both sign-in surfaces: src/app/admin/login/LoginForm.tsx:16 and src/components/AdminControls.tsx:55
- **Does:** Checks the shared password and, on success, mints and sets the cd_admin session cookie.
- **Backing:** src/app/api/admin/login/route.ts:5-27
- **Inputs:** JSON body {password}. No length cap, no charset validation, no CSRF token, no origin check.
- **Writes:** cookie cd_admin (route.ts:19-25) — no database write
- **Guard:** NONE FOUND by design — this is the credential endpoint. The password itself (passwordMatches, session.ts:26) is the only gate. No rate limit, no lockout, no IP throttle, no captcha; the sole friction is a fixed 750 ms sleep on the failure branch (route.ts:14).
- **Revalidates:** —
- **On failure:** 400 invalid_json on unparseable body; 401 invalid_credentials on wrong or missing password (after the 750 ms delay); UNCAUGHT throw -> 500 when ADMIN_PASSWORD or SESSION_SECRET is unset or quoted-empty (requiredEnv at :13,:19).
- **Tests:** tests/session.test.ts (passwordMatches); tests/e2e/public-visual.spec.ts:67
- **Quirks:** Both clients only test res.ok (LoginForm.tsx:22, AdminControls.tsx:61), so a 500 from missing env renders the identical message 'Wrong password.' — the label does not match what happened, and a misconfigured production deploy looks exactly like a typo. Also: unauthenticated, unthrottled, and it burns ~200 ms of synchronous scrypt per request (two scryptSync calls), so it is the cheapest event-loop DoS surface in the app. It is reachable regardless of Vercel preview status — no isVercelPreview check.

#### `api-admin-login-delete` — DELETE /api/admin/login

- **Kind:** api-route · **Destructive:** reversible
- **Reach:** No caller anywhere in the repo — reachable only by direct HTTP
- **Does:** Clears the cd_admin cookie and returns {ok:true}.
- **Backing:** src/app/api/admin/login/route.ts:29-33
- **Inputs:** None.
- **Writes:** cookie cd_admin cleared (maxAge 0)
- **Guard:** NONE FOUND. No isAdmin, no origin check. Harmless in effect (it can only clear the caller's own cookie) but it is an unguarded handler.
- **Revalidates:** —
- **On failure:** Cannot fail.
- **Tests:** —
- **Quirks:** Dead code today: sign-out goes exclusively through the signOutAdmin server action (Chrome.tsx:201). This is a second, divergent logout path — it does NOT redirect and does NOT set httpOnly/secure consistently with the mint path. A redesign will either delete it (safe) or wire the UI to it (and lose the redirect). Note the mismatch is real: the DELETE clear omits `secure` and `sameSite` that the POST set.

#### `api-admin-status-get` — GET /api/admin/status

- **Kind:** api-route · **Destructive:** none
- **Reach:** Called by the public footer Admin button before opening the sign-in popover — src/components/AdminControls.tsx:9
- **Does:** Reports whether the CALLER's own cookie is a valid admin session.
- **Backing:** src/app/api/admin/status/route.ts:4-6
- **Inputs:** None (cookie only).
- **Writes:** read-only
- **Guard:** NONE FOUND — deliberately unauthenticated, returns 200 {admin:false} to anonymous callers. It leaks only the caller's own state, never anyone else's.
- **Revalidates:** —
- **On failure:** isAdmin() swallows everything into false, so a missing SESSION_SECRET returns {admin:false} with a 200. The footer button then offers a sign-in form that is guaranteed to 500.
- **Tests:** tests/adminStatusRoute.test.ts
- **Quirks:** Has no `dynamic = 'force-dynamic'` export, unlike the other admin routes; it relies on cookies() to opt it out of static rendering implicitly. It is also the only thing that makes the public footer Admin button behave differently for a signed-in operator — remove it and that button always shows a password prompt.

#### `api-admin-scan-post` — POST /api/admin/scan

- **Kind:** api-route · **Destructive:** reversible
- **Reach:** Called by the scanner Run controls — src/components/ScanControls.tsx:106
- **Does:** Starts a manual or dry-run automation scan in the background.
- **Backing:** src/app/api/admin/scan/route.ts:11-37 (guards at :12-13); dynamic force-dynamic :8, maxDuration 300 :9
- **Inputs:** JSON body {mode} — must be exactly 'manual' or 'dry_run' (:21-23).
- **Writes:** automation_runs (via startAutomationScan); source_signals and downstream tables when mode = manual
- **Guard:** isAdmin() -> 401 (route.ts:12), then isVercelPreview() -> 403 (route.ts:13). Correct order: identity before environment.
- **Revalidates:** revalidatePublicSurfaces() inside after(), only when mode === 'manual' (route.ts:31-34)
- **On failure:** 401 unauthorized; 403 preview_writes_disabled; 400 bad_mode; 409 scan_already_running. Unparseable JSON degrades to mode='' and then 400 bad_mode (:16-20).
- **Tests:** tests/adminScanRoute.test.ts:97-193
- **Quirks:** The revalidation lives inside after() and is skipped entirely for dry_run — and if the serverless instance dies before after() runs, the refresh never happens. That gap is patched by the status poll (see next entry), so the two routes are coupled: dropping the poll silently loses cache invalidation for manual scans.

#### `api-admin-scan-status-get` — GET /api/admin/scan/status?id=

- **Kind:** api-route · **Destructive:** reversible
- **Reach:** Polled by the scanner Run controls while a run is in flight — src/components/ScanControls.tsx:63
- **Does:** Returns one automation_runs row, sweeps stale runs, and opportunistically revalidates public pages.
- **Backing:** src/app/api/admin/scan/status/route.ts:25-53 (guard at :26)
- **Inputs:** ?id query param, required (:27-28).
- **Writes:** automation_runs.status, automation_runs.finished_at, automation_runs.errors — via sweepStaleRuns (route.ts:31 -> src/lib/automation/run.ts:167-184)
- **Guard:** isAdmin() -> 401 (route.ts:26). NO preview guard.
- **Revalidates:** revalidatePublicSurfaces() when a manual run finished within RECENT_FINISH_WINDOW_MS = 2 min (route.ts:43-50)
- **On failure:** 401 unauthorized; 400 missing_id; 500 read_failed; 404 not_found. sweepStaleRuns swallows its own errors by design (run.ts:181-183), so a failed sweep is invisible.
- **Tests:** tests/adminScanRoute.test.ts:194+
- **Quirks:** A GET that WRITES: sweepStaleRuns marks stale running rows failed, and it runs with no isVercelPreview() check — a preview deploy polling this endpoint mutates the production automation_runs table. Also carries the belt-and-suspenders revalidation described at route.ts:9-12; it is not merely a read, and treating it as one during a redesign loses both behaviors.

#### `api-admin-export-get` — EXPORT CSV — GET /api/admin/export

- **Kind:** download · **Destructive:** none
- **Reach:** Operator nav item EXPORT CSV, rendered as a plain <a> (not a Link) — src/components/dispatch/Chrome.tsx:158,187
- **Does:** Attempts to stream every bug_reports row (22 fixed columns) as a CSV attachment; the single unpaginated select can stop at the hosted row cap.
- **Backing:** src/app/api/admin/export/route.ts:31-48 (guard at :32; COLUMNS at :6-29)
- **Inputs:** None — no filters, no date range, and no pagination. No explicit app limit does not make the read complete.
- **Writes:** read-only
- **Guard:** isAdmin() -> 401 JSON (route.ts:32). No preview guard needed (read-only).
- **Revalidates:** —
- **On failure:** 401 unauthorized; 500 query_failed on a Supabase error. On 401 the browser navigates to a raw JSON error page rather than the login form, because this is a plain link, not a fetch.
- **Tests:** tests/csv.test.ts
- **Quirks:** The one operator nav item that leaves the app entirely (full navigation, no client routing) — hence the deliberate <a>/<Link> split at Chrome.tsx:186-199. It exports a fixed allowlist including submitter-adjacent fields (pers_id, hardware_specs, driver_os), but its one-shot read can be service-capped. An expired session turns this nav item into a JSON 401 page with no way back except the browser Back button.

#### `api-cron-keepalive` — GET /api/cron/keepalive

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** Not operator-reachable from the UI. Triggered by the Cloudflare Worker (cloudflare/scanner-cron) and .github/workflows/hourly-scan.yml:22
- **Does:** Touches the DB to prevent Supabase pausing, purges expired raw_text, and runs the scheduled scan when policy allows.
- **Backing:** src/app/api/cron/keepalive/route.ts:11-68 (guards at :12-21); maxDuration 300 at :9
- **Inputs:** Authorization: Bearer <CRON_SECRET>.
- **Writes:** source_signals.raw_text -> null; source_signals.raw_expires_at -> null; automation_runs (via runAutomationMonitor or insertSkippedScheduledRun)
- **Guard:** CRON_SECRET bearer (route.ts:12-18) then isVercelPreview -> 403 (route.ts:19-21). No admin session involved.
- **Revalidates:** revalidatePublicSurfaces() when the scan status is success or partial (route.ts:53-55)
- **On failure:** 500 cron secret missing; 401 unauthorized; 403 preview_writes_disabled. Touch/purge errors do not abort — they are reported in the response body as {ok:false, touch, purge} (route.ts:61-67).
- **Tests:** tests/automationRun.test.ts:4502-4880
- **Quirks:** Writes on a GET, and the response body is the only place errors surface — no throw, no log-level failure. The scheduled scan it launches shares automation_runs with the operator's manual scan, so the 409 scan_already_running on /api/admin/scan can be caused by cron rather than by the operator, with no UI explanation.

#### `action-sign-out` — Sign out (server action signOutAdmin)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** Operator chrome > nav bar, rightmost item, inside a <form> — src/components/dispatch/Chrome.tsx:201-205
- **Does:** Clears the cd_admin cookie and redirects to /admin/login.
- **Backing:** src/app/admin/actions.ts:39-43
- **Inputs:** None — empty form submit.
- **Writes:** cookie cd_admin cleared (actions.ts:41)
- **Guard:** NONE FOUND — no requireAdmin, no assertProductionWriteAllowed. It is the only exported action in actions.ts with neither. Safe in effect (it can only clear the caller's own cookie) and protected from cross-site invocation only by Next's built-in server-action origin check.
- **Revalidates:** —
- **On failure:** Cannot fail: cookies().set never throws here, and redirect() always completes. There is no error path and therefore no error UI.
- **Tests:** —
- **Quirks:** Does NOT revoke the token — the cookie value stays cryptographically valid until its embedded 12 h expiry, so a copied cookie survives sign-out. Also clears with a different attribute set than the mint path (no secure, no sameSite), and duplicates DELETE /api/admin/login. Because it is unguarded, it is the one server action that keeps working after SESSION_SECRET is removed.

#### `actions-guarded-batch` — 12 guarded server actions in src/app/admin/actions.ts

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** Submitted from forms across /admin, /admin/compile and the /scanner admin view
- **Does:** Every write-bearing operator action: moderateReport, setClusterFixStatus, setClusterVisibilityOverride, clearClusterFixStatusOverride, setCurrentPatchOverride, compileDossier, runRedditMonitor, setAutomationPaused, setScannerPolicy, recordScannerDecision, rejectObservationAndTeach, undoScannerDecision.
- **Backing:** src/app/admin/actions.ts — guard pairs at 112/113, 168/169, 198/199, 235/236, 264/265, 282/283, 399/400, 447/448, 458/459, 471/472, 620/621, 709/710
- **Inputs:** FormData per action; each validates its own fields and throws Error('bad input') on failure. (Field-level detail belongs to the actions partition.)
- **Writes:** bug_reports; approved_excerpts; issue_clusters; dossier_runs; source_signals; automation_rejected_candidates; patch_observations; automation settings — see the actions partition for exact columns
- **Guard:** Uniform and hand-repeated: `await requireAdmin();` then `assertProductionWriteAllowed();` as the first two statements of every one of the 12. No wrapper, no decorator, no shared helper.
- **Revalidates:** revalidatePath('/admin'); revalidatePath('/scanner'); revalidatePath('/admin/source-monitor'); revalidatePublicSurfaces()
- **On failure:** Signed out -> redirect to /admin/login (thrown, so the form submit becomes a navigation). Preview deploy -> throws 'preview writes disabled' into the error boundary. Bad input -> throws 'bad input'. None of these render a friendly inline message.
- **Tests:** tests/adminActions.test.ts; tests/scannerFeedback.test.ts; tests/moderation.test.ts
- **Quirks:** The guard is copy-paste, twice per action, twenty-four lines total with no enforcement that a new action includes them — combined with the absence of middleware this is the parity hazard. The two lines must stay in this order (identity before environment). runRedditMonitor is additionally dead behind features().reddit, which computeFeatures hardcodes to false (src/lib/env.ts:35), so it throws 'reddit monitor permanently disabled' at actions.ts:401 even for a valid admin.

#### `action-rescue-rejected-candidate` — rescueRejectedCandidate (compatibility server action)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** Exported for older Rescue forms; no current component references it
- **Does:** Rebuilds a FormData with decision='relevant' and a canned reason, then delegates to recordScannerDecision.
- **Backing:** src/app/admin/actions.ts:697-706
- **Inputs:** FormData id only (:698).
- **Writes:** whatever recordScannerDecision writes — source_signals via rescueCandidateSignal, automation_rejected_candidates.rescued_at, scanner decision rows via the record_scanner_decision RPC
- **Guard:** NO DIRECT GUARD — no requireAdmin and no assertProductionWriteAllowed in its own body. It is protected only indirectly, because recordScannerDecision guards at actions.ts:471-472.
- **Revalidates:** inherited from recordScannerDecision: /admin, /scanner, /admin/source-monitor, revalidatePublicSurfaces()
- **On failure:** Throws 'bad input' on a missing id BEFORE any guard runs (:699) — so an unauthenticated caller gets a validation error rather than a redirect, a small behavior divergence from every other action.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** Guard-by-delegation is invisible at the call site. If a reorg inlines or rewrites this wrapper without noticing that the guard lives one level down, it becomes an unauthenticated write path. It also hardcodes the audit reason 'Operator reviewed this candidate and marked it relevant.' (:703), which will appear verbatim in the decision record.

#### `ui-footer-admin-button` — Admin

- **Kind:** button · **Destructive:** none
- **Reach:** Public footer > links row, last item, on EVERY non-/admin public page — src/components/dispatch/Chrome.tsx:80 -> src/components/AdminControls.tsx:73
- **Does:** If already known-signed-in, routes straight to /admin; otherwise opens the sign-in popover and fetches /api/admin/status once.
- **Backing:** src/components/AdminControls.tsx:31-49 (handler), :73-75 (button)
- **Inputs:** None.
- **Writes:** read-only
- **Guard:** None needed — it only reveals a password prompt. The status probe it fires is itself unguarded by design.
- **Revalidates:** —
- **On failure:** readAdminStatus() catches everything and returns false (AdminControls.tsx:13-15), so a network failure silently presents the password form to an already-signed-in operator.
- **Tests:** tests/e2e/public-visual.spec.ts:1045 (route mocked)
- **Quirks:** State-dependent in a way that is invisible: `admin` starts null and is NEVER checked on mount, so the button looks identical signed-in and signed-out; the difference only appears after the first click. Self-hides on any path starting with '/admin' (:29) to avoid two competing sign-in forms — that early return sits BEFORE the hooks' usage but after all useState calls, so reordering it would break the rules of hooks.

#### `ui-footer-signin-password` — Admin password (footer popover input)

- **Kind:** text-input · **Destructive:** none
- **Reach:** Public footer > Admin > Operator sign-in popover
- **Does:** Collects the shared operator password.
- **Backing:** src/components/AdminControls.tsx:106-112
- **Inputs:** type=password, autoComplete='current-password', no maxLength, no pattern, no client validation.
- **Writes:** read-only until submit
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** Duplicate of the /admin/login field but with different attributes: this one sets autoComplete='current-password' and no autoFocus, the login page one sets autoFocus and NO autoComplete (LoginForm.tsx:39-45). Password managers behave differently on the two surfaces.

#### `ui-footer-signin-submit` — Sign in (footer popover)

- **Kind:** form · **Destructive:** none
- **Reach:** Public footer > Admin > Operator sign-in popover
- **Does:** POSTs the password to /api/admin/login and, on success, pushes /admin.
- **Backing:** src/components/AdminControls.tsx:51-69 (handler), :119-121 (button)
- **Inputs:** password state only.
- **Writes:** cookie cd_admin, set by the login route
- **Guard:** N/A — credential submission.
- **Revalidates:** —
- **On failure:** Any non-ok response sets the same error text 'Wrong password.' (:114-118). A 500 from missing ADMIN_PASSWORD/SESSION_SECRET is indistinguishable from a typo.
- **Tests:** tests/e2e/public-visual.spec.ts:67
- **Quirks:** Disabled while busy or while the field is empty (:119). On success it clears the password, sets admin=true and hard-pushes '/admin' — it cannot return the operator to the page they were on, so signing in from a public page always costs your place.

#### `ui-footer-signin-cancel` — Cancel (footer popover)

- **Kind:** button · **Destructive:** none
- **Reach:** Public footer > Admin > Operator sign-in popover
- **Does:** Closes the popover.
- **Backing:** src/components/AdminControls.tsx:122-128
- **Inputs:** None.
- **Writes:** read-only
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** —
- **Quirks:** type='button' is load-bearing — it sits inside the sign-in <form>, so dropping the attribute turns Cancel into a second submit. It does not clear the typed password or the error state, so reopening the popover shows the previous failure.

#### `ui-login-page-password` — Password (/admin/login)

- **Kind:** text-input · **Destructive:** none
- **Reach:** /admin/login > Operator console > Sign in form
- **Does:** Collects the shared operator password.
- **Backing:** src/app/admin/login/LoginForm.tsx:37-46
- **Inputs:** type=password, autoFocus, no autoComplete, no maxLength, no validation.
- **Writes:** read-only until submit
- **Guard:** N/A
- **Revalidates:** —
- **On failure:** N/A
- **Tests:** tests/e2e/public-visual.spec.ts:67
- **Quirks:** autoFocus here and not in the footer twin; no autoComplete here and 'current-password' in the twin. Two inputs for one credential that must both survive the reorg or the redirect target of every requireAdmin() failure breaks.

#### `ui-login-page-submit` — Sign in (/admin/login)

- **Kind:** form · **Destructive:** none
- **Reach:** /admin/login > Operator console
- **Does:** POSTs the password to /api/admin/login and pushes /admin on success.
- **Backing:** src/app/admin/login/LoginForm.tsx:12-24 (handler), :52-54 (button)
- **Inputs:** password state only. No hidden returnTo field.
- **Writes:** cookie cd_admin, set by the login route
- **Guard:** N/A — credential submission.
- **Revalidates:** —
- **On failure:** Non-ok -> 'Wrong password.' (:47-51), same conflation of 401 and 500 as the footer form. A thrown fetch (offline) is UNCAUGHT here — unlike AdminControls, there is no try/catch, so the promise rejection leaves busy=false unset and the button stuck on 'Checking...'.
- **Tests:** tests/e2e/public-visual.spec.ts:67
- **Quirks:** Always lands on /admin regardless of where requireAdmin bounced you from — the destination is thrown away by adminGuard.ts:21, so the redesign cannot add returnTo without changing the guard too. Button label swaps to 'Checking...' while busy and is disabled on an empty field.

#### `ui-operator-signout-button` — Sign out

- **Kind:** button · **Destructive:** reversible
- **Reach:** Operator chrome > nav bar, after EXPORT CSV, on every OperatorShell page (/admin, /admin/compile, /scanner admin view)
- **Does:** Submits the signOutAdmin server action.
- **Backing:** src/components/dispatch/Chrome.tsx:201-205
- **Inputs:** None.
- **Writes:** cookie cd_admin cleared
- **Guard:** None on the control; the action it calls is also unguarded (see action-sign-out).
- **Revalidates:** —
- **On failure:** No failure path — always redirects to /admin/login.
- **Tests:** —
- **Quirks:** Wrapped in `<form style={{display:'contents'}}>` so it inherits nav layout — removing display:contents breaks the nav row alignment. It is styled as a nav link (dispatch-nav__link--signout) but is a submit button, so it is the only nav item that is not a link and the only one that cannot be middle-clicked or opened in a new tab.

#### `ui-operator-nav` — REPORT REVIEW / SCANNER MONITOR / COMPILE DOSSIER / EXPORT CSV

- **Kind:** nav · **Destructive:** none
- **Reach:** Operator chrome > nav bar, rendered by OperatorShell on every authenticated page
- **Does:** The complete set of operator destinations. Order is fixed in one array.
- **Backing:** src/components/dispatch/Chrome.tsx:154-159 (OPERATOR_NAV), rendered :185-200
- **Inputs:** `active` prop marks aria-current: 'review' (admin/page.tsx:55), 'compile' (compile/page.tsx:44), 'scanner' (scanner/page.tsx:46).
- **Writes:** read-only
- **Guard:** Indirect: OperatorShell only renders on pages that already passed requireAdmin() — or, for /scanner, passed isAdmin(). Rendering this chrome is itself the visual claim 'signed in' (nameplate copy at Chrome.tsx:176).
- **Revalidates:** —
- **On failure:** If a page rendered OperatorShell without a guard, the nav would advertise admin routes to anonymous visitors. Nothing enforces that pairing.
- **Tests:** tests/metadata.test.ts
- **Quirks:** The 'export' key is deliberately not an OperatorNavKey and is rendered as a plain <a> rather than a Link (:186-190) because it is a download, so it can never show aria-current. SCANNER MONITOR points at /scanner, outside the /admin prefix. The footer text 'Sessions expire 12 hours after sign-in' (:211) hardcodes a value that actually lives in session.ts:4 — if the TTL changes, this copy lies.

**Surface notes.** HOW A SESSION WORKS, END TO END  Established: only by POST /api/admin/login (src/app/api/admin/login/route.ts:5). Body is JSON {password}. There is no username and no user record — one shared password in ADMIN_PASSWORD. On success the route mints a token and sets a cookie (route.ts:19-25).  Represented: cookie name "cd_admin" (src/lib/session.ts:3). Value is `${expiresAt}.${sig}` where expiresAt is Date.now()+ttl in ms and sig is base64url HMAC-SHA256 over the expiresAt string alone, keyed by SESSION_SECRET (session.ts:6-10). The token carries NO identity, no nonce, no version, no jti. Cookie attributes: httpOnly true, secure only when NODE_ENV === "production", sameSite "lax", path "/", maxAge 43200 s (route.ts:20-24). TTL inside the token defaults to 12 h (session.ts:4, DEFAULT_TTL_MS = 12*60*60*1000), matching the cookie maxAge and the footer copy "Sessions expire 12 hours after sign-in" (src/components/dispatch/Chrome.tsx:211).  Verified: verifySessionToken (session.ts:12-24) — must be present, must split into exactly 2 parts on ".", expiresAt must match /^\d+$/, HMAC recomputed and compared with a length check then timingSafeEqual, then Number(expiresAt) > Date.now(). Callers reach it only through isAdmin() (adminGuard.ts:13-18), which first resolves the secret and reads the cookie.  Destroyed: two independent paths, neither of which revokes anything server-side. (a) server action signOutAdmin (src/app/admin/actions.ts:39-43) sets cd_admin to "" with maxAge 0 then redirect("/admin/login"); (b) DELETE /api/admin/login (route.ts:29-33) sets the same empty cookie and returns {ok:true}. Because the token is a pure function of (expiry, secret) with no server-side record, a captured cookie stays valid until its embedded expiry even after "sign out". The only real revocation is rotating SESSION_SECRET.  MIDDLEWARE: CONFIRMED ABSENT. There is no src/middleware.ts, no middleware.ts anywhere in the app (glob **/middleware.{ts,js,tsx,mjs} matches only node_modules Next build templates). There is also no src/app/admin/layout.tsx. Protection is therefore strictly per-route, opt-in, and re-declared in every file. Nothing structurally prevents a new file under src/app/admin or src/app/api/admin from shipping with no guard at all — this is the single biggest parity risk in a reorganization.  ENVIRONMENT GATING - SESSION_SECRET — asymmetric handling. adminGuard.adminSessionSecret (adminGuard.ts:7-11) is deliberately non-throwing: missing, whitespace-only, or the literal strings "" or '' all resolve to null, so isAdmin() returns false and requireAdmin() bounces everyone to /admin/login. Fails closed. The login route instead calls requiredEnv("SESSION_SECRET") (env.ts:136-143), which THROWS, so POST /api/admin/login answers 500 rather than 401. Net effect in production with SESSION_SECRET unset: admin is fully locked out and sign-in 500s. - ADMIN_PASSWORD — read only at login (route.ts:13) via requiredEnv; unset means every sign-in attempt 500s. Fails closed. - CRON_SECRET — cron routes fail closed with 500 {"error":"cron secret missing"} (keepalive route.ts:13-15, source-preview route.ts:14-16) before any auth comparison. - VERCEL_ENV — "preview" turns on previewGuard. - NODE_ENV — only decides the cookie `secure` flag (login route.ts:21).  previewGuard VS adminGuard They answer different questions and are not interchangeable. adminGuard is identity-based ("is this browser the operator?"); previewGuard is deployment-based ("is this a Vercel preview deploy?", previewGuard.ts:3-5, VERCEL_ENV === "preview"). previewGuard has two shapes: assertProductionWriteAllowed() throws Error("preview writes disabled") (previewGuard.ts:7-9) and is used by every guarded server action immediately AFTER requireAdmin; isVercelPreview() is used directly by route handlers so they can return a clean 403 {"error":"preview_writes_disabled"} instead of throwing (scan route.ts:13, reports route.ts:16, confirmations route.ts:35, keepalive route.ts:19). Ordering is consistent and load-bearing: identity first, environment second, so a preview visitor still sees a redirect rather than a leaked error. Both adminGuard.ts:1 and previewGuard.ts:1 carry `import "server-only"`; session.ts and crypto.ts do NOT, so they can in principle be pulled into a client bundle.  CROSS-CUTTING COUPLING THE REDESIGN MUST NOT BREAK SESSION_SECRET is not only the session key. It is also the scrypt salt for password comparison (session.ts:31-32) AND the salt for hashIp (crypto.ts:16), which is used for bug_reports.submitter_ip_hash rate limiting (src/app/api/reports/route.ts:40,47,78) and for the confirmation one-voice key p_voter_ip_hash (src/app/api/confirmations/route.ts:62,75). Rotating SESSION_SECRET to revoke a session silently re-keys every stored IP hash, resetting submission rate limits and confirmation dedupe. Nothing in the UI says this.  CRYPTO PRIMITIVES (src/lib/crypto.ts, no auth role but same file) normalizeTitle (3), reportFingerprint (11) and externalIdHash (20) are plain unsalted SHA-256 over concatenated fields — dedupe keys, not secrets. Only hashIp (16) takes a secret.  SURFACE OBSERVATIONS Two separate sign-in surfaces exist for the same credential: the full-page form at /admin/login (src/app/admin/login/LoginForm.tsx) and a popover in the PUBLIC footer of every non-/admin page (src/components/AdminControls.tsx, mounted at Chrome.tsx:80). They post to the same endpoint and both hard-redirect to /admin. AdminControls hides itself on any path starting with "/admin" (AdminControls.tsx:29) specifically so the two forms never coexist. The signed-out /admin/login page deliberately renders PublicShell (crimson chrome); amber OperatorShell chrome appears only after auth (login/page.tsx:4-8). robots.ts:9 disallows /admin* and /api* but NOT /scanner, which is correct only because /scanner has a real public view.  There is no rate limiting, lockout, backoff, or IP throttle on sign-in — only a fixed 750 ms sleep on the failure branch (login route.ts:14).

### Write-path libraries behind the admin/operator surface: src/lib/moderation.ts, lifecycle.ts, adminClusters.ts, saveImport.ts, csv.ts, revalidate.ts, cacheTags.ts, automation/settings.ts — plus every distinct database mutation the admin controls reach through them (server actions in src/app/admin/actions.ts and the Postgres RPCs/triggers those call).

_32 controls · partition `inv:write-path-libs`_

#### `lib-moderate-report` — moderateReport

- **Kind:** automatic · **Destructive:** none
- **Reach:** Not operator-invoked. Runs on every public POST /api/reports; its verdict is what fills (or bypasses) the /admin > Flagged for review queue.
- **Does:** Classifies one incoming player report as approved / pending / spam, picks a cluster by keyword overlap, and composes the neutral public excerpt.
- **Backing:** src/lib/moderation.ts:173
- **Inputs:** ModerationInput {issueTitle, description, category, platform, severity, frequency} plus ClusterRef[] read from issue_clusters(id, title, category) at src/app/api/reports/route.ts:58. No length validation of its own — the caller's zod reportSchema and a 500-char excerpt slice do that.
- **Writes:** read-only itself; caller writes bug_reports.moderation_status (route.ts:75); caller writes bug_reports.cluster_id (route.ts:76); caller writes approved_excerpts.report_id + approved_excerpts.excerpt_text (route.ts:88-90)
- **Guard:** NONE FOUND in this function. All gating is in the caller: isVercelPreview() -> 403 (route.ts:16), Turnstile captcha (route.ts:34), 5-reports-per-hour per submitter_ip_hash (route.ts:42-53).
- **Revalidates:** caller: revalidateTag("public-dashboard","max"); caller: revalidateTag("public-issues","max")
- **On failure:** Cannot throw on the AI path — aiScreen catches everything and returns null, leaving the deterministic verdict. If the issue_clusters read fails, route.ts:58 ignores the error and passes an empty cluster list, so clusterId silently becomes null.
- **Tests:** tests/moderation.test.ts; tests/reportsRoute.test.ts
- **Quirks:** A "spam" verdict never reaches any admin queue. It is written straight to bug_reports.moderation_status='spam' and surfaces only as the "Filtered as spam" number on /admin (page.tsx:38,94). There is no admin control anywhere that lists, reviews, or un-spams those rows — a redesign that drops that stat tile removes the only evidence they exist. Also: the AI screen can only downgrade approved->pending; it can never reject or publish.

#### `lib-match-cluster` — matchCluster

- **Kind:** automatic · **Destructive:** none
- **Reach:** Inside moderateReport on public report intake; determines the cluster preselected in the /admin > Flagged for review cluster dropdown.
- **Does:** Picks the same-category cluster with the most shared >=3-char non-stopword keywords between the report text and the cluster title.
- **Backing:** src/lib/moderation.ts:90
- **Inputs:** ModerationInput + ClusterRef[]. Requires overlap >= 1 to match; ties resolve to whichever cluster appeared first in the list (strict > comparison at line 100).
- **Writes:** bug_reports.cluster_id (via caller, route.ts:76)
- **Guard:** NONE FOUND — pure function.
- **Revalidates:** —
- **On failure:** Returns null when no same-category cluster shares a keyword. Never throws.
- **Tests:** tests/moderation.test.ts
- **Quirks:** Ordering matters: cluster list order comes from an unordered `select` at route.ts:58, so tie-breaking is effectively arbitrary and can change between deploys. STOP_WORDS (moderation.ts:65-69) hard-codes 'crimson','desert','game','bug','patch' — renaming clusters to include those words silently weakens matching.

#### `lib-neutral-summary` — neutralSummary

- **Kind:** automatic · **Destructive:** none
- **Reach:** Inside moderateReport on public report intake; the string it returns becomes public text with no operator review step.
- **Does:** Builds the public-facing one-line excerpt purely from validated enums (platform label, category label, frequency, severity) — never the player's raw words.
- **Backing:** src/lib/moderation.ts:109
- **Inputs:** PLATFORM_LABELS[platform] (fallback "A"), CATEGORY_LABELS[category] lowercased (fallback: the raw category key), input.frequency, input.severity.
- **Writes:** approved_excerpts.excerpt_text (via caller, route.ts:90, sliced to 500 chars)
- **Guard:** NONE FOUND — pure function.
- **Revalidates:** —
- **On failure:** Cannot fail. Unknown platform degrades to the literal string "A player reports..."; unknown category degrades to the raw enum key.
- **Tests:** tests/moderation.test.ts
- **Quirks:** This is a PUBLIC-text generator with no operator approval step: an auto-approved report publishes this excerpt with no admin action at all. The admin's own excerpt field (page.tsx:149-154) writes a SECOND approved_excerpts row for the same report — it does not replace this one.

#### `lib-ai-screen` — aiScreen

- **Kind:** automatic · **Destructive:** none
- **Reach:** Inside moderateReport on public report intake. No operator control turns it on or off — it is driven purely by env vars.
- **Does:** Best-effort second opinion from a free OpenRouter model on whether the text is a genuine bug report and whether it contains personal data.
- **Backing:** src/lib/moderation.ts:120
- **Inputs:** OPENROUTER_API_KEY and OPENROUTER_FREE_MODEL env vars; POST to https://openrouter.ai/api/v1/chat/completions with temperature 0, max_tokens 80, 5000 ms AbortController timeout, description truncated to 1200 chars.
- **Writes:** read-only; influences bug_reports.moderation_status only by downgrading approved -> pending
- **Guard:** rejectPaidOpenRouterModel(model) (line 125) plus a hard cost check: readOpenRouterUsageCostUsd must return exactly 0 or the response is discarded (line 161).
- **Revalidates:** —
- **On failure:** Every failure path returns null and the deterministic verdict stands: missing key/model, paid model, non-2xx, non-zero cost, non-string content, JSON.parse throw, timeout, network error. Nothing is logged.
- **Tests:** tests/moderation.test.ts
- **Quirks:** Silent by design — there is no admin surface showing whether AI screening ran, succeeded, or is misconfigured. ModerationDecision.aiUsed is computed (line 200) and then discarded by the caller; it is never persisted or displayed. Also skipped entirely when PII was already detected (line 189).

#### `lib-spam-pii-predicates` — looksLikeSpam / hasPersonalData / containsPhoneNumber

- **Kind:** automatic · **Destructive:** none
- **Reach:** Inside moderateReport on public report intake; decides whether a report is auto-killed as spam or routed to /admin > Flagged for review.
- **Does:** Regex pre-screen: 4 spam patterns (gold/coin selling, casino/crypto/onlyfans, 3+ URLs, a 10x repeated char), 2 PII patterns (email, US SSN shape), and a deliberately narrow phone-shaped-token check.
- **Backing:** src/lib/moderation.ts:71 (looksLikeSpam), :76 (hasPersonalData), :53 (containsPhoneNumber)
- **Inputs:** `${title} ${description}` concatenated. Phone check requires 7-15 digits in at most 4 groups, excludes dots and bare digit runs without a leading +, so driver versions like 546.33 and frame dumps do not false-flag.
- **Writes:** bug_reports.moderation_status='spam' (spam path, no cluster, no excerpt); bug_reports.moderation_status='pending' with reason flagged_personal_data (PII path)
- **Guard:** NONE FOUND — pure predicates.
- **Revalidates:** —
- **On failure:** Total functions; cannot throw. A false negative silently publishes; a false positive silently spams.
- **Tests:** tests/moderation.test.ts
- **Quirks:** ModerationDecision.reason (spam_pattern / flagged_personal_data / flagged_ai_relevance / flagged_ai_sensitive / auto_approved) is computed and then thrown away — the caller at route.ts:73-79 never persists it. The /admin queue therefore cannot tell the operator WHY a report was flagged, even though the reason exists. Empty-string title/description still concatenate to " " and pass cleanly.

#### `lib-compute-cluster-lifecycle` — computeClusterLifecycle / computeUnlockedLifecycle

- **Kind:** automatic · **Destructive:** none
- **Reach:** Not operator-invoked. Runs once per public cluster inside every automation lifecycle pass; its output is what the /admin > Lifecycle exceptions disclosure lists.
- **Does:** Decides a cluster's stored fix_status, the fix-claim clock, and whether the row needs a human, honouring an existing admin lock.
- **Backing:** src/lib/lifecycle.ts:98 (entry), src/lib/lifecycle.ts:66 (unlocked path)
- **Inputs:** ClusterLifecycleInput {currentStatus, fixClaimedAt, fixClaimedPatchVersion, currentPatchVersion, adminOverride, now, claimDecision}. claimDecision.matchKind is one of llm_sure \| llm_unsure \| keyword_proposal \| none.
- **Writes:** read-only; its result is written by writeLifecycleResult into issue_clusters.fix_status, .fix_claimed_at, .fix_claimed_patch_version, .lifecycle_reason
- **Guard:** NONE FOUND — pure function. adminOverride is an input, not an auth check.
- **Revalidates:** —
- **On failure:** Cannot throw. An unrecognised currentStatus normalizes to "reported" (lifecycle.ts:42-44).
- **Tests:** tests/lifecycle.test.ts; tests/automationRun.test.ts
- **Quirks:** When adminOverride is true it still runs the whole unlocked computation to produce the "System would show: X" sentence (line 101-103) — so the shadow system state exists but is only ever exposed as prose inside issue_clusters.lifecycle_reason, never as a field. There is no time-based exit from fix_claimed: only player answers move the displayed state (comment at line 73-74). Claim clocks from a different or null patch version are deliberately dropped, so a version rollover silently clears every claim clock.

#### `lib-lifecycle-labels` — LIFECYCLE_LABELS / ADMIN_OVERRIDE_LABEL

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions — both the status badge (page.tsx:193) and the Lock dropdown option text (page.tsx:205).
- **Does:** Maps the five FixStatus enum values to operator-facing prose, and names the locked state.
- **Backing:** src/lib/lifecycle.ts:6 (labels), src/lib/lifecycle.ts:14 (override label)
- **Inputs:** reported -> "Open", acknowledged -> "Acknowledged", fix_claimed -> "Fix claimed — unverified", verified_fixed -> "Marked fixed by maintainer", persists -> "Still happening"; ADMIN_OVERRIDE_LABEL = "Locked by you".
- **Writes:** issue_clusters.lifecycle_reason — the label string is interpolated verbatim into stored prose at src/app/admin/actions.ts:185 (`Locked by you. Manual status set to ${label}.`) and at src/lib/lifecycle.ts:103
- **Guard:** NONE FOUND — constant map.
- **Revalidates:** —
- **On failure:** actions.ts:175 falls back to fixStatus.replace(/_/g," ") if the key is missing; page.tsx:193 falls back to the raw enum value.
- **Tests:** tests/lifecycle.test.ts
- **Quirks:** These labels are not display-only — editing a label string changes text ALREADY WRITTEN into issue_clusters.lifecycle_reason on future writes, so the database ends up holding a mix of old and new wording with no migration. 'acknowledged' is a documented dead state: no rule produces it and LOCKABLE_STATUSES (page.tsx:22) deliberately omits it, but the label must stay for legacy rows. The badge at page.tsx:191-193 shows the hardcoded string "MAINTAINER LOCK", NOT ADMIN_OVERRIDE_LABEL — two different words for the same state.

#### `lib-read-admin-clusters` — readAdminClusters

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every load of /admin. Feeds three sections at once: the Flagged-for-review cluster dropdown, the Lifecycle exceptions ledger, and the Visibility overrides ledger.
- **Does:** Requests issue_clusters rows with no filter or explicit app limit, ordered by title, with a legacy-column fallback. Both projections are single unpaginated reads, so neither proves every row was returned beyond the hosted service cap.
- **Backing:** src/lib/adminClusters.ts:16
- **Inputs:** Service-role Supabase client. Primary select: id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, admin_visibility_reason, admin_visibility_changed_at, is_public. Ordered by title only, with no id tie-breaker, range pagination, or exact count.
- **Writes:** read-only
- **Guard:** None of its own; the page calls requireAdmin() first (src/app/admin/page.tsx:25).
- **Revalidates:** —
- **On failure:** On error it inspects the message: if and only if admin_visibility_reason or admin_visibility_changed_at is the missing column, it retries the legacy 7-column select and synthesizes both audit fields as null. Any other error throws `admin clusters read failed: <msg>` and the whole /admin page fails — deliberately, so a permission error never renders as an empty ledger (tests/adminClusters.test.ts:54).
- **Tests:** tests/adminClusters.test.ts; tests/queriesAdminCompatibility.test.ts
- **Quirks:** The legacy fallback makes admin_visibility_reason/admin_visibility_changed_at null, and the UI then renders "Existing override created before reason tracking." and "Change time unavailable" (page.tsx:263,267) — text that means 'migration not applied here', not 'old row'. A redesign that drops those fallback strings loses the only signal that a preview environment is running pre-migration. Also: three separate /admin sections are derived from this ONE read by client-side filtering (page.tsx:46-52) — forcedRows, autoRows and exceptionRows all share the same potentially truncated array. A forced row omitted after the service cap loses the only rendered Reset to automatic; an omitted engine-owned exception can undercount Needs you and render false green. Both current and legacy projections need stable title/id pagination.

#### `lib-analyze-save-import` — analyzeSaveImport / sanitizeSavePath

- **Kind:** automatic · **Destructive:** none
- **Reach:** NOT an admin control. Runs in the player's browser on /report > local save helper rail. Reaches the operator only through the data it puts into two report fields.
- **Does:** Parses locally-selected Crimson Desert files, extracts a graphics-settings summary, and builds a sanitized evidence note. Raw files are never uploaded.
- **Backing:** src/lib/saveImport.ts:90 (analyze), :21 (path sanitizer), :60 (settings parser)
- **Inputs:** SaveImportFile[] {name, relativePath, size, lastModified, text}. Only user_engine_option_save.xml is parsed for settings; only .save/.xml/.log/.txt files are listed, capped at 8. sanitizeSavePath strips everything before the last '/save/' and drops any path segment that is 5+ consecutive digits (account/user IDs).
- **Writes:** bug_reports.graphics_mode — only when the field is still empty (src/app/report/ReportForm.tsx:131-133); bug_reports.troubleshooting_tried — appended, only if the note is not already present (ReportForm.tsx:134-138)
- **Guard:** NONE FOUND — client-side only, and gated behind an explicit "Add to report" button (ReportForm.tsx:529) after a preview.
- **Revalidates:** —
- **On failure:** No recognized file yields a fixed sentence ("no recognized Crimson Desert settings or save files selected"), still with the privacy note. Malformed XML yields null settings, never a throw. Non-finite/<=0 lastModified renders "unknown date".
- **Tests:** tests/saveImport.test.ts
- **Quirks:** Two admin surfaces consume this indirectly and would break quietly if the format changed: the CSV export ships graphics_mode and troubleshooting_tried verbatim (src/app/api/admin/export/route.ts:21,23) while the /admin review card renders neither — the operator sees Repro, Hardware and Evidence only (page.tsx:122-138), so the sanitized save summary is invisible in review but present in the export. The 5+-digit segment filter is the only PII protection on the path string; loosening it leaks account IDs into an operator CSV.

#### `lib-build-csv` — buildCsv / csvEscape

- **Kind:** automatic · **Destructive:** none
- **Reach:** Operator nav > EXPORT CSV (src/components/dispatch/Chrome.tsx:158) — a plain <a>, not a Link, so it triggers a browser download.
- **Does:** Serializes report rows to RFC-4180-ish CSV: header line, CRLF row separators, quotes only when the value contains a comma, quote, CR or LF.
- **Backing:** src/lib/csv.ts:6 (buildCsv), src/lib/csv.ts:1 (csvEscape)
- **Inputs:** rows: Record<string, unknown>[] and an explicit column list. null/undefined become empty string; everything else is String()-coerced; embedded quotes are doubled.
- **Writes:** read-only — produces a downloadable text/csv body
- **Guard:** NONE FOUND in the library. The route checks isAdmin() and returns 401 otherwise (src/app/api/admin/export/route.ts:32).
- **Revalidates:** —
- **On failure:** Cannot throw. A column missing from a row silently becomes an empty cell — there is no shape validation between COLUMNS and the selected rows.
- **Tests:** tests/csv.test.ts
- **Quirks:** No CSV-injection guard: a value beginning with =, +, - or @ is written unescaped and will execute as a formula in Excel/Sheets. Player-controlled free text (issue_title, description, repro_steps, troubleshooting_tried) flows straight through. Also no BOM, so non-ASCII opens mangled in Excel on Windows.

#### `route-admin-export-csv` — GET /api/admin/export

- **Kind:** automatic · **Destructive:** none
- **Reach:** Operator nav > EXPORT CSV, present on every operator page via OperatorShell (Chrome.tsx:154-159).
- **Does:** Attempts to dump every bug_reports row, newest first, as a CSV attachment named cd-reports-YYYY-MM-DD.csv. The current one-page read can omit older rows at the hosted service cap.
- **Backing:** src/app/api/admin/export/route.ts:31
- **Inputs:** No parameters. Fixed 22-column list (route.ts:6-29): id, created_at, patch_version, platform, category, severity, frequency, issue_title, description, repro_steps, expected_behavior, actual_behavior, location_quest, hardware_specs, graphics_mode, driver_os, troubleshooting_tried, pers_id, official_report_submitted, evidence_url, moderation_status, cluster_id. No explicit app limit, no pagination, and no date filter; the service row cap still applies.
- **Writes:** read-only
- **Guard:** isAdmin() -> 401 JSON if false (route.ts:32). Cookie-based: HMAC-signed cd_admin token with a 12-hour TTL (src/lib/session.ts:4,12).
- **Revalidates:** —
- **On failure:** Query error returns {error:"query_failed"} with status 500 — the browser shows raw JSON in a tab rather than a download. No empty-state handling: zero rows still downloads a header-only file.
- **Tests:** NONE FOUND — no test file covers this route; tests/csv.test.ts covers the serializer only
- **Quirks:** This is the only place pers_id and submitter-adjacent free text leave the system in bulk, and every returned moderation state can leave, including spam and rejected. It deliberately does NOT include submitter_ip_hash or duplicate_fingerprint. Because it is an <a href> and not a form, it has no confirmation, no pending state, and no assertProductionWriteAllowed check — it works on Vercel preview where every write is blocked. Stable created_at/id pagination is required before the UI may promise every stored report.

#### `lib-revalidate-public-surfaces` — revalidatePublicSurfaces (+ PUBLIC_DASHBOARD_TAG / PUBLIC_ISSUES_TAG / CURRENT_PATCH_TAG)

- **Kind:** automatic · **Destructive:** none
- **Reach:** Fires automatically at the end of nearly every operator write — every server action in src/app/admin/actions.ts except signOutAdmin and compileDossier, plus POST /api/admin/scan (manual mode) and GET /api/admin/scan/status.
- **Does:** The single canonical 'refresh everything the public sees' call: expires three cache tags at max profile and four paths.
- **Backing:** src/lib/revalidate.ts:10; tag constants at src/lib/cacheTags.ts:1-3
- **Inputs:** No parameters. Tags: public-dashboard, public-issues, current-patch (all with "max"). Paths: /, /issues, /report, /scanner.
- **Writes:** read-only — Next.js cache invalidation only
- **Guard:** NONE FOUND. It is called after the caller's own requireAdmin()/isAdmin() check, and it is never the security boundary.
- **Revalidates:** tag public-dashboard; tag public-issues; tag current-patch; path /; path /issues; path /report; path /scanner
- **On failure:** Wrapped in a try/catch that swallows everything (revalidate.ts:19-21) with the comment 'pages self-revalidate within 5 minutes regardless'. An operator action therefore reports success even when the public pages did not refresh.
- **Tests:** tests/adminActions.test.ts:415-417,469-471,503-505; tests/adminScanRoute.test.ts:168-173
- **Quirks:** Deliberately identical for every caller because per-caller copies had already drifted (comment at revalidate.ts:6-9) — splitting it back up during a redesign re-opens that bug. Asymmetry to preserve: the PUBLIC write paths do NOT use it — POST /api/reports (route.ts:108-109) and POST /api/confirmations (route.ts:82-83) each expire only public-dashboard + public-issues and no paths at all. Admin actions additionally call revalidatePath("/admin") and revalidatePath("/admin/source-monitor") on their own; /admin/source-monitor is now a bare redirect (src/app/admin/source-monitor/page.tsx:6), so that revalidation is dead. /scanner gets revalidated twice by most scanner actions (once directly, once inside this function).

#### `lib-get-automation-control-state` — getAutomationControlState

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on load of /scanner (admin view) to populate 'Scanner cadence and budget'; also on the public dashboard, the patch radar, and every cron/manual scan start.
- **Does:** Reads the single automation_settings row keyed 'scanner' and normalizes it into a complete ScannerPolicy plus updatedAt.
- **Backing:** src/lib/automation/settings.ts:126
- **Inputs:** select value, updated_at from automation_settings where key = 'scanner' limit 1.
- **Writes:** read-only
- **Guard:** NONE FOUND in the library — it uses the service-role client and has no auth check. Callers gate: requireAdmin() on the action path, isAdmin() on the API path, nothing on the public dashboard path (src/lib/queries.ts:899).
- **Revalidates:** —
- **On failure:** Throws `automation settings read failed: <msg>`. Callers differ sharply: src/lib/queries.ts:899 catches and degrades to the neutral {paused:false, updatedAt:null} so the public board still renders; src/lib/queries.ts:1212 and :1596 do NOT catch; src/app/api/cron/keepalive/route.ts:32 does not catch. A missing row is not an error — normalizeScannerPolicy fills every default.
- **Tests:** tests/automationSettings.test.ts; tests/adminScanRoute.test.ts; tests/queries.test.ts
- **Quirks:** There is exactly one settings row for the whole system — 'scanner' is hardcoded (settings.ts:53), so there is no per-lane or per-environment policy. The degraded fallback at queries.ts:900-901 reports paused:false, meaning a settings-read outage renders the scanner as RUNNING on the public board when its real state is unknown.

#### `lib-normalize-scanner-policy` — normalizeScannerPolicy

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on both the read and the write side of /scanner > Scanner cadence and budget — it is the validation boundary for that form.
- **Does:** Coerces arbitrary input into a valid ScannerPolicy, silently clamping or substituting anything out of range.
- **Backing:** src/lib/automation/settings.ts:94
- **Inputs:** paused: true only for boolean true or the string "true". minIntervalMinutes: must be one of 60\|120\|360\|1440 else 60. scheduledSearchCreditsPerRun: must be 1\|2\|3 else 1. monthlyTavilyCreditCap: floored, clamped to 0..1000, negatives/NaN -> 1000. monthlyLlmUsdCap: clamped to 0..MAX_MONTHLY_LLM_USD_CAP (2, src/lib/automation/budget.ts:38), negatives/NaN -> 2. modelPreset: must equal "deepseek_v4_flash" else forced to it.
- **Writes:** automation_settings.value (jsonb) — the normalized object is what setScannerPolicy persists
- **Guard:** NONE FOUND — pure function, but it IS the only input validation for the settings form.
- **Revalidates:** —
- **On failure:** Never throws and never reports. Every invalid value is silently replaced by a default.
- **Tests:** tests/automationSettings.test.ts
- **Quirks:** Silent clamping with no operator feedback: typing 5000 in Monthly search cap saves 1000, typing 50 in Monthly LLM cap saves 2, typing an unsupported cadence saves 60. The form re-renders with the clamped value and no message, so the operator can believe a limit was raised when it was not. modelPreset is a single-value 'enum' — the hidden input at AdminScannerView.tsx:603 is the only writer and any other value is coerced back, making it a dead dimension in the data model.

#### `lib-scanner-policy-from-form-data` — scannerPolicyFromFormData

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** Runs on submit of /scanner > Scanner cadence and budget > Save settings.
- **Does:** Maps the form's fields onto a ScannerPolicy, collapsing the 'How often' select's Paused option into the boolean paused flag.
- **Backing:** src/lib/automation/settings.ts:114
- **Inputs:** Reads cadence, paused, minIntervalMinutes, scheduledSearchCreditsPerRun, monthlyTavilyCreditCap, monthlyLlmUsdCap, modelPreset from FormData, then hands everything to normalizeScannerPolicy.
- **Writes:** automation_settings.value (jsonb), via setScannerPolicy
- **Guard:** NONE FOUND — pure mapping. The server action wrapper does requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** —
- **On failure:** Cannot throw. Missing fields become null and normalizeScannerPolicy defaults them — so a partially-submitted form silently RESETS omitted settings to defaults rather than preserving them.
- **Tests:** tests/automationSettings.test.ts; tests/adminScannerView.test.ts
- **Quirks:** Two coupled controls a redesign will break. (1) The hidden input name="minIntervalMinutes" (AdminScannerView.tsx:602) is only consulted when cadence === "paused" (settings.ts:118) — it exists solely to preserve the previous interval while paused. Delete it and pausing silently resets cadence to hourly. (2) Selecting any numeric cadence sets paused to "false" (settings.ts:117) — so the same select both sets the interval AND unpauses. There is no separate pause control on this form; 'Paused' is the fifth option in a dropdown labelled 'How often'.

#### `lib-set-scanner-policy` — setScannerPolicy (library)

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** Called by the setScannerPolicy server action on /scanner > Scanner cadence and budget > Save settings.
- **Does:** Upserts the whole normalized policy object into the single automation_settings row.
- **Backing:** src/lib/automation/settings.ts:143
- **Inputs:** {key:'scanner', value: normalizeScannerPolicy(policy), updated_at: new Date().toISOString()} with onConflict 'key'.
- **Writes:** automation_settings.key; automation_settings.value (jsonb, whole-object overwrite); automation_settings.updated_at
- **Guard:** NONE FOUND in the library. Table-level: RLS deny_all_public_access for anon/authenticated, grants only to service_role (supabase/migrations/20260705201242_automation_settings.sql:11-19).
- **Revalidates:** —
- **On failure:** Throws `automation settings write failed: <msg>`; the server action does not catch, so Next.js surfaces the error boundary and NO revalidation runs (actions.ts:460-467 is sequential).
- **Tests:** tests/automationSettings.test.ts
- **Quirks:** DESTRUCTIVE OVERWRITE with no history: the entire jsonb value is replaced and the previous policy is gone. updated_at records when, but there is no who and no previous value anywhere — this is the clearest audit gap in the admin area. Note updated_at is written by the application, not by a database default or trigger, so a direct SQL edit would leave it stale.

#### `lib-set-automation-paused` — setAutomationPaused (library)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** Reachable only through the setAutomationPaused server action (src/app/admin/actions.ts:446), which has NO caller anywhere in src/.
- **Does:** Read-modify-write of just the paused flag: loads the current policy, spreads it, overrides paused, upserts.
- **Backing:** src/lib/automation/settings.ts:155
- **Inputs:** boolean paused.
- **Writes:** automation_settings.value (jsonb, whole-object overwrite); automation_settings.updated_at
- **Guard:** NONE FOUND in the library; the action wrapper does requireAdmin() + assertProductionWriteAllowed().
- **Revalidates:** via the action: path /admin, path /scanner, path /admin/source-monitor, then revalidatePublicSurfaces()
- **On failure:** Propagates either the read error (`automation settings read failed`) or the write error (`automation settings write failed`).
- **Tests:** tests/automationSettings.test.ts
- **Quirks:** DEAD CONTROL. Grep across src/ finds no form, button or route that calls the setAutomationPaused server action — pausing is done today only through the 'Paused' option of the cadence select. The library function is still exercised by tests, so it will not fail typecheck if the redesign drops the action. It also spreads AutomationControlState (which carries updatedAt) into setScannerPolicy; updatedAt is harmlessly dropped by normalizeScannerPolicy, but the read-modify-write is non-atomic — a concurrent Save settings can be silently clobbered.

#### `action-moderate-report` — moderateReport (server action)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > Approve / Reject / Spam buttons (page.tsx:155-163), one form per flagged report.
- **Does:** Sets one report's moderation state and cluster, optionally stores the operator's public excerpt, then refreshes visibility for both the old and new cluster.
- **Backing:** src/app/admin/actions.ts:111
- **Inputs:** FormData: id (required), decision (must be approved\|rejected\|spam, actions.ts:37), cluster_id (empty string -> null), excerpt (trimmed, sliced to 500). Reads the existing row first for moderation_status + cluster_id (actions.ts:121-131).
- **Writes:** bug_reports.moderation_status; bug_reports.cluster_id; approved_excerpts.report_id + approved_excerpts.excerpt_text (INSERT, approved + non-empty excerpt only)
- **Guard:** await requireAdmin() (actions.ts:112) — redirects to /admin/login; then assertProductionWriteAllowed() throws on Vercel preview (actions.ts:113).
- **Revalidates:** path /admin; revalidatePublicSurfaces()
- **On failure:** Missing id or bad decision -> throw "bad input". Row not found -> throw "report not found". Update error or excerpt-insert error -> throw (the excerpt failure happens AFTER the status is already committed, so the report is moderated but has no excerpt). refreshClusterVisibility failures are caught and only console.error'd (actions.ts:158-160) — the operator sees success.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** The excerpt input is APPEND-ONLY: submitting Approve twice on the same report inserts two approved_excerpts rows, and there is no admin surface to view, edit or delete an excerpt. An auto-approved report already has a machine-written excerpt (from neutralSummary), so an operator excerpt adds a second row rather than replacing it. Ordering matters: the excerpt insert must land before refreshClusterVisibility so verified-report stats include it (comment at actions.ts:154-156). Both the old and the new cluster are refreshed when an approval moves.

#### `action-set-cluster-fix-status` — setClusterFixStatus

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** /admin > Lifecycle exceptions disclosure > per-cluster status select + "Lock" button (page.tsx:200-212).
- **Does:** Takes manual ownership of a cluster's lifecycle: writes the chosen status, synthesizes or clears the fix-claim clock, sets the admin lock, and stores an explanatory sentence.
- **Backing:** src/app/admin/actions.ts:167
- **Inputs:** FormData: cluster_id, fix_status (must be in FIX_STATUSES). The dropdown offers only reported \| fix_claimed \| verified_fixed \| persists (LOCKABLE_STATUSES, page.tsx:22) — 'acknowledged' is a valid enum the UI deliberately hides but the action still accepts.
- **Writes:** issue_clusters.fix_status; issue_clusters.fix_claimed_at (now() for fix_claimed/verified_fixed/persists, else null); issue_clusters.fix_claimed_patch_version (current patch for those three, else null); issue_clusters.admin_override = true; issue_clusters.lifecycle_reason
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:168-169).
- **Revalidates:** path /admin; revalidatePublicSurfaces()
- **On failure:** Bad input -> throw "bad input". A current-patch database read error does not propagate: getCurrentPatchMetadata silently returns the hardcoded fallback version, which claim-bearing statuses then stamp as `fix_claimed_patch_version`. Update error -> throw error.message; no revalidation runs.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** OVERWRITE, NO HISTORY: the prior fix_status, fix_claimed_at and fix_claimed_patch_version are gone. Setting a claim-bearing status FABRICATES a fix-claim clock timestamped now() and attributed only to the current patch version, indistinguishable in the table from a real Pearl Abyss claim — the only marker is admin_override=true. Because source provenance is not stored and patch-read errors fall back, this can stamp a manual or hardcoded fallback version. Phase 4 must reject fallback provenance for claim-bearing statuses while retaining the non-claim Open lock. Label mismatch: the button says 'Lock' but the select carries the value; submitting without changing the select re-locks at the current status and rewrites the timestamps.

#### `action-clear-cluster-fix-status-override` — clearClusterFixStatusOverride

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** /admin > Lifecycle exceptions disclosure > "Clear" button, rendered only when cluster.admin_override is true (page.tsx:213-220).
- **Does:** Hands a cluster back to the automation engine by dropping the lock, the stored reason, and the synthesized claim clock.
- **Backing:** src/app/admin/actions.ts:234
- **Inputs:** FormData: cluster_id only.
- **Writes:** issue_clusters.admin_override = false; issue_clusters.lifecycle_reason = null; issue_clusters.fix_claimed_at = null; issue_clusters.fix_claimed_patch_version = null
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:235-236).
- **Revalidates:** path /admin; revalidatePublicSurfaces()
- **On failure:** Missing cluster_id -> throw "bad input". Update error -> throw error.message.
- **Tests:** tests/adminActions.test.ts
- **Quirks:** It does NOT reset fix_status. The manually-chosen status stays in the row until the next automation lifecycle pass recomputes it (writeLifecycleResult, src/lib/automation/run.ts:1351) — so between Clear and the next scan the cluster shows the operator's value with no lock badge and no reason. Conditional visibility: the button only exists while admin_override is true, so it disappears from the ledger the moment it is used. Comment at actions.ts:246-248 documents the intent — auto must rebuild the claim clock only from a real, confidently-matched Pearl Abyss claim.

#### `rpc-set-cluster-visibility-override` — set_cluster_visibility_override (RPC, called by setClusterVisibilityOverride)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides disclosure — "Reset to automatic" on each forced card (page.tsx:255-261) and the force controls inside VisibilityOverrideBrowser (page.tsx:272).
- **Does:** Break-glass visibility: forces a cluster public or hidden, or returns it to engine control, while preserving the engine's own baseline underneath.
- **Backing:** action src/app/admin/actions.ts:197; RPC supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:424
- **Inputs:** FormData: cluster_id, visibility (auto\|force_public\|force_hidden), reason (trimmed, sliced to 500), confirm_override (must be the string "true"). Non-auto requires reason.length >= 3 AND confirmed (actions.ts:205); the RPC re-validates reason length 3..500 server-side.
- **Writes:** issue_clusters.admin_visibility_override; issue_clusters.admin_visibility_reason; issue_clusters.admin_visibility_changed_at; issue_clusters.is_public; issue_clusters.auto_public; issue_clusters.visibility_restore_is_public; issue_clusters.visibility_restore_auto_public; issue_clusters.visibility_revision (+1); source_signals.public_status='hidden', .promoted_at=null, .promotion_reason='admin_force_hidden' for every signal in the cluster (force_hidden only)
- **Guard:** requireAdmin() + assertProductionWriteAllowed(). RPC is security invoker with search_path='' and EXECUTE revoked from public/anon/authenticated, granted only to service_role (migration:485-486). Table constraint issue_clusters_visibility_override_explained (migration:410-420) makes an override without a reason and timestamp impossible.
- **Revalidates:** path /admin; revalidatePublicSurfaces()
- **On failure:** Bad visibility value or missing reason/confirmation -> throw before any write. If PostgREST cannot resolve the 3-arg signature it retries the legacy 2-arg form (actions.ts:214-224) — real DB errors still surface. Cluster not found -> P0002. The refreshClusterVisibility follow-up is skipped for force_hidden and its failure still lets revalidation run because it sits in a try/finally (actions.ts:226-231).
- **Tests:** tests/adminActions.test.ts; tests/visibilityMigration.test.ts
- **Quirks:** THIS IS THE CASCADE INTO PUBLIC VISIBILITY: issue_clusters.is_public is the field the public board reads, and force_public/force_hidden set it directly and immediately. Two-layer state a redesign must not flatten: is_public/auto_public are the EFFECTIVE values while visibility_restore_is_public/visibility_restore_auto_public hold the engine baseline underneath, and clearing to auto restores from those. force_hidden also mass-hides every child source_signal — but returning to auto does NOT unhide them; only a later refresh recomputes them. admin_visibility_changed_at is a single mutable timestamp, not history: forcing a second time overwrites the first reason and time with no record.

#### `rpc-set-current-patch-override` — set_current_patch_override (RPC, called by setCurrentPatchOverride)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** /admin > Current patch override disclosure > "New current patch" text input + "Set current patch" button (page.tsx:292-312).
- **Does:** Break-glass: declares which patch version the whole site treats as current when the Pearl Abyss notice scraper stops matching.
- **Backing:** action src/app/admin/actions.ts:263; RPC supabase/migrations/20260710021010_atomic_current_patch_override.sql:1
- **Inputs:** FormData: patch_version, trimmed, validated by isValidPatchVersion in the action and re-validated in SQL against ^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$. The input carries pattern=PATCH_VERSION_SHAPE and required, so the browser blocks obvious junk first. observed_at is server-generated now().
- **Writes:** official_patch_notes.is_current = false on the previous current row; official_patch_notes.board_no = 'manual-<version>' (INSERT ... ON CONFLICT (board_no) DO UPDATE); official_patch_notes.title = 'Manual override: Patch <version>'; official_patch_notes.patch_version; official_patch_notes.official_url (fixed Pearl Abyss notice URL); official_patch_notes.published_at = null (forced null on both insert and update); official_patch_notes.summary = null (forced null on both insert and update); official_patch_notes.observed_at; official_patch_notes.is_current = true
- **Guard:** requireAdmin() + assertProductionWriteAllowed(). RPC security invoker, search_path='', EXECUTE revoked from public/anon/authenticated and granted only to service_role (migration:59-62). Serialized by pg_advisory_xact_lock on 'official_patch_notes_current' so the singleton current row cannot be lost mid-failure.
- **Revalidates:** path /admin; revalidatePublicSurfaces() — including tag current-patch, which is the one mutation that genuinely needs it
- **On failure:** Invalid version -> throw "bad input" before the DB is touched. RPC raises 'invalid patch version' / 'observed time is required'. The whole function is one transaction: if the insert fails, the demotion of the previous current row rolls back rather than leaving the site with no current patch (comment at migration:18-19).
- **Tests:** tests/adminActions.test.ts:822,865-866; tests/officialPatchAtomicMigration.test.ts
- **Quirks:** Self-reversing by design: the next successful scraper sync reclaims control by flipping is_current back (comment at actions.ts:259-261), so this override is silently temporary and no UI says when it will expire. The manual row deliberately carries null published_at and null summary. `rowToCurrent` currently erases that provenance by calling every database row official, so the badge says "Synced" and a fresh/null-publication manual row can satisfy official-patch burst scheduling. Phase 4 must derive and retain Manual provenance from the reserved board prefix and keep burst logic official-only. Losing the summary badge still removes the only place to expose that distinction.

#### `rpc-record-scanner-decision` — record_scanner_decision (RPC, called by recordScannerDecision)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** /scanner (admin view) > Scanner feedback desk — per-candidate and per-signal decision forms (src/components/scanner/ScannerFeedbackDesk.tsx via AdminScannerView.tsx:1).
- **Does:** Records one durable, auditable operator judgement on a scanner candidate or a retained signal, and creates the matching allow/block rule that teaches future discovery.
- **Backing:** action src/app/admin/actions.ts:470; RPC supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:74
- **Inputs:** FormData: id, target_kind (candidate\|signal), decision (relevant\|off_topic\|wrong_patch\|not_issue_report\|duplicate), reason (3..500 chars), scope (exact_url\|source_path\|source_domain), confirm_broad ("true"), expires_at (must parse and be in the future). Signals are forced to exact_url, may not be 'relevant', and may not be broad (actions.ts:488). Steam review signals are rejected outright (actions.ts:512-514).
- **Writes:** scanner_decisions: id, candidate_id, signal_id, target_url, target_url_hash, source_domain, decision, reason (actor defaults to 'admin', created_at defaults to now()); scanner_feedback_rules: id, decision_id, action ('allow' for relevant else 'block'), decision, scope_type, scope_value, reason, confirmed_at, expires_at; scanner_feedback_rules.revoked_at + .superseded_by_rule_id on any prior active rule with the same scope; automation_rejected_candidates.decision_id, .feedback_rule_id, .decided_at (candidate path); automation_rejected_candidates.rescued_at (set by the action at actions.ts:600 on the relevant path); source_signals.public_status='hidden', .promoted_at=null, .promotion_reason='operator_feedback_blocked' (signal path); issue_clusters.visibility_revision (+1) when a hidden signal belonged to a cluster
- **Guard:** requireAdmin() + assertProductionWriteAllowed(). RPC security invoker, search_path='', EXECUTE revoked from public/anon/authenticated, granted only to service_role (migration:293-303). Both tables are RLS-enabled with all grants revoked from anon/authenticated.
- **Revalidates:** path /admin; path /scanner; path /admin/source-monitor (dead — that page is a redirect); revalidatePublicSurfaces()
- **On failure:** Any validation miss -> throw "bad input" before the DB is touched. Candidate/signal not found -> P0002. For decision='relevant' the rescue runs FIRST (actions.ts:568-576) so a failed extraction cannot hide the candidate; a later decision-write failure leaves the persisted signal and a still-visible candidate for an idempotent retry. A missing RPC on the relevant path is tolerated (legacyRelevantRescue, actions.ts:591-595); on every other path it throws.
- **Tests:** tests/adminActions.test.ts; tests/scannerFeedback.test.ts; tests/scannerFeedbackMigration.test.ts; tests/scannerTrustRegression.test.ts
- **Quirks:** THIS IS THE ONLY AUDIT TRAIL IN THE ENTIRE ADMIN AREA. scanner_decisions rows are append-only and immutable (Undo sets undone_at, never deletes), with actor pinned to 'admin' by a CHECK — single-operator by construction, so it records what and when but not who. Ordering is load-bearing: two advisory locks are taken in a fixed order (global 20260709, then the feedback-scope hash) to keep visibility refreshes from interleaving. A new rule silently supersedes any earlier rule on the same scope. Broad scopes require confirm_broad in BOTH the action and the RPC; the table CHECK (scope_type='exact_url' or confirmed_at is not null) makes an unconfirmed broad rule unstorable.

#### `rpc-record-observation-decision` — record_observation_decision (RPC, called by rejectObservationAndTeach)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** /scanner (admin view) > the Wire/Asks reject-and-teach control (AdminScannerView.tsx:1).
- **Does:** One submit performs two separately recorded acts inside one transaction: hides a public Wire/Asks item with a reason, and blocks its URL or domain from future discovery.
- **Backing:** action src/app/admin/actions.ts:619; RPC supabase/migrations/20260724200000_observation_moderation.sql:24
- **Inputs:** FormData: id, decision (off_topic\|wrong_patch\|not_issue_report\|duplicate — 'relevant' is deliberately not accepted), reason (3..500), scope (exact_url\|source_domain only in the action; the RPC also permits source_path), confirm_broad ("true" required for non-exact scopes).
- **Writes:** patch_observations.is_public = false (guarded UPDATE ... where is_public = true); scanner_decisions: id, observation_id, target_url, target_url_hash, source_domain, decision, reason; scanner_feedback_rules: id, decision_id, action='block', decision, scope_type, scope_value, reason, confirmed_at, expires_at (always null here); scanner_feedback_rules.revoked_at + .superseded_by_rule_id on any prior active rule for the same scope
- **Guard:** requireAdmin() + assertProductionWriteAllowed(). RPC security invoker, search_path='', EXECUTE revoked from public/anon/authenticated and granted only to service_role (migration:355-358). Application-level re-check that the observation is still public (actions.ts:653-655) plus the same check inside the locked transaction.
- **Revalidates:** path /admin; path /scanner; path /admin/source-monitor (dead); revalidatePublicSurfaces()
- **On failure:** Bad input -> "bad input". Observation not found -> P0002. Already hidden -> raises 55000 'observation is already hidden — undo its existing decision before deciding again'. If the 20260724200000 migration is absent the action throws an explicit, human-readable message naming the migration (actions.ts:682-686) rather than silently appearing to moderate — deliberately different from every other missing-RPC path.
- **Tests:** tests/adminActions.test.ts; tests/observations.test.ts
- **Quirks:** The row_count check on the hide IS the concurrency guard (migration:93-101): one observation can never carry two active decisions, which is what keeps Undo restoring exactly one act. Scope asymmetry: the action allows only exact_url and source_domain, but the RPC also accepts source_path — a redesign that adds a source_path option to the UI would work at the database level and fail at the action. Unlike record_scanner_decision, this one always hides and always blocks; there is no allow decision, and Undo is the only restore path.

#### `rpc-undo-scanner-decision` — undo_scanner_decision (RPC, called by undoScannerDecision)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** /scanner (admin view) > Undo on a recorded decision, in both the feedback desk and the rules panel (AdminScannerView.tsx:1).
- **Does:** Reverses one operator decision without erasing it: marks it undone, revokes its rule, un-hides whatever it hid, and returns an unrescued candidate to the desk.
- **Backing:** action src/app/admin/actions.ts:708; RPC supabase/migrations/20260724200000_observation_moderation.sql:157 (supersedes the 20260722170106:234 version)
- **Inputs:** FormData: decision_id only.
- **Writes:** scanner_decisions.undone_at = coalesce(undone_at, now()); scanner_feedback_rules.revoked_at = coalesce(revoked_at, now()) for every rule of that decision; automation_rejected_candidates.decision_id = null, .feedback_rule_id = null, .decided_at = null — only where rescued_at is null; patch_observations.is_public = true (observation decisions); issue_clusters.visibility_revision (+1) when the undone decision touched a clustered signal
- **Guard:** requireAdmin() + assertProductionWriteAllowed(). RPC security invoker, search_path='', EXECUTE revoked from public/anon/authenticated, granted only to service_role.
- **Revalidates:** path /admin; path /scanner; path /admin/source-monitor (dead); revalidatePublicSurfaces()
- **On failure:** Missing id -> "bad input". RPC error -> `scanner decision undo failed: <msg>`. If the decision was already undone or does not exist the RPC returns undone=false and the action throws "scanner decision was already undone or not found" — so a double-click surfaces an error rather than silently no-op'ing. refreshClusterVisibility runs only when a cluster was affected and is NOT wrapped in try/catch here, unlike in moderateReport.
- **Tests:** tests/adminActions.test.ts; tests/scannerFeedback.test.ts; tests/scannerFeedbackMigration.test.ts
- **Quirks:** Undo does NOT un-hide a source_signal it hid — it only bumps visibility_revision and leaves the actual public_status to a later refresh, whereas an observation IS un-hidden directly. That asymmetry is easy to lose in a redesign. It also does not restore source_signals.promotion_reason from 'operator_feedback_blocked'. The 20260724200000 rewrite exists purely to fix a runtime bug: the earlier version spelled it pg_catalog.coalesce(...), which is a parse error because COALESCE is parser syntax — plpgsql parses lazily, so applying the original migration never surfaced it (migration header, lines 14-16). Do not re-introduce the qualified spelling.

#### `lib-write-lifecycle-result` — writeLifecycleResult

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** Not operator-invoked. Runs once per public cluster in every automation lifecycle pass; it is what populates the /admin > Lifecycle exceptions ledger with 'Needs review:' rows.
- **Does:** Persists the computeClusterLifecycle verdict, with a compare-and-set that refuses to overwrite anything an operator or a concurrent pass changed.
- **Backing:** src/lib/automation/run.ts:1351 (writer), :1398 (pass), :1314 (reads only is_public=true clusters)
- **Inputs:** The cluster row plus the computed lifecycle. Builds a minimal patch: only fields that actually differ are included.
- **Writes:** issue_clusters.lifecycle_reason (locked rows: reason only, guarded by .eq(admin_override,true)); issue_clusters.fix_status; issue_clusters.fix_claimed_at; issue_clusters.fix_claimed_patch_version; issue_clusters.lifecycle_reason (unlocked rows; set to the 'Needs review:' text only when needsHuman, otherwise cleared to null)
- **Guard:** NONE FOUND — internal to the automation run. Its protection is the optimistic where-clause: .eq(admin_override,false) plus equality on the pre-read fix_status, fix_claimed_at and fix_claimed_patch_version (run.ts:1382-1393).
- **Revalidates:** —
- **On failure:** Throws `lifecycle override reason update failed: <msg>` or the equivalent status-update error, which the caller propagates into the run's error list. A lost compare-and-set race writes zero rows and is not reported.
- **Tests:** tests/lifecycle.test.ts; tests/automationRun.test.ts; tests/claimMapping.test.ts
- **Quirks:** A locked cluster still gets its lifecycle_reason rewritten every pass — so the operator's own 'Locked by you. Manual status set to X.' sentence from setClusterFixStatus is REPLACED by 'Locked by you. System would show: Y.' on the next scan. Two different writers own the same column with different wording. Only is_public=true clusters are processed (run.ts:1317), so a force_hidden cluster's lifecycle silently freezes. lifecycle_reason is deliberately null for normal states — the /admin ledger's exception filter keys off the literal prefix 'Needs review:' (src/app/admin/page.tsx:49), so changing that string empties the ledger.

#### `rpc-apply-cluster-visibility-refresh` — apply_cluster_visibility_refresh (RPC, called by refreshClusterVisibility)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** Fires automatically after several operator actions: report moderation (both old and new cluster), non-hidden visibility overrides, relevant scanner decisions, and undos.
- **Does:** Atomically rewrites a cluster's evidence counts and every child signal's public status from a snapshot, rejecting the write if the world moved underneath it.
- **Backing:** src/lib/automation/run.ts:1886 (wrapper), :1863 (call); RPC supabase/migrations/20260710001212_visibility_refresh_revision.sql:162
- **Inputs:** p_cluster_id, p_expected_revision, p_cluster_patch (exactly the 7 keys signal_count, direct_report_count, verified_report_count, public_signal_count, last_signal_at, auto_public, is_public — extra or missing keys raise), p_signal_patches (array of exactly id, public_status, promoted_at, promotion_reason).
- **Writes:** source_signals.public_status, .promoted_at, .promotion_reason (batch); issue_clusters.signal_count; issue_clusters.direct_report_count; issue_clusters.verified_report_count; issue_clusters.public_signal_count; issue_clusters.last_signal_at; issue_clusters.auto_public; issue_clusters.is_public (override-aware: forced values win); issue_clusters.visibility_restore_auto_public; issue_clusters.visibility_restore_is_public; issue_clusters.visibility_revision (+1)
- **Guard:** NONE FOUND at the function level — it inherits whatever guarded the caller. RPC is security invoker with search_path='', EXECUTE revoked from public/anon/authenticated, granted only to service_role (migration:394-397). Correctness guards are heavy: strict jsonb shape validation, non-negative counts, public_signal_count must equal the actual public patches, no duplicate signal ids, and a cluster-membership check in both directions.
- **Revalidates:** —
- **On failure:** Returns false (no write) on a revision mismatch or a membership change; run.ts retries up to 3 attempts and then throws 'cluster visibility refresh conflicted repeatedly'. Callers differ: moderateReport catches and console.error's (actions.ts:158-160) so the operator still sees success; undoScannerDecision and recordScannerDecision do not catch.
- **Tests:** tests/visibilityMigration.test.ts; tests/automationRun.test.ts; tests/adminActions.test.ts
- **Quirks:** The p_cluster_patch.is_public it receives is the AUTOMATIC BASELINE, not the effective value — the RPC derives effective visibility from the override that is still current inside the transaction (migration:372-378). Passing the effective value here would make a forced state permanent. Equally: while an override is active, visibility_restore_* are kept live so the engine's opinion never goes stale under the lock. Advisory lock 20260709/1 must be taken before the cluster row lock; every visibility writer in the system joins that same order.

#### `trigger-sync-approved-report-visibility` — sync_approved_report_visibility (trigger on bug_reports)

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** Fires on its own inside the same transaction as any insert, moderation_status/cluster_id update, or delete of a bug_report — including the /admin > Approve button and every public submission.
- **Does:** Makes cluster visibility durable in the report transaction: one approved direct report is sufficient automatic evidence to publish its cluster.
- **Backing:** supabase/migrations/20260710001212_visibility_refresh_revision.sql:97 (function), :157-160 (trigger)
- **Inputs:** OLD/NEW moderation_status and cluster_id. Acts only when the approved cluster actually changes (old_approved_cluster is distinct from new_approved_cluster).
- **Writes:** issue_clusters.auto_public = true; issue_clusters.is_public = true, EXCEPT false when admin_visibility_override='force_hidden'; issue_clusters.visibility_restore_auto_public = true (only while an override is active); issue_clusters.visibility_restore_is_public = true (only while an override is active); issue_clusters.visibility_revision (+1) on both the old and the new cluster
- **Guard:** security invoker, search_path='', EXECUTE revoked from public/anon/authenticated. Statement-level lock triggers (migration:82-95) take the global visibility advisory lock before any report row lock, so the row trigger's issue_clusters write cannot deadlock against a refresh.
- **Revalidates:** —
- **On failure:** A trigger failure aborts the whole report write — an approval either fully lands with its visibility consequence or does not land at all. This is deliberate: refreshClusterVisibility afterwards is only a best-effort stats/source deepening (comment at src/app/admin/actions.ts:154-156).
- **Tests:** tests/visibilityMigration.test.ts; tests/adminActions.test.ts
- **Quirks:** THE SECOND CASCADE INTO PUBLIC VISIBILITY, and the invisible one: clicking Approve on /admin publishes a cluster to the public board with no visibility control anywhere in that form and no confirmation. It deliberately does NOT demote the old cluster when an approval moves away — other evidence may still qualify it — it only bumps visibility_revision to invalidate any in-flight calculation. force_hidden is respected: the hidden baseline advances without exposing the cluster.

#### `action-compile-dossier` — compileDossier

- **Kind:** automatic · **Destructive:** none
- **Reach:** Operator nav > COMPILE DOSSIER (/admin/compile) > the compile form (src/app/admin/compile/page.tsx:59).
- **Does:** Reads a tracker-wide, unfiltered returned-row evidence snapshot, builds a deterministic markdown dossier, optionally rewrites it with AI, stores the run, and redirects to it.
- **Backing:** src/app/admin/actions.ts:281
- **Inputs:** FormData: use_ai (checkbox, "on"). Reads returned rows from one unpaginated select each for approved bug_reports (category, platform, cluster_id, evidence_url, repro_steps, issue_title), issue_clusters (id, title, fix_status, confidence), and public source_signals ordered by observed_at desc; each can stop at the hosted service cap. It also reads approved_excerpts joined to bug_reports, newest first, limit 1000, and a head-only exact count of pending reports. Output caps: 15 repro notes, 30 evidence URLs.
- **Writes:** dossier_runs.markdown; dossier_runs.provider ('deterministic' or the AI provider name); dossier_runs.stats (jsonb: totalSignals, totalDirectReports, totalVerifiedReports, pendingCount)
- **Guard:** requireAdmin() + assertProductionWriteAllowed() (actions.ts:282-283).
- **Revalidates:** NONE — this is the only mutating admin action that calls neither revalidatePath nor revalidatePublicSurfaces
- **On failure:** Each evidence read failure throws a labelled `<label> read failed: <msg>` via throwReadError (actions.ts:83). Insert failure throws error.message. The current-patch read is different: database errors become hardcoded fallback metadata, so compile proceeds under that version. If AI is requested but features().ai is false or draftDossierWithAi returns null, it silently falls back to the deterministic text with provider='deterministic' — no message tells the operator the AI step was skipped. The AI fetch has no timeout, so a hung request may never reach fallback. On success it redirect()s to /admin/compile?run=<id>.
- **Tests:** tests/dossier.test.ts; tests/adminActions.test.ts
- **Quirks:** APPEND-ONLY: every compile inserts a new dossier_runs row and nothing ever deletes one; only the newest 10 are listed, while saved `?run=` URLs still open directly. approved_excerpts is read with limit 1000 and de-duplicated by report_id in application code (actions.ts:87-100), so past 1000 excerpts the verified-report counts silently under-report. It reads verified reports through a Supabase relational join (bug_reports(...)) that can come back as an object or an array depending on row shape — relatedReport() at actions.ts:79 exists solely to absorb that. AI "prose only" is currently prompt-only: any free response longer than 200 characters is persisted without checking headings, the eight-column table, facts, lists, URLs, statuses, confidence, or caveats. Dossier compile must reject fallback patch provenance and nonconforming/timed-out AI output before the Phase 4 target can call those boundaries safe.

#### `action-run-reddit-monitor` — runRedditMonitor

- **Kind:** automatic · **Destructive:** none
- **Reach:** NO CALLER IN src/. Formerly the /admin/source-monitor page, which is now a bare redirect to /scanner (src/app/admin/source-monitor/page.tsx:6).
- **Does:** Would fetch new posts from up to 5 subreddits, classify each, and upsert them as source signals.
- **Backing:** src/app/admin/actions.ts:398
- **Inputs:** FormData: subreddits (comma-separated, 'r/' prefix stripped, trimmed, capped at 5). Raw text is truncated to 8000 chars and given a 48-hour raw_expires_at.
- **Writes:** source_signals.source='reddit', .source_url, .external_id_hash, .summary, .extracted_facts, .category, .confidence, .observed_at, .raw_text, .raw_expires_at — upsert onConflict external_id_hash with ignoreDuplicates:true
- **Guard:** requireAdmin() + assertProductionWriteAllowed(), then `if (!features().reddit) throw new Error("reddit monitor permanently disabled")` (actions.ts:401).
- **Revalidates:** path /scanner; path /admin/source-monitor (dead); revalidatePublicSurfaces()
- **On failure:** Always throws "reddit monitor permanently disabled" before doing anything — features().reddit is hardcoded false (src/lib/env.ts:34). Beyond that gate: an empty subreddit list throws "no subreddits given"; any insert error throws `reddit monitor insert failed: <msg>` mid-loop, leaving earlier subreddits persisted.
- **Tests:** tests/reddit.test.ts (classifier/summarizer only — the action itself is untested)
- **Quirks:** DOUBLE-DEAD: no UI reaches it AND its feature flag is a hardcoded false. It is nonetheless the only writer that can produce source_signals rows with source='reddit', and automationSubreddits() (src/lib/env.ts:114) still exists to feed it. Safe to drop from the UI inventory; deleting the action would also orphan the reddit classify/summarize helpers.

#### `actions-scanner-policy-pair` — setScannerPolicy / setAutomationPaused (server actions)

- **Kind:** automatic · **Destructive:** irreversible
- **Reach:** setScannerPolicy: /scanner (admin view) > 'Scanner cadence and budget' disclosure > Save settings (AdminScannerView.tsx:599-615). setAutomationPaused: NO CALLER — no form, button or route in src/ references it.
- **Does:** The two write entry points for the single automation_settings 'scanner' row: save the whole policy, or flip just the paused flag.
- **Backing:** src/app/admin/actions.ts:457 (setScannerPolicy), src/app/admin/actions.ts:446 (setAutomationPaused)
- **Inputs:** setScannerPolicy: the full form via scannerPolicyFromFormData — cadence select (60\|120\|360\|1440\|paused), scheduledSearchCreditsPerRun select (1\|2\|3), monthlyTavilyCreditCap number input (min 0 max 1000 step 1), monthlyLlmUsdCap number input (min 0 max 2 step 0.25), hidden minIntervalMinutes, hidden modelPreset. setAutomationPaused: a single `paused` field compared to the string "true".
- **Writes:** automation_settings.value (jsonb, whole-object overwrite); automation_settings.updated_at
- **Guard:** Both: await requireAdmin() then assertProductionWriteAllowed() (actions.ts:447-448, 458-459).
- **Revalidates:** path /admin; path /scanner; path /admin/source-monitor (dead); revalidatePublicSurfaces()
- **On failure:** A thrown settings error propagates to the Next.js error boundary and NO revalidation runs, because revalidation is sequential after the await. The operator sees an error page, not an inline form error.
- **Tests:** tests/automationSettings.test.ts; tests/adminScannerView.test.ts; tests/adminActions.test.ts
- **Quirks:** setAutomationPaused is a DEAD server action — pausing today happens only through the 'Paused' option inside the cadence dropdown, which means the pause control is buried in a select labelled 'How often' inside a collapsed disclosure. The HTML min/max on the two number inputs are the only visible limits; the server silently clamps beyond them with no message (see normalizeScannerPolicy). Both actions revalidate the public surfaces even though scanner policy affects the public board only through the paused indicator.

#### `admin-session-and-write-guards` — requireAdmin / isAdmin / assertProductionWriteAllowed / signOutAdmin

- **Kind:** automatic · **Destructive:** reversible
- **Reach:** requireAdmin runs on load of /admin and /admin/compile; isAdmin gates /api/admin/export, /api/admin/scan and /api/admin/scan/status; assertProductionWriteAllowed runs first inside every mutating server action; Sign out is the last item in the operator nav on every operator page (Chrome.tsx:201-205).
- **Does:** Establishes and ends the operator session, and blocks every admin write on Vercel preview deployments.
- **Backing:** src/lib/adminGuard.ts:20 (requireAdmin), :13 (isAdmin); src/lib/previewGuard.ts:7 (assertProductionWriteAllowed); src/app/admin/actions.ts:39 (signOutAdmin)
- **Inputs:** cd_admin cookie holding `<expiresAtMs>.<base64url HMAC-SHA256(expiresAt, SESSION_SECRET)>`, verified with timingSafeEqual and an expiry check (src/lib/session.ts:12-24). Default TTL 12 hours (session.ts:4). signOutAdmin takes no input.
- **Writes:** cookie cd_admin — set to "" with httpOnly, path "/", maxAge 0 (actions.ts:41)
- **Guard:** isAdmin returns false whenever SESSION_SECRET is absent or is the literal "" / '' (adminGuard.ts:7-10) — a missing secret fails closed. requireAdmin redirects to /admin/login; isAdmin's API callers return 401 JSON. assertProductionWriteAllowed throws "preview writes disabled" when VERCEL_ENV === 'preview'.
- **Revalidates:** signOutAdmin: none — it redirects to /admin/login instead
- **On failure:** An expired or forged cookie is treated as signed-out. On preview, every mutating action throws a bare Error into the Next.js error boundary — there is no friendly 'this is a preview' UI anywhere. signOutAdmin cannot fail meaningfully; the redirect happens regardless.
- **Tests:** tests/adminGuard.test.ts; tests/session.test.ts; tests/automationPreview.test.ts; tests/adminActionsAuth.test.ts
- **Quirks:** The session is a bearer HMAC over an expiry timestamp only — it carries no user identity, which is exactly why scanner_decisions.actor is pinned to the literal 'admin' and why no other admin write can record who made it. Sign out is a submit button styled as a nav link inside a display:contents form, so it visually belongs to the nav row but is the only destructive control there; any nav redesign that renders items as <a> will break it. GET /api/admin/export and GET /api/admin/scan/status use isAdmin (401) while pages use requireAdmin (redirect) — mixing the two would either leak JSON to signed-out users or redirect a fetch().

**Surface notes.** SCOPE: this is the data contract for my partition (the write-path libraries) plus every distinct database mutation the admin surface reaches through them. It is not a UI listing; per-button coverage of /admin, /scanner and /admin/compile belongs to the UI partitions. Where a control is named here it is because the library or RPC behind it is the thing a redesign can silently break.  ANSWERS TO THE FIVE QUESTIONS  1. TABLES AND COLUMNS THE ADMIN AREA WRITES - bug_reports: moderation_status, cluster_id (src/app/admin/actions.ts:135). Nothing else; the admin never edits report content. - approved_excerpts: report_id, excerpt_text (INSERT only, actions.ts:142). - issue_clusters: fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason (actions.ts:180-186, 243-250); admin_visibility_override, admin_visibility_reason, admin_visibility_changed_at, is_public, auto_public, visibility_restore_is_public, visibility_restore_auto_public, visibility_revision (RPC set_cluster_visibility_override); signal_count, direct_report_count, verified_report_count, public_signal_count, last_signal_at (RPC apply_cluster_visibility_refresh). - source_signals: public_status, promoted_at, promotion_reason (force_hidden, signal decisions, refresh); plus a full-row upsert from runRedditMonitor (dead path). - official_patch_notes: board_no, title, patch_version, official_url, published_at, summary, observed_at, is_current (RPC set_current_patch_override). - automation_settings: key, value (jsonb), updated_at (src/lib/automation/settings.ts:144-151). - dossier_runs: markdown, provider, stats (actions.ts:382-391). - scanner_decisions: id, candidate_id, signal_id, observation_id, target_url, target_url_hash, source_domain, decision, reason, undone_at (actor and created_at default). - scanner_feedback_rules: id, decision_id, action, decision, scope_type, scope_value, reason, confirmed_at, expires_at, revoked_at, superseded_by_rule_id. - automation_rejected_candidates: decision_id, feedback_rule_id, decided_at, rescued_at. - patch_observations: is_public. - automation_runs: status, finished_at, errors — written by sweepStaleRuns (src/lib/automation/run.ts:167) on the GET /api/admin/scan/status poll. Flag this on its own: it is a GET with side effects that also calls revalidatePublicSurfaces (route.ts:49). A redesign that stops polling stops the stale-run sweep. - Cookie: cd_admin (cleared by signOutAdmin).  2. APPEND-ONLY VS DESTRUCTIVE OVERWRITE Append-only (history preserved): approved_excerpts (insert only, no update/delete path, duplicates accumulate per report), dossier_runs (insert only, never pruned), scanner_decisions and scanner_feedback_rules (immutable rows; Undo sets undone_at / revoked_at and links superseded_by_rule_id rather than deleting). Destructive overwrite (prior value unrecoverable): automation_settings.value — the whole policy jsonb is replaced; issue_clusters.fix_status / fix_claimed_at / fix_claimed_patch_version / lifecycle_reason; issue_clusters.admin_visibility_reason and admin_visibility_changed_at (a second force overwrites the first reason and time); bug_reports.moderation_status and cluster_id; source_signals.public_status / promoted_at / promotion_reason; official_patch_notes rows (ON CONFLICT DO UPDATE on board_no). Partially reversible by design: visibility forcing, because visibility_restore_is_public / visibility_restore_auto_public preserve the engine's baseline underneath the forced value. That two-layer model is the only rollback mechanism in the visibility system and must survive any redesign.  3. CACHE TAGS AND PATHS, BY MUTATION revalidatePublicSurfaces (src/lib/revalidate.ts:10) always expires tags public-dashboard, public-issues, current-patch (all at "max") and paths /, /issues, /report, /scanner. It is called by: moderateReport, setClusterFixStatus, setClusterVisibilityOverride, clearClusterFixStatusOverride, setCurrentPatchOverride, runRedditMonitor, setAutomationPaused, setScannerPolicy, recordScannerDecision, rejectObservationAndTeach, undoScannerDecision, POST /api/admin/scan (manual mode only, inside after()), GET /api/admin/scan/status (manual run finished within 2 minutes), GET /api/cron/keepalive. On top of that, every admin action adds revalidatePath("/admin"); the scanner-lane actions add revalidatePath("/scanner") — a duplicate, since revalidatePublicSurfaces already covers it — and revalidatePath("/admin/source-monitor"), which is DEAD because that page is now a bare redirect (src/app/admin/source-monitor/page.tsx:6). Two exceptions: compileDossier revalidates nothing at all (it redirects instead), and signOutAdmin revalidates nothing. Public write paths are asymmetric, whether on purpose or by drift: POST /api/reports and POST /api/confirmations expire only public-dashboard and public-issues, with no paths and no current-patch.  4. DOES ANY ADMIN WRITE CASCADE INTO PUBLIC VISIBILITY? Yes, through issue_clusters.is_public, by three routes: (a) Explicit — set_cluster_visibility_override sets is_public directly, and force_hidden additionally mass-hides every child source_signal (public_status='hidden', promotion_reason='admin_force_hidden'). Returning to auto restores is_public from visibility_restore_is_public but does NOT unhide those signals; only a later refresh recomputes them. (b) IMPLICIT AND UNLABELLED — clicking Approve on /admin fires the sync_approved_report_visibility trigger, and one approved direct report is sufficient automatic evidence to set auto_public=true and is_public=true. Nothing in that form mentions visibility. This is the single highest-risk item for a redesign: the Approve button publishes a cluster and its label does not say so. (c) Indirect — record_scanner_decision on a signal sets source_signals.public_status='hidden' and bumps issue_clusters.visibility_revision; apply_cluster_visibility_refresh then recomputes is_public from the automatic baseline while respecting any active override. Secondary public cascade: patch_observations.is_public, flipped false by record_observation_decision and back to true by undo_scanner_decision.  5. AUDIT TRAIL Almost none. The ONLY real audit trail is scanner_decisions (+ scanner_feedback_rules), which is append-only and immutable, records target_url, decision, reason, created_at and undone_at, and has actor pinned to the literal 'admin' by a CHECK constraint — so it records what and when, never who. Everything else loses history on overwrite: - automation_settings has updated_at but no previous value and no actor. - issue_clusters.admin_visibility_changed_at + admin_visibility_reason describe only the CURRENT override; the previous one is gone. - issue_clusters.lifecycle_reason is prose that two different writers overwrite (setClusterFixStatus writes "Locked by you. Manual status set to X." and the next automation pass replaces it with "Locked by you. System would show: Y."). - bug_reports moderation changes leave no record of the prior state or the operator. - No audit/actor/changed_by/updated_by column exists anywhere else in supabase/migrations. The root cause is the session model: cd_admin is an HMAC over an expiry timestamp with no identity (src/lib/session.ts:6-10), so no write COULD record who made it. Single-operator by construction.  CROSS-CUTTING NOTES FOR THE REORGANIZATION - Guard order is uniform and load-bearing: every mutating server action does requireAdmin() then assertProductionWriteAllowed() as its first two statements. Any new control must repeat both; there is no middleware doing it. - Every write goes through the service-role Supabase client. RLS is deny-all for anon/authenticated on every table involved, and every RPC is security invoker with search_path='' and EXECUTE granted only to service_role. The application layer is therefore the entire authorization model. - Advisory lock 20260709/1 is the global visibility lock. set_cluster_visibility_override, apply_cluster_visibility_refresh, record_scanner_decision, record_observation_decision, undo_scanner_decision and the bug_reports statement triggers all take it FIRST, before any scope or row lock. Any new visibility writer must join that order. - Rolling-deploy compatibility branches exist in three places and each hides a different failure mode: readAdminClusters falls back to legacy columns, setClusterVisibilityOverride retries the 2-arg RPC signature, and recordScannerDecision tolerates a missing RPC only on the 'relevant' path. rejectObservationAndTeach deliberately does the opposite and throws a message naming the required migration. - Dead or unreachable today: the setAutomationPaused server action (no caller), runRedditMonitor (no caller AND features().reddit is hardcoded false in src/lib/env.ts:34), the 'acknowledged' fix status (no rule produces it, omitted from the lock dropdown), revalidatePath("/admin/source-monitor") in seven call sites, and modelPreset as a configurable dimension (single legal value). - Empty states carry real meaning and are easy to lose: "All clear — no flagged reports need review", "Nothing needs a call. Locks you set and unsure claim matches will surface here.", "Nothing is forced right now — every issue's visibility is engine-owned", and the migration-gap strings "Existing override created before reason tracking." / "Change time unavailable". - Section membership on /admin is derived by client-side filtering of ONE readAdminClusters result (page.tsx:46-52), and the exception ledger keys off the literal string prefix "Needs review:" written by the lifecycle engine. Change that prefix in src/lib/automation/run.ts:1328-1331 and the ledger silently empties.

### Admin/operator area — existing test + doc coverage map (parity contract partition: what is PINNED BY A TEST)

_32 controls · partition `inv:tests-and-docs`_

#### `moderate-report-approve-reject-spam` — Approve / Reject / Spam (+ cluster select, public excerpt input)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /admin > Flagged for review > per-report form (src/app/admin/page.tsx:139-164)
- **Does:** Sets a bug report's moderation status, re-parents it to a cluster, optionally publishes an excerpt, then refreshes every cluster the report entered or left.
- **Backing:** tests/adminActions.test.ts:166 (describe "moderateReport"); handler src/app/admin/actions.ts:111
- **Inputs:** PINNED: id (hidden), decision (button value: approved\|rejected\|spam), cluster_id (select), excerpt (text, sliced to 500 at src/app/admin/actions.ts:142). NOT PINNED: the 500-char maxLength on the input, the "No cluster" empty option, the reject/spam paths' excerpt handling.
- **Writes:** bug_reports.moderation_status (PINNED, tests/adminActions.test.ts:194-201); bug_reports.cluster_id (PINNED, same assertion); approved_excerpts.report_id + approved_excerpts.excerpt_text (PINNED only as "a row was written to approved_excerpts", tests/adminActions.test.ts:202 — the column values are NOT asserted)
- **Guard:** requireAdmin() at src/app/admin/actions.ts:112 and assertProductionWriteAllowed() at :113. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally proves that a valid mutation-shaped unauthenticated call rejects before DB, RPC, external, or revalidation work. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin") — NOT asserted on the success path; only asserted NOT to fire on the excerpt-failure path (tests/adminActions.test.ts:227); revalidatePublicSurfaces() (tags public-dashboard/public-issues/current-patch + paths / /issues /report /scanner) — NOT asserted for this action
- **On failure:** PINNED: an approved_excerpts insert failure rethrows and the bug_reports update is NOT rolled back, and nothing revalidates (tests/adminActions.test.ts:207). PINNED: a refreshClusterVisibility throw is swallowed to console.error and the excerpt survives (tests/adminActions.test.ts:179). NOT PINNED: report-read failure ("report read failed"), report-not-found, bug_reports update failure.
- **Tests:** refreshes automatic visibility after approving a clustered report; keeps the approved excerpt when the best-effort visibility refresh fails; fails approved moderation when the public excerpt cannot be saved; refreshes the old cluster when an approved report is rejected; refreshes both clusters when an approved report moves
- **Quirks:** Pins the CONTRACT, not the copy. Ordering is load-bearing and pinned: the excerpt must be persisted BEFORE the best-effort refresh (asserted from inside the mock at tests/adminActions.test.ts:182), and old-cluster-then-new-cluster refresh order is pinned by nth-call assertions (:258-259). Three buttons share ONE form — decision is carried by the button's `value`, not a select; a redesign that turns them into separate forms or a dropdown breaks the pinned FormData shape. The excerpt field is only read when decision === "approved" (src/app/admin/actions.ts:139), so a Reject with text typed in silently discards it — no test covers that.

#### `set-cluster-fix-status-lock` — Lock (lifecycle status select + Lock button)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /admin > Lifecycle exceptions disclosure > per-cluster form (src/app/admin/page.tsx:200-212)
- **Does:** Force-sets a cluster's lifecycle status, flips admin_override on, and writes an owner-readable lock reason.
- **Backing:** tests/adminActions.test.ts:263 (describe "setClusterFixStatus"); handler src/app/admin/actions.ts:167
- **Inputs:** PINNED: cluster_id (hidden), fix_status (select, validated against FIX_STATUSES at src/app/admin/actions.ts:172). NOT PINNED: that the select only offers LOCKABLE_STATUSES (src/app/admin/page.tsx:22) — the action still accepts "acknowledged" because FIX_STATUSES includes it.
- **Writes:** issue_clusters.fix_status (PINNED); issue_clusters.fix_claimed_at (PINNED as any string); issue_clusters.fix_claimed_patch_version (PINNED as "1.13.01" from the mocked getCurrentPatchMetadata); issue_clusters.admin_override = true (PINNED); issue_clusters.lifecycle_reason (PINNED verbatim: "Locked by you. Manual status set to Marked fixed by maintainer.")
- **Guard:** requireAdmin() src/app/admin/actions.ts:168 + assertProductionWriteAllowed() :169. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin") — NOT asserted; revalidatePublicSurfaces() — NOT asserted
- **On failure:** NOT PINNED. An update error rethrows raw (src/app/admin/actions.ts:188); no test exercises it. Bad fix_status throws "bad input" — also not tested.
- **Tests:** manual status changes set an admin override and owner-readable reason
- **Quirks:** Pins BOTH the contract and the exact copy string. The lifecycle_reason assertion embeds LIFECYCLE_LABELS.verified_fixed ("Marked fixed by maintainer") — renaming that label in src/lib/lifecycle.ts breaks this test even though nothing about the write changed. Only ONE of the four lockable statuses is tested (verified_fixed); the non-claim-bearing branch ("reported", which writes fix_claimed_at: null and skips the patch fetch, src/app/admin/actions.ts:176-177) has NO coverage.

#### `clear-cluster-fix-status-override` — Clear (release maintainer lock)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /admin > Lifecycle exceptions disclosure > appears ONLY on rows where admin_override is true (src/app/admin/page.tsx:213-220)
- **Does:** Releases the maintainer lock and wipes the synthetic claim clock so automation can re-derive the status.
- **Backing:** tests/adminActions.test.ts:289 (describe "clearClusterFixStatusOverride"); handler src/app/admin/actions.ts:234
- **Inputs:** PINNED: cluster_id (hidden) only.
- **Writes:** issue_clusters.admin_override = false (PINNED); issue_clusters.lifecycle_reason = null (PINNED); issue_clusters.fix_claimed_at = null (PINNED); issue_clusters.fix_claimed_patch_version = null (PINNED)
- **Guard:** requireAdmin() src/app/admin/actions.ts:235 + assertProductionWriteAllowed() :236. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin") — NOT asserted; revalidatePublicSurfaces() — NOT asserted
- **On failure:** NOT PINNED. Missing cluster_id throws "bad input"; update error rethrows raw — neither tested.
- **Tests:** clears the override and its synthetic claim clock so automation can re-derive status
- **Quirks:** Pins the CONTRACT exactly — the four-field null-out is the whole point (clearing admin_override without nulling fix_claimed_at would leave a fabricated claim clock behind). Conditional visibility is load-bearing and UNTESTED: the button only renders when cluster.admin_override is true, so a redesign that always renders it exposes a no-op on unlocked clusters. Coupled to set-cluster-fix-status-lock: Lock writes the state that Clear undoes; they must stay adjacent.

#### `set-cluster-visibility-override-modes` — Force public / Force hidden / Reset to automatic

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /admin > Visibility overrides disclosure > "Reset to automatic" on forced cards (src/app/admin/page.tsx:255-261) and the Create-override form inside VisibilityOverrideBrowser (src/components/admin/VisibilityOverrideBrowser.tsx:66-86)
- **Does:** Writes the promotion engine's visibility escape hatch through an RPC, then (except for force_hidden) immediately recomputes effective visibility.
- **Backing:** tests/adminActions.test.ts:313 (describe "setClusterVisibilityOverride"); handler src/app/admin/actions.ts:197
- **Inputs:** PINNED: cluster_id, visibility (auto\|force_public\|force_hidden), reason (trimmed, sliced to 500), confirm_override === "true". NOT PINNED: the textarea's minLength=3/maxLength=500 attributes or the required checkbox in VisibilityOverrideBrowser.tsx:77-80.
- **Writes:** RPC set_cluster_visibility_override(p_cluster_id, p_visibility, p_reason) — PINNED by exact argument object (tests/adminActions.test.ts:324, 342, 358). The underlying issue_clusters columns it touches (admin_visibility_override, admin_visibility_reason, admin_visibility_changed_at) are NOT verified by any test — the RPC is a mock.
- **Guard:** requireAdmin() src/app/admin/actions.ts:198 + assertProductionWriteAllowed() :199. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin") — PINNED only on the refresh-failure path (tests/adminActions.test.ts:415); revalidateTag("public-dashboard","max") and revalidateTag("public-issues","max") — PINNED on the same failure path (:416-417). CURRENT_PATCH_TAG and the four paths in revalidatePublicSurfaces are NOT asserted.
- **On failure:** PINNED: when refreshClusterVisibility rejects, the action still rethrows BUT the finally block has already revalidated (tests/adminActions.test.ts:406).
- **Tests:** force_public writes the escape hatch and immediately refreshes effective visibility; force_hidden removes a quiet cluster from public reads before the deeper refresh; auto clears the override back to engine control; revalidates the applied override when the immediate refresh fails. tests/e2e/operator-writes.spec.ts:173-217 submits force-hidden and Reset through the real forms and verifies the public-board effect.
- **Quirks:** Pins the CONTRACT. The force_hidden asymmetry is deliberate and pinned by a negative assertion (tests/adminActions.test.ts:347 asserts refreshClusterVisibility is NOT called) — a redesign that "unifies" the three modes into one code path will break the hidden case. p_reason is forced to null for auto (src/app/admin/actions.ts:211), pinned at :361. Two different UI entry points feed the same action with different field sets: the Reset button sends only cluster_id + visibility=auto (no reason/confirm), the Create form sends all four — that coupling is invisible from either component alone.

#### `set-cluster-visibility-override-guards` — (validation) unknown visibility value / missing reason or confirmation

- **Kind:** server-action · **Destructive:** none
- **Reach:** /admin > Visibility overrides > Create visibility override form submit path
- **Does:** Rejects an unrecognized visibility value, and refuses any force_* write without a >=3-char reason AND an explicit confirmation checkbox.
- **Backing:** tests/adminActions.test.ts:420 and :430; handler guards src/app/admin/actions.ts:204-205
- **Inputs:** PINNED: visibility="yeet" -> "bad input"; visibility=force_public with no reason and no confirm_override -> "override reason and confirmation required". NOT PINNED: reason present but under 3 chars; confirm present but reason blank; reason over 500 chars (silently truncated, never rejected).
- **Writes:** read-only — PINNED that mutations array stays empty (tests/adminActions.test.ts:427) and that supabase.rpc is never called (:437)
- **Guard:** These action-specific tests pin the input validation. Separately, tests/adminActionsAuth.test.ts:149-186 pins the parent action's unauthenticated stop-before-work boundary; no preview-mode test covers this action.
- **Revalidates:** —
- **On failure:** PINNED: both guards throw before any write and before any revalidation.
- **Tests:** rejects unknown visibility values; requires a reason and explicit confirmation before forcing visibility
- **Quirks:** Pins the CONTRACT (the fail-closed boundary), not the copy. The two error strings ARE asserted verbatim, so changing the message text breaks the test even though behavior is unchanged. A redesign that makes the confirmation implicit (e.g. a "are you sure?" modal that auto-sets confirm_override) satisfies the test while destroying the guard's intent.

#### `set-cluster-visibility-legacy-rpc-fallback` — (automatic) legacy visibility-RPC signature retry

- **Kind:** automatic · **Destructive:** none
- **Reach:** Invisible; runs inside every Force/Reset submit during a rolling deploy
- **Does:** If PostgREST cannot resolve the 3-arg RPC signature, retries once without p_reason; any other RPC error surfaces unchanged.
- **Backing:** tests/adminActions.test.ts:366 and :395; handler src/app/admin/actions.ts:213-225
- **Inputs:** Not operator-facing. Discriminates on error code PGRST202 via isMissingSupabaseRpc.
- **Writes:** RPC set_cluster_visibility_override(p_cluster_id, p_visibility) — the two-argument legacy form, PINNED by nth-call assertion (tests/adminActions.test.ts:389)
- **Guard:** Inherits the caller's guards. The action-specific test stubs requireAdmin, while tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary; the fallback test does not add preview-guard coverage.
- **Revalidates:** same as the parent action; not asserted here
- **On failure:** PINNED: a 42501 permission-denied error must NOT trigger the fallback — it rethrows after exactly one rpc call (tests/adminActions.test.ts:395, asserting rpc called once).
- **Tests:** retries the legacy visibility RPC only when the new signature is missing; does not hide a real visibility RPC failure behind the legacy fallback
- **Quirks:** Pins the CONTRACT. This is migration-era scaffolding with a real test guarding it — a redesign that "cleans up" the retry will delete a pinned behavior. The negative test is the valuable half: it exists specifically to stop the fallback from masking permission failures.

#### `set-automation-paused` — setAutomationPaused (pause/resume scheduled scans)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** NO UI REACHES THIS. Grep of src/ finds no component importing setAutomationPaused from @/app/admin/actions — the only live pause control is the "How often" cadence select (paused option) inside setScannerPolicy.
- **Does:** Upserts the scanner automation_settings row with paused flipped, preserving the rest of the policy.
- **Backing:** tests/adminActions.test.ts:441 (describe "setAutomationPaused"); handler src/app/admin/actions.ts:446
- **Inputs:** PINNED: paused === "true" (string compare, src/app/admin/actions.ts:449).
- **Writes:** automation_settings.key = "scanner" with automation_settings.value.paused = true — PINNED loosely via objectContaining (tests/adminActions.test.ts:461-468); the surrounding policy fields are NOT asserted here (they are, separately, at tests/automationSettings.test.ts:154)
- **Guard:** requireAdmin() src/app/admin/actions.ts:447 + assertProductionWriteAllowed() :448. tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. The preview guard is also pinned specifically here (tests/adminActions.test.ts:442 sets VERCEL_ENV=preview and @/lib/previewGuard is not mocked).
- **Revalidates:** revalidatePath("/admin/source-monitor") — PINNED (tests/adminActions.test.ts:469); revalidatePath("/admin") — PINNED (:470); revalidatePath("/") — PINNED (:471) via revalidatePublicSurfaces; revalidatePath("/scanner") + tags — fire but are NOT asserted
- **On failure:** PINNED for preview: throws "preview writes disabled", writes nothing, revalidates nothing (tests/adminActions.test.ts:450-451). Storage failure NOT pinned.
- **Tests:** blocks scanner setting writes in Vercel preview; persists scanner pause state behind admin auth
- **Quirks:** DEAD CONTROL with a live test. The action is exported and tested but unreachable from any rendered UI — a redesign that deletes it loses nothing operationally but breaks two tests. The pinned revalidatePath("/admin/source-monitor") targets a route that is now a bare redirect() to /scanner (src/app/admin/source-monitor/page.tsx:5), so the test pins a revalidation of a page that renders nothing.

#### `set-scanner-policy-save-settings` — Save settings (How often / Search depth / Monthly search cap / Monthly LLM cap $)

- **Kind:** form · **Destructive:** reversible
- **Reach:** /scanner (admin view) > "Scanner cadence and budget" disclosure > form (src/components/scanner/AdminScannerView.tsx:601-614)
- **Does:** Parses the cadence + budget form into a clamped scanner policy and upserts it as the single automation_settings scanner row.
- **Backing:** tests/adminActions.test.ts:475 (describe "setScannerPolicy"); parsing pinned separately at tests/automationSettings.test.ts:187; handler src/app/admin/actions.ts:457
- **Inputs:** PINNED (clamping): minIntervalMinutes, scheduledSearchCreditsPerRun, monthlyTavilyCreditCap (negative -> 1000), monthlyLlmUsdCap (7 -> 2), modelPreset (any value -> "deepseek_v4_flash"). PINNED (form shape): cadence="paused" maps to paused:true, cadence="120" to paused:false (tests/automationSettings.test.ts:187-210). NOTE the mismatch: the live form posts a `cadence` select plus hidden minIntervalMinutes/modelPreset; the adminActions test posts `paused` + minIntervalMinutes instead — it does NOT exercise the real form's field set.
- **Writes:** automation_settings.key = "scanner", automation_settings.value = the full six-field policy object — PINNED exactly (tests/adminActions.test.ts:488-502)
- **Guard:** requireAdmin() src/app/admin/actions.ts:458 + assertProductionWriteAllowed() :459. tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin/source-monitor") — PINNED (tests/adminActions.test.ts:503); revalidatePath("/admin") — PINNED (:504); revalidatePath("/") — PINNED (:505); revalidatePath("/scanner") + the three tags — fire but NOT asserted
- **On failure:** NOT PINNED. A settings write failure propagates from setScannerPolicyState; no test covers it.
- **Tests:** persists a clamped scanner policy behind admin auth; parses the admin cadence control including paused; caps defaults, stored policy, and form input at two dollars; normalizes the legacy route to the single approved DeepSeek preset
- **Quirks:** Pins the CONTRACT, and specifically pins the money ceilings — $2/month LLM and 1000 Tavily credits are clamped server-side regardless of what the form posts. Two tests pin the SAME $2 cap from opposite ends: the server clamp (tests/adminActions.test.ts:499) and the input's max="2" attribute (tests/adminScannerView.test.ts:36). Label mismatch worth flagging: the visible "How often" select carries the pause state, so "pausing the scanner" and "changing cadence" are the same control — splitting them in a redesign silently resurrects the dead setAutomationPaused problem.

#### `rescue-rejected-candidate` — Rescue (restore an auto-rejected candidate)

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** ORPHANED. The only caller is src/components/scanner/RejectedArchive.tsx:22, and grep of src/ shows nothing imports RejectedArchive. The button cannot be reached in the running app.
- **Does:** Compatibility shim: rewrites the form as a Relevant exact_url scanner decision and delegates to recordScannerDecision.
- **Backing:** tests/adminActions.test.ts:509 (describe "rescueRejectedCandidate"); handler src/app/admin/actions.ts:697
- **Inputs:** PINNED: id only. The action synthesizes decision="relevant", scope="exact_url", and a fixed reason string (src/app/admin/actions.ts:702-704) — the reason text is NOT asserted.
- **Writes:** source_signals (via rescueCandidateSignal) — PINNED only as "called with an object containing title/url/sourceDomain/sourcePublishedAt/snippet" (tests/adminActions.test.ts:531-540); the actual columns written are NOT verified; automation_rejected_candidates.rescued_at — PINNED as expect.any(String) on the legacy-fallback path (tests/adminActions.test.ts:680-687)
- **Guard:** NONE OF ITS OWN — src/app/admin/actions.ts:697 has no requireAdmin and no preview guard; it inherits them from recordScannerDecision at :471-472. tests/adminActionsAuth.test.ts:105-106 and :149-186 prove that this delegating path rejects before work for a valid id.
- **Revalidates:** revalidatePath("/admin/source-monitor") — PINNED (tests/adminActions.test.ts:549)
- **On failure:** PINNED: missing id throws "bad input" and never touches the signal writer (tests/adminActions.test.ts:552); a candidate id that isn't in the table throws "rejected candidate not found" (:560).
- **Tests:** reads the rejected candidate, persists it as a signal, and marks it rescued; throws when the rejected candidate id is missing; throws when the rejected candidate cannot be found; preserves the legacy rescue path before the scanner-decision RPC is deployed
- **Quirks:** Pins the CONTRACT of an UNREACHABLE control. Four tests guard a button nobody can click. The equivalent live control is "Keep as relevant" in ScannerFeedbackDesk (src/components/scanner/ScannerFeedbackDesk.tsx:79-87), which posts to recordScannerDecision directly. Note the first test's seedRows describe an off-topic "Nice scenery tour" being rescued — the test data implies the operator can rescue anything, with no relevance check server-side.

#### `record-scanner-decision-candidate-reject` — Reject and teach… (on an auto-rejected candidate)

- **Kind:** form · **Destructive:** reversible
- **Reach:** /scanner (admin view) > teaching desk > per-candidate disclosure (src/components/scanner/ScannerFeedbackDesk.tsx:92-135)
- **Does:** Records a durable, reason-bearing rejection rule keyed to the candidate's normalized exact URL, without changing any cluster's visibility.
- **Backing:** tests/adminActions.test.ts:587; handler src/app/admin/actions.ts:470
- **Inputs:** PINNED: id, decision (off_topic etc.), reason (3-500 chars), scope (exact_url default). PINNED derivation: the stored scope_value is the URL with tracking params stripped ("...any_plans_for_mcp" not "...?utm_source=search").
- **Writes:** RPC record_scanner_decision(p_candidate_id, p_decision, p_scope_type, p_scope_value, p_confirm_broad, p_target_url_hash) — PINNED via objectContaining (tests/adminActions.test.ts:597-607), including that p_target_url_hash matches /^[0-9a-f]{64}$/. The scanner_decisions / scanner_feedback_rules rows the RPC actually writes are NOT verified by any test.
- **Guard:** requireAdmin() src/app/admin/actions.ts:471 + assertProductionWriteAllowed() :472. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin"), "/scanner", "/admin/source-monitor" + revalidatePublicSurfaces — NOT asserted for the candidate path
- **On failure:** PINNED by negative assertions: the candidate is NOT rescued and NO visibility override RPC fires (tests/adminActions.test.ts:608-609).
- **Tests:** records a durable exact-URL rejection without changing visibility or rescuing the candidate
- **Quirks:** Pins the CONTRACT. The negative assertions are the real content — this control must not leak into the visibility system. Coupled to the rule-revocation control: tests/queriesAdminCompatibility.test.ts:189 proves only that the admin query has no literal `limit(50)`. It does not paginate or prove that every active rule survives the hosted row cap, so the current test cannot guarantee a recovery path for every decision.

#### `record-scanner-decision-broad-scope-confirm` — Scope select (this page / this subreddit / whole domain) + "I understand this is broad" checkbox

- **Kind:** select · **Destructive:** reversible
- **Reach:** /scanner (admin view) > teaching desk > Reject and teach… > scope select and confirm checkbox (src/components/scanner/ScannerFeedbackDesk.tsx:116-131)
- **Does:** Widens the learned rule from one URL to a subreddit path or a whole domain — but only when the operator explicitly confirms.
- **Backing:** tests/adminActions.test.ts:612 and :624; guard src/app/admin/actions.ts:489
- **Inputs:** PINNED: scope="source_path" WITHOUT confirm_broad -> "bad input", zero RPC calls. PINNED: same with confirm_broad="true" -> RPC receives p_scope_type="source_path", p_scope_value="reddit.com/r/protonmail", p_confirm_broad=true. NOT PINNED: scope="source_domain" for a candidate (only tested for signals, where it is refused).
- **Writes:** RPC record_scanner_decision with the widened p_scope_type/p_scope_value — PINNED (tests/adminActions.test.ts:635-642)
- **Guard:** The confirm_broad requirement itself IS the guard, and it IS pinned (src/app/admin/actions.ts:489).
- **Revalidates:** not asserted
- **On failure:** PINNED: unconfirmed broad scope throws before any RPC (tests/adminActions.test.ts:621).
- **Tests:** requires explicit confirmation for a subreddit rule; passes the visible subreddit scope only after broad-rule confirmation; normalizes Reddit rules to an explicit subreddit scope; derives exact, path, and domain values from the candidate; shows and stores one registrable scope for multi-part domains
- **Quirks:** Pins the CONTRACT on both sides — the refusal AND the exact normalized value. The scope shown to the operator must equal the scope stored (subreddit case is lowercased and stripped to reddit.com/r/<sub>); tests/scannerFeedback.test.ts:24-49 pins that derivation independently of the action. A redesign that pre-checks the confirmation box, or that displays a prettier scope than the one it stores, defeats a pinned guarantee without failing any test.

#### `record-scanner-decision-keep-relevant` — Keep as relevant

- **Kind:** button · **Destructive:** irreversible
- **Reach:** /scanner (admin view) > teaching desk > per-candidate (src/components/scanner/ScannerFeedbackDesk.tsx:79-87)
- **Does:** Promotes an auto-rejected candidate back into the signal pipeline and, on the normal RPC path, records a durable allow rule, in that order. The supported missing-RPC path rescues without a rule.
- **Backing:** tests/adminActions.test.ts:645; handler src/app/admin/actions.ts:470 (relevant branch)
- **Inputs:** PINNED (as posted by the live form): id, decision="relevant", scope="exact_url", plus a hardcoded hidden reason string (src/components/scanner/ScannerFeedbackDesk.tsx:83) — the reason's text is not asserted anywhere.
- **Writes:** source_signals and an automation run via rescueCandidateSignal — PINNED only as "called once"; normal path then calls RPC record_scanner_decision with p_decision="relevant" — PINNED (tests/adminActions.test.ts:657-660). The rescue itself uses zero search credits and zero or one OpenRouter generation call; cost verification may add ID-only audit GETs.
- **Guard:** requireAdmin() + assertProductionWriteAllowed() at src/app/admin/actions.ts:471-472. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** not asserted
- **On failure:** PINNED: if the rescue write fails, NO rule is recorded and NO table is mutated (tests/adminActions.test.ts:708) — the operator is not told a lesson was learned when the lead never landed.
- **Tests:** rescues a Relevant candidate before recording the durable allow rule; leaves the candidate and prior rules untouched when a Relevant rescue fails
- **Quirks:** Pins the CONTRACT including ORDERING — tests/adminActions.test.ts:661 asserts rescueCandidateSignal's invocation order is strictly before the RPC's. A redesign that parallelizes these two writes for speed breaks a deliberate atomicity property. Undo can revoke the normal-path lesson but never removes the rescued signal/run, returns the candidate, or refunds spend, so this is not reversible. The reason text is baked into a hidden input in the component, so the operator never sees or edits what gets stored as their justification.

#### `record-scanner-decision-remove-bad-lead` — Remove bad lead (teach on a KEPT signal, not a rejected candidate)

- **Kind:** form · **Destructive:** reversible
- **Reach:** /scanner (admin view) > "What the scanner kept" > per-lead form (src/components/scanner/AdminScannerView.tsx:179-209)
- **Does:** Removes a retained lead and teaches the scanner from it, then recomputes visibility for the one cluster the RPC reports as affected.
- **Backing:** tests/adminActions.test.ts:723; signal branch src/app/admin/actions.ts:495-539
- **Inputs:** PINNED: id, target_kind="signal" (hidden), decision (select), reason (textarea), scope="exact_url" (hidden). PINNED refusals: target_kind=signal with decision="relevant", or with any scope other than exact_url, or with confirm_broad set -> "bad input" (src/app/admin/actions.ts:488).
- **Writes:** RPC record_scanner_decision(p_candidate_id: null, p_signal_id, p_decision, p_scope_type:"exact_url", p_scope_value) — PINNED exactly (tests/adminActions.test.ts:749-758). p_scope_value is derived from canonical_url ?? source_url.
- **Guard:** requireAdmin() + assertProductionWriteAllowed() src/app/admin/actions.ts:471-472. tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary; no preview-mode test pins this action. The signal-specific input guard at :488 is pinned separately.
- **Revalidates:** revalidatePath("/admin") and "/scanner" fire at src/app/admin/actions.ts:538-539 — NOT asserted
- **On failure:** PINNED: refreshClusterVisibility is called with the RPC-reported affected_cluster_id ("cluster-current"), NOT the signal row's own cluster_id ("cluster-other") — tests/adminActions.test.ts:759. Signal-not-found and read-failure paths are NOT pinned.
- **Tests:** removes one kept lead and refreshes only its cluster after recording the exact-URL lesson; does not allow a kept signal to create a Relevant or broad rule
- **Quirks:** Pins the CONTRACT, and pins a subtle trap: the test seeds a signal whose own cluster_id disagrees with the RPC's affected_cluster_id specifically to prove the code trusts the RPC. A redesign that "simplifies" by refreshing signal.cluster_id breaks it. Rendering is separately pinned — tests/adminScannerView.test.ts:103 asserts EIGHT leads each get their own target_kind=signal form and a "Remove bad lead" button, and that overflow leads stay reachable via "Browse 2 older leads"; a redesign that truncates the lead list to a top-N breaks parity.

#### `record-scanner-decision-steam-review-refusal` — (conditional absence) no teaching action on Steam review leads

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin view) > "What the scanner kept" > any lead whose source is steam_review renders an explanatory note INSTEAD of the form
- **Does:** Refuses to create a URL feedback rule from a Steam review, because all Steam reviews share one provider URL and one rule would blocklist the whole lane.
- **Backing:** tests/adminActions.test.ts:762 (server refusal) and tests/adminScannerView.test.ts:154 (UI absence); guard src/app/admin/actions.ts:512-514
- **Inputs:** PINNED: a signal with source or source_type === "steam_review" -> throws "Steam review signals cannot create URL feedback rules".
- **Writes:** read-only — PINNED that supabase.rpc is never called and no cluster refresh fires (tests/adminActions.test.ts:788-789)
- **Guard:** Content-based refusal at src/app/admin/actions.ts:512. The action-specific unit test stubs requireAdmin, while tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary.
- **Revalidates:** —
- **On failure:** PINNED: throws before any write.
- **Tests:** refuses a shared-URL feedback lesson for a Steam review signal; does not offer a shared-URL teaching action for a Steam review lead
- **Quirks:** Pins BOTH the contract (server refusal) and the COPY (the UI test asserts the literal string "Steam review leads share one provider URL" at tests/adminScannerView.test.ts:198). This is a control defined by its ABSENCE — the parity item is "this lead type must NOT get a Remove button", asserted by not.toContain. A redesign that renders a uniform action row for every lead type will pass no test and fail this one loudly, which is the point.

#### `record-scanner-decision-missing-rpc-honesty` — (automatic) refuse to claim a lesson was learned when the RPC is absent

- **Kind:** automatic · **Destructive:** none
- **Reach:** Invisible; runs on every teach submit during a rolling deploy
- **Does:** When record_scanner_decision is missing from the schema cache, a rejection surfaces "scanner decision write failed" rather than silently succeeding — but the legacy rescue path still completes.
- **Backing:** tests/adminActions.test.ts:664 and :690; handler src/app/admin/actions.ts:533 / :571 region
- **Inputs:** Not operator-facing; discriminates on PGRST202.
- **Writes:** on the legacy rescue path only: automation_rejected_candidates.rescued_at — PINNED as expect.any(String) (tests/adminActions.test.ts:680-687)
- **Guard:** n/a
- **Revalidates:** not asserted
- **On failure:** PINNED: an off_topic rejection with the RPC missing throws "scanner decision write failed" (tests/adminActions.test.ts:705). PINNED asymmetry: a Relevant rescue with the RPC missing still succeeds via the legacy path (:664).
- **Tests:** preserves the legacy rescue path before the scanner-decision RPC is deployed; does not pretend a rejection was learned when the decision RPC is missing
- **Quirks:** Pins the CONTRACT. This is honesty scaffolding tied to a specific migration — it looks like dead compatibility code and is exactly the kind of thing a redesign deletes. The asymmetry (rescue degrades gracefully, rejection fails loudly) is intentional and pinned by two tests that must be read together. Parallel behavior for observations exists at src/app/admin/actions.ts:682-686 with a named migration in the error string and has NO test.

#### `undo-scanner-decision` — Undo / "Undo — restore item and revoke rule"

- **Kind:** server-action · **Destructive:** reversible
- **Reach:** /scanner (admin view) > teaching desk rules list (src/components/scanner/ScannerFeedbackDesk.tsx:243-246) AND the Wire/Asks observation list (src/components/scanner/AdminScannerView.tsx:253-261)
- **Does:** Revokes one learned rule by decision id and, if the RPC reports an affected cluster, recomputes that cluster's visibility.
- **Backing:** tests/adminActions.test.ts:811 (describe "undoScannerDecision"); handler src/app/admin/actions.ts:708
- **Inputs:** PINNED: decision_id (hidden) only.
- **Writes:** RPC undo_scanner_decision(p_decision_id) — PINNED exactly (tests/adminActions.test.ts:820). The unit test does not inspect persisted rows, but tests/e2e/operator-writes.spec.ts:57-119 proves observation Undo restores the public Ask and candidate Undo restores the candidate through the real server-action path.
- **Guard:** requireAdmin() src/app/admin/actions.ts:709 + assertProductionWriteAllowed() :710. The action-specific unit test stubs requireAdmin, but tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary. No preview-mode test pins this action's assertProductionWriteAllowed branch.
- **Revalidates:** revalidatePath("/admin") — PINNED (tests/adminActions.test.ts:822); "/scanner", "/admin/source-monitor", revalidatePublicSurfaces — fire but NOT asserted
- **On failure:** NOT PINNED: the "scanner decision was already undone or not found" throw at src/app/admin/actions.ts:722 has no test, and neither does the RPC-error path.
- **Tests:** revokes the learning rule without touching cluster visibility; recomputes the affected signal cluster after undo. tests/e2e/operator-writes.spec.ts:57-119 proves observation Undo restores the public Ask and candidate Undo restores the candidate.
- **Quirks:** Pins the CONTRACT. Two negative assertions matter for a redesign: the action must never call set_cluster_visibility_override (tests/adminActions.test.ts:821), and it must NOT read scanner_decisions or source_signals itself — the RPC's return value is the only source of the affected cluster (tests/adminActions.test.ts:837-838). One generic Undo serves two visually different surfaces (rules list and observation rows), so splitting them in a redesign duplicates a pinned path. Rendering is pinned separately: tests/adminScannerView.test.ts:203 asserts a hidden item shows Undo with name="decision_id" and does NOT re-offer a second reject.

#### `set-current-patch-override` — Set current patch (New current patch input)

- **Kind:** form · **Destructive:** reversible
- **Reach:** /admin > "Current patch override" disclosure > form (src/app/admin/page.tsx:292-312)
- **Does:** Break-glass: writes the current official patch version by hand through one atomic RPC when the notice scraper stops matching.
- **Backing:** tests/adminActions.test.ts:842 (describe "setCurrentPatchOverride"); handler src/app/admin/actions.ts:263
- **Inputs:** PINNED: patch_version validated by isValidPatchVersion — "not-a-version" rejected, "1.13.02" accepted. NOT PINNED: the client-side pattern=PATCH_VERSION_SHAPE and required attributes on the input (src/app/admin/page.tsx:304-306).
- **Writes:** RPC set_current_patch_override(p_patch_version, p_observed_at) — PINNED exactly (tests/adminActions.test.ts:860-863). PINNED negative: official_patch_notes is NEVER written directly (:864, :886).
- **Guard:** requireAdmin() src/app/admin/actions.ts:264 + assertProductionWriteAllowed() :265. tests/adminActionsAuth.test.ts:149-186 centrally pins the unauthenticated stop-before-work boundary, and the preview guard is specifically pinned by tests/adminActions.test.ts:869.
- **Revalidates:** revalidateTag("current-patch","max") — PINNED (tests/adminActions.test.ts:865); revalidatePath("/") — PINNED (:866); revalidatePath("/admin"), "/issues", "/report", "/scanner" and the other two tags — fire but NOT asserted
- **On failure:** PINNED: bad version -> "bad input", zero writes, zero revalidation (tests/adminActions.test.ts:843). PINNED: preview -> "preview writes disabled", zero writes (:869). PINNED: RPC error rethrows the provider message and revalidateTag is never called, so no surface claims a patch change that did not happen (:879).
- **Tests:** rejects a malformed patch version with no writes; writes the manual current patch through one atomic RPC and refreshes public surfaces; blocks the override in Vercel preview; surfaces an atomic write failure instead of claiming success. tests/e2e/operator-writes.spec.ts:220-250 submits the manual override through the real form, verifies public-board propagation, then restores the seed state.
- **Quirks:** Pins the CONTRACT thoroughly — this is the best-covered admin control in the repo (4 tests including both guards and the failure path). The "one atomic RPC, never a direct official_patch_notes write" property is asserted twice by negative assertion; a redesign that re-implements this as a table update passes type-check and fails these tests. The control's blast radius is the whole public site (every patch-scoped readout), yet it lives behind a collapsed <details> at the bottom of /admin.

#### `run-reddit-monitor-disabled` — runRedditMonitor (REMOVED)

- **Kind:** server-action · **Destructive:** none
- **Status:** DELETED along with the whole authenticated Reddit path. Nothing to call, disabled or otherwise.
- **Where the policy lives now:** tests/redditApiRetirement.test.ts — a structural source scan, exactly the "lint rule or env assertion" this entry asked for. tests/adminActions.test.ts additionally asserts the admin action surface exports no Reddit action even with legacy credentials stubbed.
- **Unchanged policy:** docs/OPERATIONS.md ("Reddit API access and direct subreddit monitoring are permanently off") still holds; Tavily-based Reddit discovery was never covered by it and is untouched.

#### `api-admin-scan-post` — Run capped scan now / test-scan (POST /api/admin/scan)

- **Kind:** api-route · **Destructive:** reversible
- **Reach:** /scanner (admin view) > ScanControls buttons (src/components/ScanControls.tsx:140-155) -> fetch POST
- **Does:** Starts a manual or dry_run automation scan under the persisted policy, returns a runId immediately, and registers an after() callback that revalidates public surfaces once the run completes — for manual mode only.
- **Backing:** tests/adminScanRoute.test.ts:97 (describe "POST /api/admin/scan"); handler src/app/api/admin/scan/route.ts
- **Inputs:** PINNED: JSON body {mode}. Only "manual" and "dry_run" accepted; "scheduled", missing mode, and malformed JSON all 400.
- **Writes:** automation_runs (via startAutomationScan) — the route test mocks startAutomationScan, so NO test verifies what the run writes; cache tags/paths on completion (see revalidates)
- **Guard:** isAdmin() -> 401 (PINNED, tests/adminScanRoute.test.ts:98) and isVercelPreview() -> 403 {error:"preview_writes_disabled"} (PINNED, :105). This route has direct handler-level auth coverage; tests/adminActionsAuth.test.ts independently pins every guarded server-action path.
- **Revalidates:** PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG, CURRENT_PATCH_TAG (all "max") + paths /, /issues, /report — PINNED, but ONLY after the captured after() callback is invoked AND the completion promise resolves (tests/adminScanRoute.test.ts:153); PINNED negative: dry_run revalidates NOTHING (tests/adminScanRoute.test.ts:176)
- **On failure:** PINNED: 401 non-admin and 403 preview both start no scan; 400 on bad mode starts no scan; 409 {error:"scan_already_running"} registers NO after() callback (tests/adminScanRoute.test.ts:145).
- **Tests:** 401s for non-admins without starting a scan; 403s in Vercel preview; 400s on a bad or missing mode; starts a scan for a valid mode, returns runId, and registers an after() callback; 409s when a scan is already running; invoking the captured after() callback revalidates for manual mode after awaiting completion; invoking the captured after() callback for dry_run does not revalidate
- **Quirks:** Pins the CONTRACT and the deferred-work mechanism. The test asserts the after() callback has NOT executed on its own (tests/adminScanRoute.test.ts:142) — i.e. revalidation must be lazy, not fire-and-forget at response time. The CLIENT side is entirely untested: ScanControls' two buttons, its 2.5s polling loop, its 4-failure tolerance, and its 401 "your session expired" handling (src/components/ScanControls.tsx:63-70) have NO unit test and NO e2e assertion. A redesign of the scan buttons can break every one of those with a green suite.

#### `api-admin-scan-status-get` — (automatic) scan progress polling and stale-run sweep (GET /api/admin/scan/status?id=)

- **Kind:** automatic · **Destructive:** state-changing
- **Reach:** Fired every 2500ms by ScanControls while a run is active (src/components/ScanControls.tsx:60)
- **Does:** Calls sweepStaleRuns before looking up the requested row, then echoes that row's status/progress and revalidates public surfaces when it observes a recently finished manual run.
- **Backing:** tests/adminScanRoute.test.ts:194 (describe "GET /api/admin/scan/status"); handler src/app/api/admin/scan/status/route.ts
- **Inputs:** PINNED: id query param required (400 without). The route reads automation_runs and returns id/status/mode/progress/skips/errors/started_at/finished_at verbatim.
- **Writes:** Every poll calls sweepStaleRuns, which updates every automation_runs row still `running` more than 15 minutes after started_at to status=`failed`, sets finished_at, and records `stale_running_run`; the route test mocks this helper, so the SQL effect is not verified there. It may also revalidate caches after a recently finished manual run.
- **Guard:** isAdmin() -> 401 (PINNED, tests/adminScanRoute.test.ts:195).
- **Revalidates:** PUBLIC_DASHBOARD_TAG / PUBLIC_ISSUES_TAG / CURRENT_PATCH_TAG + /, /issues, /report — PINNED for a manual run finished ~30s ago (tests/adminScanRoute.test.ts:230); PINNED negatives: a still-running row revalidates nothing (:213); a finished dry_run row revalidates nothing (:251)
- **On failure:** PINNED: unknown id -> 404 after the stale sweep; read error -> 500 (tests/adminScanRoute.test.ts:268). A sweep failure would fail the request before the row lookup and is not pinned.
- **Tests:** 401s for non-admins; 400s when id is missing; 404s for an unknown id; 200s and echoes progress for a running row; revalidates public surfaces for a manual row finished 30s ago; does not revalidate for a dry_run row finished 30s ago; 500s when the read errors
- **Quirks:** Pins part of the contract. This GET performs a real database write on every poll through sweepStaleRuns and can also mutate cache state; replacing polling with a websocket or removing the endpoint silently deletes both the stale-run recovery and the second revalidation path. The route tests assert the helper call, not its SQL, and pin the revalidation freshness window only at a 30-second example.

#### `api-admin-status-get` — (automatic) admin session probe (GET /api/admin/status)

- **Kind:** api-route · **Destructive:** none
- **Reach:** Called by the public footer Admin button before routing (tests/e2e/public-visual.spec.ts:1045 proves the footer depends on it)
- **Does:** Reports whether the current browser holds a valid admin session, so the public footer can route to /admin or open the sign-in dialog.
- **Backing:** tests/adminStatusRoute.test.ts:9; handler src/app/api/admin/status/route.ts
- **Inputs:** None.
- **Writes:** read-only
- **Guard:** NONE — the route is intentionally unauthenticated and returns {admin:boolean}. It leaks only the caller's own session state.
- **Revalidates:** —
- **On failure:** NOT PINNED. The route has no error branch; an isAdmin() throw would 500 untested.
- **Tests:** reports whether the current browser has an admin session
- **Quirks:** Pins the CONTRACT (the {admin:boolean} shape) at the thinnest possible level — the test only checks that two successive calls echo the mocked isAdmin values. The e2e test at tests/e2e/public-visual.spec.ts:1042-1052 pins something the unit test cannot: ONE footer activation must issue exactly ONE status request even when the response takes 1.5s. That anti-double-click property lives only in e2e and only for the footer button.

#### `admin-session-auth-primitives` — Admin password sign-in + 12-hour session token

- **Kind:** form · **Destructive:** none
- **Reach:** /admin/login form (src/app/admin/login/LoginForm.tsx) and the public footer Admin dialog -> POST /api/admin/login
- **Does:** Compares the submitted password with a keyed comparison, mints a signed 12-hour session token, and sets the httpOnly admin cookie.
- **Backing:** tests/session.test.ts:6 and tests/adminGuard.test.ts:13; handlers src/app/api/admin/login/route.ts:5 and src/lib/adminGuard.ts
- **Inputs:** PINNED (primitives only): token round-trip, malformed token, wrong secret, expired token, tampered expiry; passwordMatches true/false; passwordMatches throws "comparison secret required" with an empty secret. PINNED: a missing, whitespace, '""' or "''" SESSION_SECRET yields NO admin session (fail-closed).
- **Writes:** cookie cd_admin (ADMIN_COOKIE), httpOnly, sameSite lax, maxAge 12h — set at src/app/api/admin/login/route.ts:19-25. NOT PINNED by any unit test.
- **Guard:** The route itself IS the guard. tests/e2e/public-visual.spec.ts:66-69 posts valid credentials and proves the resulting cookie is accepted by authenticated pages. No route-unit test pins the 400 invalid_json branch, 401 invalid_credentials branch, deliberate 750ms timing delay, or cookie attributes.
- **Revalidates:** —
- **On failure:** PINNED at the primitive level only: verifySessionToken returns false for every malformed/expired/tampered case; adminSessionSecret returns null for placeholder secrets so isAdmin() is false rather than throwing.
- **Tests:** round-trips a valid token; rejects undefined, malformed, and wrong-secret tokens; rejects expired tokens; rejects tampered expiry; uses a server-only comparison secret while preserving valid and invalid login results; refuses to compare without the keyed comparison boundary; treats missing or placeholder session secrets as no public admin session; keeps a real session secret
- **Quirks:** Pins the CONTRACT of the crypto primitives, NOT the route. The gap is wide: the login route, the DELETE branch that clears the cookie, the 750ms constant-ish delay, and the httpOnly/secure/sameSite cookie flags have zero unit coverage — only the e2e mock server exercises POST. docs/OPERATIONS.md:92-93 fixes the workflow ("Open /admin/login or the footer Admin link... Authenticate with the current ADMIN_PASSWORD"), and the e2e suite pins the copy "12 hours after sign-in" (tests/e2e/public-visual.spec.ts:1007) while explicitly forbidding "after inactivity" (:1006) — the session is absolute-TTL, and the UI must not imply otherwise.

#### `read-admin-clusters-on-page-load` — (automatic) /admin cluster ledger read

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every /admin render (src/app/admin/page.tsx:35)
- **Does:** Reads the issue_clusters projection that feeds the cluster select, lifecycle exceptions, visibility overrides, and the override browser — retrying with a legacy projection during a rolling migration.
- **Backing:** tests/adminClusters.test.ts:18; reader src/lib/adminClusters.ts
- **Inputs:** None (server read).
- **Writes:** read-only
- **Guard:** requireAdmin() at src/app/admin/page.tsx:25 gates the page. tests/e2e/public-visual.spec.ts:1053-1056 proves a signed-out direct navigation redirects to /admin/login.
- **Revalidates:** none; the page is dynamic = "force-dynamic" (src/app/admin/page.tsx:19)
- **On failure:** PINNED: a 42501 permission error THROWS "admin clusters read failed: permission denied" instead of rendering an empty ledger (tests/adminClusters.test.ts:54); a legacy-retry failure throws "admin clusters legacy read failed: ..." (:61).
- **Tests:** uses the legacy projection only when a new audit column is missing; surfaces permission errors instead of rendering a false empty ledger; surfaces a legacy-query failure after a genuine missing-column retry
- **Quirks:** Pins the CONTRACT, and the important half is the refusal to degrade: an empty cluster ledger must never be shown when the read actually failed. PINNED: exactly ONE retry, only for PGRST204 missing-column errors, and the legacy path backfills admin_visibility_reason/admin_visibility_changed_at as null (tests/adminClusters.test.ts:45-51). A redesign that wraps this read in a try/catch to "make /admin resilient" would invert a deliberately-tested decision.

#### `get-automation-admin-data-on-page-load` — (automatic) /scanner admin data read

- **Kind:** automatic · **Destructive:** none
- **Reach:** Runs on every authenticated /scanner render; feeds Scanner status, Automatic records, scan history, the teaching desk, active rules, and Wire/Asks moderation.
- **Does:** Loads the newest-20 source-signal window, newest-10 run history, active run, latest real run, latest successful find, rejected candidates, active feedback rules, observations, and their decision ids. Candidate/rule/observation compatibility paths have narrow rolling-migration fallbacks and hard failures for unrelated errors; five earlier signal/run reads do not.
- **Backing:** tests/queriesAdminCompatibility.test.ts:108; reader src/lib/queries.ts (getAutomationAdminData)
- **Inputs:** None (server read).
- **Writes:** read-only
- **Guard:** Page-level isAdmin on /scanner selects the operator view without redirecting the public route. Paired E2E cases in tests/e2e/public-visual.spec.ts:871 and :930 pin the public/operator split and the absence of private operator data from public HTML.
- **Revalidates:** none
- **On failure:** PINNED: unrelated candidate/rule/observation failures throw with named messages — "rejected candidates read failed:", "scanner feedback rules read failed:", "observations read failed:". PINNED: only the named missing-schema cases degrade, with capability flags preventing false claims. NOT PINNED and currently unsafe: errors from `source_signals`, newest-10 `automation_runs`, active-run, latest-real-run, and latest-find are discarded; they normalize to `[]`/`null`, can empty Records/history, and allow `scannerStatus` to default to green `ACTIVE`.
- **Tests:** Current coverage retries a legacy rejected-candidate projection and normalizes feedback fields; surfaces unrelated candidate/rule/observation failures; pins only named missing-schema degradation; filters decided and rescued candidates before the thirty-row window; and scopes the decision lookup to listed observations. Phase 4 must additionally force each of the five discarded signal/run read failures and prove that none can produce green `ACTIVE`, a clear Action inbox, or an ordinary empty Records/history state.
- **Quirks:** Pins query shape, not active-rule completeness. (1) tests/queriesAdminCompatibility.test.ts:189 asserts only that the feedback-rules query has no literal `limit(50)`; the query still lacks count/range pagination and can stop at the hosted PostgREST row cap. The scanner-enforcement reader has the same gap. Both currently order only by non-unique `created_at`; complete paging must use `created_at DESC, id DESC` (or an equivalent unique cursor), prove a tied-timestamp page boundary, and return an exact admin total before the UI can claim every rule has a recovery path. (2) :203 asserts decided/rescued candidates are filtered BEFORE the limit:30 window, verified by comparing operation indexes — reordering the query builder silently fills the desk with already-handled rows. (3) :258 asserts the decision lookup is scoped by `in:observation_id:` to exactly the observations being rendered. (4) `getAutomationControlState` already throws on a settings read error; do not replace that hard failure while fixing the five silent reads.

#### `admin-scanner-view-budget-form-bounds` — Monthly LLM cap ($) input bounds

- **Kind:** text-input · **Destructive:** none
- **Reach:** /scanner (admin view) > Scanner cadence and budget > number input (src/components/scanner/AdminScannerView.tsx:612)
- **Does:** Constrains the operator's LLM spend entry at the browser level to match the server clamp.
- **Backing:** tests/adminScannerView.test.ts:36; input src/components/scanner/AdminScannerView.tsx:612
- **Inputs:** PINNED: the element named monthlyLlmUsdCap has min="0" and max="2". NOT PINNED: step="0.25", or the monthlyTavilyCreditCap input's min/max/step.
- **Writes:** nothing directly — submits through set-scanner-policy-save-settings
- **Guard:** Client-side only; the authoritative clamp is server-side (pinned separately at tests/adminActions.test.ts:499).
- **Revalidates:** —
- **On failure:** n/a — native validation blocks submit.
- **Tests:** keeps the owner-approved two-dollar LLM cap inside native form validation
- **Quirks:** Pins the CONTRACT of a UI attribute. docs/OPERATIONS.md:74 states the policy this enforces: high-value provider usage is "capped at `$2` per UTC month", and docs/NEXT-STEPS.md:36 says do not "silently raise the Tavily or OpenRouter caps". Note the test reaches into the React element tree by prop name, so a redesign that swaps this number input for a slider or a segmented control breaks the test even if the $2 ceiling is preserved.

#### `admin-scanner-view-desk-rendering` — (automatic) teaching-desk and Wire/Asks rendering contract

- **Kind:** automatic · **Destructive:** none
- **Reach:** /scanner (admin view) > teaching desk, kept-leads list, and "Wire and Asks on the Brief" section
- **Does:** Determines which actions each row gets, whether relative times are stable across hydration, and whether learning controls appear at all.
- **Backing:** tests/adminScannerView.test.ts:68, :103, :203, :264; components src/components/scanner/AdminScannerView.tsx and ScannerFeedbackDesk.tsx
- **Inputs:** PINNED props: observationModerationAvailable and feedbackLearningAvailable gate whole action sets; nowIso freezes relative time.
- **Writes:** read-only rendering
- **Guard:** Page-level admin gate — not pinned here.
- **Revalidates:** —
- **On failure:** PINNED: with feedbackLearningAvailable=false the view shows "Scanner learning unlocks after the database schema update", keeps "Keep as relevant", and renders NO "Reject and teach", NO "Remove bad lead", NO "Remove lead and teach scanner" (tests/adminScannerView.test.ts:264).
- **Tests:** freezes teaching-desk relative times at the server-captured instant; keeps every retained lead returned inside the newest-20 query window reachable and gives each one an explicit teaching action; gives each public context item in the rendered observation window one explicit action and hidden items an undo; hides scanner-learning actions until the feedback schema is available
- **Quirks:** Pins COPY as much as contract — literal strings asserted include "discovered 30m ago", "Expires in 2h", "Browse 2 older leads", "Wire and Asks on the Brief", "Reject and teach…" (note the ellipsis CHARACTER, not three dots), "Undo — restore item and revoke rule", "no source date — never shown publicly", and "Scanner learning unlocks after the database schema update". Any copy pass over the scanner desk breaks these. Two structural invariants a redesign must keep: (a) a hidden observation offers Undo and must NOT re-offer a reject — asserted by counting split segments (tests/adminScannerView.test.ts:261); (b) nowIso must be passed down, because the test proves server and hydration markup are byte-identical an hour apart — reintroducing Date.now() inside the component reintroduces a hydration mismatch.

#### `lifecycle-labels-and-maintainer-lock` — Lifecycle status labels + "Locked by you" semantics

- **Kind:** automatic · **Destructive:** none
- **Reach:** /admin > Lifecycle exceptions (label text and MAINTAINER LOCK badge, src/app/admin/page.tsx:191-193) and the Lock select options (:202-208)
- **Does:** Supplies the four operator-visible status words and defines what an admin override does to the engine's reading.
- **Backing:** tests/lifecycle.test.ts:18; source src/lib/lifecycle.ts
- **Inputs:** PINNED: LIFECYCLE_LABELS maps reported->"Open", fix_claimed->"Fix claimed — unverified", verified_fixed->"Marked fixed by maintainer", persists->"Still happening".
- **Writes:** read-only computation; its outputs are what set-cluster-fix-status persists
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** PINNED: with adminOverride true the engine still computes the system reading and exposes it in detail ("System would show: Fix claimed — unverified.") but writes no claim clock and sets primaryLabel "Locked by you".
- **Tests:** labels statuses for admin surfaces without a green silence verdict; keeps admin overrides locked while exposing the system read; normalizes legacy acknowledged rows to reported when no claim exists; never ages a claimed fix by silence — 30 quiet days stay fix_claimed; does not carry an older hotfix claim into the current patch
- **Quirks:** Pins the COPY hard — four exact label strings, and set-cluster-fix-status-lock's write assertion embeds one of them, so a single label rename fails two test files. Contract half: an override must never destroy the system's opinion, only mask it. Dead-state coupling: src/app/admin/page.tsx:21-22 excludes "acknowledged" from the Lock menu because no rule produces it, and tests/lifecycle.test.ts:100 pins that a legacy acknowledged row normalizes to reported — but the SERVER action still accepts "acknowledged" because FIX_STATUSES contains it. A redesign that regenerates the menu from FIX_STATUSES resurrects a dead option.

#### `auto-moderation-queue-fill` — (automatic) what lands in the Flagged for review queue

- **Kind:** automatic · **Destructive:** none
- **Reach:** Upstream of /admin > Flagged for review; determines whether a report auto-approves, waits for the operator, or is dropped as spam
- **Does:** Classifies each incoming report, builds an enum-only public summary, matches it to a same-category cluster, and decides approved / pending / spam.
- **Backing:** tests/moderation.test.ts:51; source src/lib/moderation.ts
- **Inputs:** PINNED: personal-data detection flags emails and phone-shaped tokens to pending but must NOT flag driver versions, frame timings, or save IDs; spam heuristics drop obvious spam with publicSummary null; matchCluster never crosses categories.
- **Writes:** read-only decision object; the caller persists bug_reports.moderation_status
- **Guard:** PINNED privacy boundary: neutralSummary is built only from enums and never echoes the raw title/description (tests/moderation.test.ts:28).
- **Revalidates:** —
- **On failure:** PINNED: when a report is flagged for personal data, the AI lane is never called (fetcher not invoked) and aiUsed stays false.
- **Tests:** is built only from enums, never the raw title/description; links a report to a same-category cluster by shared keywords; does not cross categories; auto-approves a clean report with a neutral summary and no AI; does not flag driver versions, frame timings, or save IDs as personal data; flags phone-shaped tokens as personal data; flags reports with personal data for review instead of publishing; filters obvious spam and publishes nothing; uses a zero-price private route and ignores charged AI moderation
- **Quirks:** Pins the CONTRACT of the queue's INPUT, which is why the /admin queue is usually empty — a redesign of the review UI cannot be judged against a full queue unless it seeds flagged reports. tests/moderation.test.ts:120 pins the provider body verbatim (require_parameters, data_collection:"deny", zdr:true, max_price all zeros) — a paid moderation lane is not merely discouraged, it is asserted against. The /admin page's four stat cells (Needs you / Auto-sorted / Flagged / Filtered as spam) read the three moderation_status buckets this produces, and have NO test of their own.

#### `scanner-feedback-rule-enforcement` — (automatic) what a learned rule actually blocks

- **Kind:** automatic · **Destructive:** none
- **Reach:** Downstream of every teach control; determines whether the operator's lesson has any effect
- **Does:** Derives the stored scope value from a candidate and decides which rule wins when several match.
- **Backing:** tests/scannerFeedback.test.ts:23; source src/lib/automation/feedback.ts
- **Inputs:** PINNED: exact_url strips query/trailing slash; source_path collapses to reddit.com/r/<sub> or registrable-domain/first-two-path-segments; source_domain collapses to the registrable domain (example.co.uk, not support.example.co.uk).
- **Writes:** read-only matching
- **Guard:** n/a
- **Revalidates:** —
- **On failure:** PINNED: expired rules (expiresAt past) and revoked rules (revokedAt set) are ignored — so Undo genuinely restores discovery.
- **Tests:** normalizes Reddit rules to an explicit subreddit scope; derives exact, path, and domain values from the candidate; shows and stores one registrable scope for multi-part domains; matches an exact URL block deterministically; lets a newer exact allow supersede an older exact block; prefers an exact decision over a broader domain rule; ignores expired and undone rules
- **Quirks:** Pins the CONTRACT, and it is the precedence rules that a redesign will get wrong: specificity beats recency (an OLDER exact allow beats a NEWER domain block, tests/scannerFeedback.test.ts:79), but within the same scope recency wins (:62). The UI shows the operator a scope string; that same string is what gets stored and matched — a redesign that displays a friendlier scope label than the stored value breaks the operator's mental model without failing a test.

#### `e2e-admin-auth-routing` — Footer Admin button -> sign-in dialog -> /admin -> Sign out

- **Kind:** nav · **Destructive:** reversible
- **Reach:** Public footer (any page) > "Admin" button; operator nav > "Sign out" (src/components/dispatch/Chrome.tsx:201-204)
- **Does:** Routes an unauthenticated operator through a password dialog into /admin, and signs them back out to /admin/login.
- **Backing:** tests/e2e/public-visual.spec.ts:1020 ("admin footer routes through sign-in to the admin page")
- **Inputs:** PINNED: the field is labelled exactly "Admin password"; the dialog has "Sign in" and "Cancel" buttons; the nav control is labelled exactly "Sign out".
- **Writes:** cd_admin cookie set on sign-in, cleared by signOutAdmin (src/app/admin/actions.ts:39-43)
- **Guard:** PINNED end-to-end: after Sign out, both a footer activation and a direct page.goto("/admin") land on /admin/login — the requireAdmin redirect is verified here and NOWHERE ELSE in the suite.
- **Revalidates:** —
- **On failure:** PINNED: Cancel closes the dialog with no navigation. PINNED: exactly one /api/admin/status request per activation even when it takes 1.5s.
- **Tests:** admin footer routes through sign-in to the admin page
- **Quirks:** Pins CONTRACT and COPY together. It proves the page-level redirect and end-to-end session route; tests/adminActionsAuth.test.ts separately pins every guarded server action, and tests/adminGuard.test.ts pins the real missing/forged/expired/missing-secret rejection logic. The test uses keyboard activation deliberately (comment at :1027-1029: mobile emulation skews click coordinates at page bottom) — a redesign that moves the entry point out of the footer should keep that in mind. Note the sign-out button is a submit inside a form with display:contents, styled as a nav link: it LOOKS like navigation and IS a mutation.

#### `e2e-operator-console-render` — /admin and /admin/compile operator chrome (visual + structural)

- **Kind:** route · **Destructive:** none
- **Reach:** /admin (Report review) and /admin/compile (Compile Pearl Abyss dossier)
- **Does:** Pins the operator console's visible structure: queue heading, the three moderation buttons, the three disclosure sections, the visibility ledger's contents, the override-create search flow, and the compile page's controls.
- **Backing:** tests/e2e/public-visual.spec.ts:970 ("operator report review and compile surfaces wear the console chrome")
- **Inputs:** PINNED: the override-create searchbox is labelled "Issue title", typing "FPS regression" yields "1 matching issues." and reveals exactly one .override-create form.
- **Writes:** none — this test only reads and screenshots
- **Guard:** Signs in via POST /api/admin/login before navigating.
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** operator report review and compile surfaces wear the console chrome
- **Quirks:** Pins COPY and LAYOUT, plus two full-page screenshots (admin-review.png, admin-compile.png) — ANY visual change to /admin or /admin/compile fails this test until the baselines are regenerated. Structural facts a redesign must preserve: the visibility ledger is a <details> that starts CLOSED and must be clicked open; VisibilityOverrideBrowser deliberately renders NO cluster rows until the operator searches (asserted by toHaveCount(0) then 1 at :999-1003) — a redesign that lists all clusters upfront breaks a deliberate anti-dropdown-farm decision; "Lifecycle exceptions", "Visibility overrides", and "Current patch override" must all remain present. Desktop-only: the test skips on non-chromium projects (:971, "Operator surfaces are desktop-first"). /admin/compile has visual/render coverage here and an unauthenticated stop-before-work assertion in tests/adminActionsAuth.test.ts; its authorized success behavior remains untested.

#### `e2e-admin-scanner-desk` — /scanner operator view (radar desk structure and search)

- **Kind:** route · **Destructive:** none
- **Reach:** /scanner while authenticated
- **Does:** Pins the operator radar desk's sections, the optional-review search box, and the public/operator data boundary.
- **Backing:** tests/e2e/public-visual.spec.ts:930 ("admin scanner leads with Source Radar and useful kept-signal links")
- **Inputs:** PINNED: a searchbox labelled "Search optional scanner review"; typing "not sortable into a bug area" narrows to matching rows and shows "2 matches".
- **Writes:** none — reads and screenshots (scanner-admin.png)
- **Guard:** Signs in via POST /api/admin/login first; the companion test at :871 pins that the PUBLIC view exposes none of this.
- **Revalidates:** —
- **On failure:** n/a
- **Tests:** admin scanner leads with Source Radar and useful kept-signal links; public scanner shows Source Radar without admin data
- **Quirks:** Pins COPY and structure: "Today's radar desk", "Operator · The Observatory", "Action inbox", "Nothing requires intervention.", "Review the pattern, not a dropdown farm.", "What the scanner kept", "Keep as relevant", "Reject and teach…", "Scan history and diagnostics", "Scanner cadence and budget", "What the scanner will remember". Also pinned: "Raw funnel, skip, and error codes" must be HIDDEN (collapsed) on load, and "Reddit API OFF"/"Steam & forums" must NOT appear. The privacy boundary is pinned from the public side by raw-HTML string absence (:915-919) — a redesign that renders operator data into the DOM and hides it with CSS fails that companion test. The scan-run buttons themselves ("Run capped scan now") are NOT asserted anywhere in this test.

**Surface notes.**

AUTH COVERAGE: `tests/adminActionsAuth.test.ts` covers all 13 guarded action paths, including runRedditMonitor and the delegating rescueRejectedCandidate path. Each call uses a valid mutation-shaped payload and must reject before DB, RPC, external, or revalidation work; the export-set assertion makes a newly exported action fail the suite until it is covered or deliberately exempted. `tests/adminGuard.test.ts` separately pins real missing, forged, expired, and missing-secret rejection. signOutAdmin is deliberately excluded from authentication and is pinned at `tests/adminActionsAuth.test.ts:188-204` as DB-free, cookie-clearing, and redirecting to `/admin/login`. This is unauthenticated-boundary coverage, not proof of every authorized success path or preview-guard branch.

OPERATOR-WRITE E2E: `tests/e2e/operator-writes.spec.ts` submits observation reject/card Undo and verifies public Ask removal/restoration (:57-96); candidate reject/rule Undo and candidate return (:99-119); Keep/rescue plus the deliberately non-reversible lesson Undo boundary (:122-170); force-hidden/Reset with public-board effects (:173-217); and current-patch override with public propagation and seed restoration (:220-250).

REMAINING HIGH-VALUE GAPS:

- compileDossier's authorized Supabase reads, assembly, insert, redirect, AI fallback, and `use_ai` behavior remain untested; the builder and auth boundary are covered. The existing AI unit pins free-provider routing but not a representative complete user message containing private approved-report issue titles/repro/evidence fields plus unpublished cluster title/status/confidence, unchecked/disabled no-call paths, bounded timeout, structural tamper rejection, or the adjacent complete-field disclosure.
- CompilePage has no forced-failure proof for either the newest-10 run list or the selected `?run` read; both currently discard errors and counterfeit normal empty/no-selection state.
- On this branch, GET `/api/admin/export` still lacks route/E2E coverage despite exposing the fixed private 22-field allowlist; `tests/csv.test.ts` covers only serialization.
- Valid login POST is exercised by E2E, but invalid JSON, invalid credentials, the delay, cookie attributes, DELETE, and full-page LoginForm client behavior lack focused route tests.
- ScanControls' buttons, polling loop, four-failure tolerance, refresh-on-completion, and 401 recovery remain untested at the client layer even though the API routes are well covered.
- `getAutomationAdminData` has no forced-failure proof for its source-signal window, newest-10 runs, active run, latest real run, or latest find; all five currently discard errors and can counterfeit green/empty Scanner state.
- `getPublicScannerDataUncached` has no forced-failure/UI proof that its component errors or broad catch cannot become an ordinary all-zero operator scoreboard and erase `llmPaused`; `AdminScannerView` does not consume `scannerConnected`.
- Keep/rescue tests pin ordering and zero/one-generation mechanics separately, but no exact provider-body regression pins candidate title/snippet/canonicalized source URL plus unpublished cluster slugs/titles, no test requires ZDR on automation routing, and the live copy still overstates a provider generation as unconditional. Cost-audit tests pin their ID-only request and retry boundary separately.
- Current-patch tests do not distinguish manual database rows from official rows, reject hardcoded fallback for claim-bearing Lock/Dossier compile, or prevent a fresh manual row from activating official-patch burst scheduling.
- Report Review has no state-label proof preventing approved/spam counters or flagged-card copy from inventing automation provenance the schema does not retain.
- Observation happy-path/Undo and auth are covered; invalid input, already-hidden refusal, exact RPC arguments, and missing-migration/error branches remain unpinned.
- CopyDossierButton/DossierOutput behavior, `/admin/source-monitor` redirect, and the stat-band formula lack focused behavior tests.

DEAD OR UNREACHABLE BUT TESTED: setAutomationPaused has no component caller; rescueRejectedCandidate is reachable only through unmounted RejectedArchive; runRedditMonitor is a policy tripwire with no caller; revalidations still target the redirect-only `/admin/source-monitor`; and `acknowledged` remains server-accepted but absent from the lock menu.

OTHER SAFETY CONSTRAINTS: revalidatePublicSurfaces swallows cache errors, so cache-refresh regressions remain silent. Operations fixes the workflow order and treats exception controls as break-glass. Publishing remains an explicit moderation decision, not a discovery side effect. Provider caps and Reddit-off policy are not emergency knobs. `/scanner` must preserve its public/operator boundary, and raw reports, rejected candidates, hashes, identities, and private moderation detail must never enter public output. The run ledger remains the monitoring story, and the current shared-password model deliberately carries no per-user identity.
