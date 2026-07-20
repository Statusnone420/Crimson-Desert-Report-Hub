/**
 * Deterministic preview-seed generator for the local "invented database".
 *
 * Writes preview-data/seed.json (repo-ignored) in the exact production row
 * shapes the app reads, so anything previewed with `npm run dev:preview`
 * reproduces once the live scanner writes the same shapes. No hand-faked
 * counts: every aggregate the site shows is derived from these rows by the
 * same code paths that run in production.
 *
 * Usage:
 *   node scripts/generate-preview-seed.mjs [--leads 44] [--reports 1] [--taps 5]
 *     [--days 14] [--patch 1.14.00] [--seed 42] [--out preview-data/seed.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (key?.startsWith("--")) args.set(key.slice(2), process.argv[i + 1]);
}
const intArg = (name, fallback) => {
  const value = Number.parseInt(args.get(name) ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const LEADS = intArg("leads", 44);
const REPORTS = intArg("reports", 1);
const TAPS = intArg("taps", 5);
const DAYS = Math.max(2, intArg("days", 14));
const SEED = intArg("seed", 42);
const PATCH = args.get("patch") ?? "1.14.00";
const OUT = args.get("out") ?? path.join("preview-data", "seed.json");

// Deterministic PRNG: same --seed, same relative dataset.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (items) => items[Math.floor(rand() * items.length)];
const weighted = (entries) => {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const nowMs = Date.now();
const patchPublishedMs = nowMs - (DAYS - 1) * DAY_MS;
const family = PATCH.split(".").slice(0, 2).map(Number).join(".");
const iso = (ms) => new Date(ms).toISOString();
const uuid = (prefix, index) =>
  `00000000-0000-4000-9000-${(prefix * 100000 + index).toString().padStart(12, "0")}`;

// Distributions modeled on the live 2026-07-19 snapshot (re-queryable):
// domains reddit-heavy, categories performance/crash/controls-heavy,
// seen_count a long tail with a few strong recurrers.
const DOMAINS = [
  ["reddit.com", 23],
  ["steamcommunity.com", 9],
  ["facebook.com", 6],
  ["youtube.com", 2],
  ["instagram.com", 2],
  ["dsogaming.com", 1],
  ["keengamer.com", 1],
  ["nexusmods.com", 1],
];
const CATEGORIES = [
  ["performance", 15],
  ["crash_startup", 11],
  ["controls_gameplay", 10],
  ["graphics_visual", 3],
  ["quest_progression", 3],
  ["other", 2],
];
const PLATFORMS = ["pc_steam", "ps5", "ps5_pro", "xbox_series_x", "xbox_series_s"];
const SYMPTOMS = {
  performance: ["FPS drops in open-field combat", "stutter in crowded areas", "frame pacing feels off"],
  crash_startup: ["crash on startup", "client freezes on the loading screen", "hard crash mid-quest"],
  controls_gameplay: ["mount controls stop responding", "input lockup after cutscenes", "camera stuck after dialogue"],
  graphics_visual: ["ghosting with upscaling enabled", "flickering shadows", "texture pop-in"],
  quest_progression: ["quest objective will not advance", "NPC never spawns", "progress flag stuck"],
  other: ["settings reset on restart", "photo mode exports fail"],
};

// Public seeded clusters (routable) + private auto-clusters that hold leads.
const publicClusterDefs = [
  ["fps-performance-regression", "FPS / performance regression", "performance"],
  ["crashes-and-startup-hangs", "Crashes and startup hangs", "crash_startup"],
  ["mount-input-lockups", "Mount, input, and title-screen lockups", "controls_gameplay"],
  ["upscaler-ghosting", "Upscaler ghosting and visual artifacts", "graphics_visual"],
  ["quest-progression-blocks", "Quest progression blockers", "quest_progression"],
];
const clusters = publicClusterDefs.map(([slug, title, category], index) => ({
  id: uuid(1, index),
  slug,
  title,
  category,
  description: `Watchlist item for ${title.toLowerCase()} after patch ${PATCH}. It remains unverified until approved reports or public signals confirm it.`,
  fix_status: "reported",
  confidence: "seed_unverified",
  is_public: true,
}));
const autoClusterCount = Math.max(1, Math.round(LEADS / 2.5));
for (let i = 0; i < autoClusterCount; i += 1) {
  clusters.push({
    id: uuid(2, i),
    slug: `auto-preview-${i.toString(16).padStart(4, "0")}`,
    title: `Auto cluster ${i + 1} (private)`,
    category: weighted(CATEGORIES),
    description: "Scanner-created private cluster.",
    fix_status: "reported",
    confidence: "low",
    is_public: false,
  });
}

// Leads: first_seen spread over the window with a fresher tail (radar busier
// as chatter accumulates), long-tail seen_count, mostly private.
const signals = [];
for (let i = 0; i < LEADS; i += 1) {
  const category = weighted(CATEGORIES);
  const domain = weighted(DOMAINS);
  const symptom = pick(SYMPTOMS[category] ?? SYMPTOMS.other);
  const ageDays = Math.floor(Math.pow(rand(), 1.4) * DAYS); // biased recent
  const firstSeenMs = nowMs - ageDays * DAY_MS - Math.floor(rand() * 20 * 60 * 60 * 1000);
  const seenCount = weighted([
    [1, 26],
    [2, 7],
    [3, 1],
    [5, 4],
    [6, 3],
    [7, 1],
    [9, 1],
    [18, 1],
  ]);
  const lastSeenMs =
    seenCount > 1 ? firstSeenMs + Math.floor(rand() * Math.max(1, nowMs - firstSeenMs)) : firstSeenMs;
  const status = weighted([
    ["private", 28],
    ["hidden", 14],
    ["public", 2],
  ]);
  const cluster = status === "public" ? clusters[i % publicClusterDefs.length] : pick(clusters);
  signals.push({
    id: uuid(3, i),
    source: "web_search",
    source_type: "web_search",
    source_url: `https://${domain}/preview/${PATCH.replaceAll(".", "-")}/thread-${i}`,
    canonical_url: `https://${domain}/preview/${PATCH.replaceAll(".", "-")}/thread-${i}`,
    title: `${symptom} since patch ${PATCH}`,
    source_domain: domain,
    semantic_fingerprint: `preview-${category}-${i}`,
    cluster_id: cluster.id,
    public_status: status,
    summary: `User reports ${symptom} after patch ${PATCH}.`,
    category,
    confidence: weighted([
      ["medium", 6],
      ["high", 2],
      ["low", 2],
    ]),
    observed_at: iso(lastSeenMs),
    // Truthful to production: Tavily general search rarely supplies dates.
    source_published_at: null,
    first_seen_at: iso(firstSeenMs),
    last_seen_at: iso(lastSeenMs),
    seen_count: seenCount,
    extracted_facts: rand() < 0.4 ? { issueTitle: symptom, platform: pick(PLATFORMS) } : {},
  });
}

// Runs: derived FROM the leads so per-day chart bars always reconcile with
// the rows above (kept = leads first seen that day; reobserved = later-seen).
const keptByDay = new Map();
const reobsByDay = new Map();
const dayKey = (ms) => iso(ms).slice(0, 10);
for (const signal of signals) {
  const firstDay = dayKey(new Date(signal.first_seen_at).getTime());
  keptByDay.set(firstDay, (keptByDay.get(firstDay) ?? 0) + 1);
  for (let repeat = 1; repeat < signal.seen_count; repeat += 1) {
    const firstMs = new Date(signal.first_seen_at).getTime();
    const lastMs = new Date(signal.last_seen_at).getTime();
    const repeatMs = firstMs + ((lastMs - firstMs) * repeat) / Math.max(1, signal.seen_count - 1);
    const key = dayKey(repeatMs);
    reobsByDay.set(key, (reobsByDay.get(key) ?? 0) + 1);
  }
}
const runs = [];
let runIndex = 0;
for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
  const dayStartMs = nowMs - dayOffset * DAY_MS;
  const key = dayKey(dayStartMs);
  const kept = keptByDay.get(key) ?? 0;
  const reobserved = reobsByDay.get(key) ?? 0;
  const activeRuns = Math.max(1, Math.min(3, kept + (reobserved > 0 ? 1 : 0)));
  let keptLeft = kept;
  let reobsLeft = reobserved;
  for (let r = 0; r < activeRuns; r += 1) {
    const keptHere = r === activeRuns - 1 ? keptLeft : Math.floor(keptLeft / (activeRuns - r));
    const reobsHere = r === activeRuns - 1 ? reobsLeft : Math.floor(reobsLeft / (activeRuns - r));
    keptLeft -= keptHere;
    reobsLeft -= reobsHere;
    const resultsSeen = keptHere + reobsHere + Math.floor(rand() * 6);
    const startedMs = dayStartMs - (23 - r * 7) * 60 * 60 * 1000 * (rand() * 0.2 + 0.8);
    runs.push({
      id: uuid(4, runIndex++),
      started_at: iso(startedMs),
      finished_at: iso(startedMs + 40_000),
      status: "success",
      mode: "scheduled",
      budget_monthly_usd: 5,
      budget_remaining_before_usd: 4.5,
      estimated_cost_usd: resultsSeen > 0 ? 0.02 : 0.01,
      reddit_posts_seen: 0,
      search_queries_used: 1,
      search_results_seen: resultsSeen,
      llm_calls_used: Math.min(8, resultsSeen),
      signals_inserted: keptHere,
      signals_deduped: Math.floor(rand() * 3),
      signals_reobserved: reobsHere,
      stale_signals_hidden: 0,
      candidates_rescued: 0,
      clusters_promoted: 0,
      intent: "broad_discovery",
      skips: ["reddit_disabled"],
      errors: [],
      funnel: {
        searchResultsSeen: resultsSeen,
        candidatesSeen: resultsSeen,
        deduped: 0,
        prefilterRejected: Math.max(0, resultsSeen - keptHere - reobsHere),
        llmEligible: keptHere + reobsHere,
        llmCalls: Math.min(8, resultsSeen),
        kept: keptHere,
        promoted: 0,
      },
    });
  }
  // Hourly skipped heartbeats keep run-history realism without noise.
  runs.push({
    id: uuid(4, runIndex++),
    started_at: iso(dayStartMs - 5 * 60 * 60 * 1000),
    finished_at: iso(dayStartMs - 5 * 60 * 60 * 1000),
    status: "skipped",
    mode: "scheduled",
    budget_monthly_usd: 5,
    budget_remaining_before_usd: 4.5,
    estimated_cost_usd: 0,
    reddit_posts_seen: 0,
    search_queries_used: 0,
    search_results_seen: 0,
    llm_calls_used: 0,
    signals_inserted: 0,
    signals_deduped: 0,
    signals_reobserved: 0,
    stale_signals_hidden: 0,
    candidates_rescued: 0,
    clusters_promoted: 0,
    intent: null,
    skips: ["recent_run"],
    errors: [],
    funnel: {},
  });
}

// Rejected candidates: reason mix from the live snapshot.
const rejectedCandidates = [];
for (let i = 0; i < 30; i += 1) {
  const domain = weighted(DOMAINS);
  rejectedCandidates.push({
    id: uuid(5, i),
    title: `Off-topic community thread ${i + 1}`,
    url: `https://${domain}/preview/rejected/${i}`,
    source_domain: domain,
    source_published_at: null,
    reason: weighted([
      ["source_not_issue_report", 218],
      ["category_other", 36],
      ["wrong_patch", 5],
    ]),
    created_at: iso(nowMs - Math.floor(rand() * 3 * DAY_MS)),
    expires_at: iso(nowMs + 6 * DAY_MS),
    rescued_at: null,
  });
}

// Player evidence layer — kept deliberately small/independent of leads.
const bugReports = [];
for (let i = 0; i < REPORTS; i += 1) {
  const cluster = clusters[i % publicClusterDefs.length];
  bugReports.push({
    id: uuid(6, i),
    created_at: iso(nowMs - Math.floor(rand() * (DAYS - 1) * DAY_MS)),
    patch_version: PATCH,
    platform: pick(PLATFORMS),
    category: cluster.category,
    severity: pick(["medium", "high"]),
    frequency: pick(["sometimes", "often"]),
    issue_title: `${cluster.title} report ${i + 1}`,
    description: "Structured preview report (raw text stays private).",
    moderation_status: "approved",
    cluster_id: cluster.id,
    duplicate_fingerprint: `preview-report-${i}`,
    official_report_submitted: false,
  });
}
const issueConfirmations = [];
for (let i = 0; i < TAPS; i += 1) {
  const cluster = clusters[i % publicClusterDefs.length];
  issueConfirmations.push({
    id: uuid(7, i),
    created_at: iso(nowMs - Math.floor(rand() * (DAYS - 1) * DAY_MS)),
    cluster_id: cluster.id,
    patch_family: family,
    patch_version: PATCH,
    platform: pick(PLATFORMS),
    kind: weighted([
      ["have_it", 3],
      ["still_happening", 1],
      ["fixed_for_me", 1],
    ]),
    voter_ip_hash: `preview-voter-${i}`,
  });
}

const boardNo = "205";
const seed = {
  issue_clusters: clusters,
  source_signals: signals,
  automation_runs: runs,
  automation_rejected_candidates: rejectedCandidates,
  bug_reports: bugReports,
  approved_excerpts: [],
  issue_confirmations: issueConfirmations,
  automation_settings: [{ key: "scanner", value: { paused: false }, updated_at: iso(nowMs - 60 * 60 * 1000) }],
  official_patch_notes: [
    {
      id: "preview-patch-note",
      board_no: boardNo,
      title: `Patch Notes Version ${PATCH}`,
      patch_version: PATCH,
      official_url: `https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=${boardNo}`,
      published_at: iso(patchPublishedMs),
      summary: "Preview seed patch metadata.",
      observed_at: iso(nowMs - 40 * 60 * 1000),
      is_current: true,
    },
  ],
  official_patch_claimed_fixes: [
    ["Fixed an issue where the motion of a character on a mount could appear unnatural.", "controls_gameplay"],
    ["Fixed an issue where sound effects would not play after certain battles.", null],
    ["Fixed an issue where performance could drop in crowded areas.", "performance"],
    ["Fixed various localization errors across all languages.", null],
  ].map(([fix_text, category], position) => ({ board_no: boardNo, position, fix_text, category })),
  patch_observations: [
    {
      id: "preview-observation-1",
      created_at: iso(nowMs - 8 * 60 * 60 * 1000),
      patch_version: PATCH,
      kind: "patch_release",
      title: `Patch Notes Version ${PATCH} — official release thread`,
      url: "https://www.reddit.com/r/CrimsonDesert/comments/preview-release/",
      url_hash: "preview-observation-hash-1",
      source_domain: "reddit.com",
      snippet: `Pearl Abyss has published the ${PATCH} patch notes.`,
      source_published_at: null,
      observed_at: iso(nowMs - 8 * 60 * 60 * 1000),
      last_seen_at: iso(nowMs - 60 * 60 * 1000),
      seen_count: 7,
      is_public: true,
    },
  ],
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(seed, null, 2)}\n`);
console.log(
  `[preview-seed] wrote ${OUT}: ${LEADS} leads, ${runs.length} runs, ${REPORTS} reports, ${TAPS} taps, patch ${PATCH}, ${DAYS}d window, seed ${SEED}`,
);
