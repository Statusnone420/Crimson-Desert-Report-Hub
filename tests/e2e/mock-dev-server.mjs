import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

// A previous `next dev` session against different Supabase data can leave stale
// unstable_cache entries. Match next.config.ts so each isolated test build
// clears only its own cache under this repository.
const distDir = process.env.CD_LOCAL_SNAPSHOT === "true"
  ? ".next-snapshot"
  : process.env.CD_REVIEW_BUILD === "true"
    ? ".next-review"
    : ".next";
rmSync(path.join(process.cwd(), distDir, "cache"), { recursive: true, force: true });
rmSync(path.join(process.cwd(), distDir, "dev", "cache"), { recursive: true, force: true });

const appPort = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const supabasePort = Number(process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765);

// Keep the mock data on the same side of the UTC week boundary as the visual
// baselines. The application and browser receive the same clock via the
// freeze-time preload below, so relative labels and weekly sections cannot
// disappear merely because CI started a few minutes later.
const fixtureNowIso = process.env.PLAYWRIGHT_NOW ?? "2026-07-20T00:10:00.000Z";
const fixtureNowMs = Date.parse(fixtureNowIso);
if (!Number.isFinite(fixtureNowMs)) throw new Error(`Invalid PLAYWRIGHT_NOW: ${fixtureNowIso}`);
const now = () => fixtureNowMs;
const isoMinutesAgo = (minutes) => new Date(now() - minutes * 60 * 1000).toISOString();
const isoDaysAgo = (days) => new Date(now() - days * 24 * 60 * 60 * 1000).toISOString();

const clusterIds = {
  fps: "00000000-0000-4000-8000-000000000001",
  map: "00000000-0000-4000-8000-000000000002",
  mount: "00000000-0000-4000-8000-000000000003",
  ghosting: "00000000-0000-4000-8000-000000000004",
  visibilityOverride: "00000000-0000-4000-8000-000000000005",
};

const clusters = [
  {
    id: clusterIds.fps,
    slug: "fps-regression-113",
    title: "FPS regression since 1.13",
    category: "performance",
    description: "Players report lower frame rate and stutter in open-field combat after patch 1.13.00.",
    fix_status: "reported",
    confidence: "medium",
    is_public: true,
  },
  {
    id: clusterIds.map,
    slug: "map-open-crash-persists",
    title: "Map-open crash persists after fix",
    category: "crash_startup",
    description: "Opening the world map can still crash or freeze the client after the claimed fix.",
    fix_status: "fix_claimed",
    fix_claimed_at: "2026-07-08T06:00:00.000Z",
    fix_claimed_patch_version: "1.13.01",
    confidence: "medium",
    is_public: true,
  },
  {
    id: clusterIds.mount,
    slug: "mount-input-lockups",
    title: "Mount and input lockups",
    category: "controls_gameplay",
    description: "Mount controls can stop responding until players reload or return to title.",
    fix_status: "reported",
    confidence: "low",
    is_public: true,
  },
  {
    id: clusterIds.ghosting,
    slug: "fsr-ghosting",
    title: "FSR ghosting on performance mode",
    category: "graphics_visual",
    description: "Reports mention trailing artifacts and texture shimmer when upscaling is enabled.",
    fix_status: "acknowledged",
    confidence: "low",
    is_public: true,
  },
  {
    id: clusterIds.visibilityOverride,
    slug: "xbox-graphics-duplicate",
    title: "Constant graphics glitches on Xbox since patch 1.13",
    category: "graphics_visual",
    description: "A duplicate cluster held out of public view while its reports are consolidated.",
    fix_status: "reported",
    confidence: "low",
    is_public: false,
    admin_visibility_override: "force_hidden",
    admin_visibility_reason: "Temporary duplicate hold while the Xbox graphics reports are consolidated.",
    admin_visibility_changed_at: isoMinutesAgo(95),
  },
];

const reportSeed = [
  [clusterIds.fps, "performance", "pc_steam", 18],
  [clusterIds.fps, "performance", "pc_steam", 54],
  [clusterIds.fps, "performance", "pc_steam", 90],
  [clusterIds.fps, "performance", "ps5", 160],
  [clusterIds.fps, "performance", "ps5_pro", 260],
  [clusterIds.fps, "performance", "xbox_series_x", 430],
  [clusterIds.map, "crash_startup", "pc_steam", 72],
  [clusterIds.map, "crash_startup", "ps5", 188],
  [clusterIds.map, "crash_startup", "ps5_pro", 610],
  [clusterIds.mount, "controls_gameplay", "ps5", 1440],
  [clusterIds.mount, "controls_gameplay", "xbox_series_x", 2200],
  [clusterIds.ghosting, "graphics_visual", "pc_steam", 3200],
];

const bugReports = reportSeed.map(([clusterId, category, platform, minutes], index) => ({
  id: `report-${index + 1}`,
  created_at: isoMinutesAgo(minutes),
  patch_version: "1.13.00",
  platform,
  category,
  severity: index < 3 ? "high" : "medium",
  frequency: index < 6 ? "often" : "sometimes",
  issue_title: clusters.find((cluster) => cluster.id === clusterId)?.title ?? "Patch issue",
  description: "Mock moderated report used only for Playwright visual tests.",
  repro_steps: "Load into the affected area, repeat the same action, observe the regression.",
  moderation_status: "approved",
  cluster_id: clusterId,
  duplicate_fingerprint: `mock-fingerprint-${index + 1}`,
  submitter_ip_hash: "mock-ip-hash",
}));

bugReports.push({
  id: "report-pending-1",
  created_at: isoMinutesAgo(22),
  patch_version: "1.13.00",
  platform: "pc_steam",
  category: "performance",
  severity: "medium",
  frequency: "often",
  issue_title: "Pending visual test report",
  description: "After 20–30 minutes in open-field combat, frame time spikes and FPS falls from 60 into the low 30s. Restarting the game clears it temporarily.",
  repro_steps: "Load the same save on PC (Steam), ride from the city into open terrain, and continue combat for about 25 minutes.",
  hardware_specs: "Ryzen 7 7800X3D · RTX 4070 Super · 32 GB RAM · driver 576.80",
  evidence_url: "https://video.example.com/private-performance-capture",
  moderation_status: "pending",
  cluster_id: null,
  duplicate_fingerprint: "mock-pending-fingerprint",
  submitter_ip_hash: "mock-ip-hash",
});

const excerpts = [
  {
    id: "excerpt-1",
    created_at: isoMinutesAgo(15),
    excerpt_text: "Performance mode drops into the low 20s during open-field combat after 1.13.",
    bug_reports: { cluster_id: clusterIds.fps, platform: "pc_steam" },
  },
  {
    id: "excerpt-2",
    created_at: isoMinutesAgo(38),
    excerpt_text: "The map crash still happens after the patch note said it was fixed.",
    bug_reports: { cluster_id: clusterIds.map, platform: "ps5" },
  },
  {
    id: "excerpt-3",
    created_at: isoDaysAgo(1),
    excerpt_text: "Horse controls locked until returning to title, then recovered.",
    bug_reports: { cluster_id: clusterIds.mount, platform: "xbox_series_x" },
  },
];

const signals = [
  {
    id: "signal-1",
    source: "reddit",
    source_type: "reddit",
    source_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/fps/",
    canonical_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/fps",
    title: "FPS drops since patch 1.13",
    source_domain: "reddit.com",
    semantic_fingerprint: "mock-fps",
    cluster_id: clusterIds.fps,
    public_status: "public",
    summary: "FPS drops since patch 1.13",
    category: "performance",
    confidence: "medium",
    observed_at: isoMinutesAgo(12),
    source_published_at: isoMinutesAgo(18),
    first_seen_at: isoMinutesAgo(12),
    last_seen_at: isoMinutesAgo(12),
    seen_count: 4,
  },
  {
    id: "signal-2",
    source: "web_search",
    source_type: "web_search",
    source_url: "https://community.example.com/crimson-desert-113-fps",
    canonical_url: "https://community.example.com/crimson-desert-113-fps",
    title: "Crimson Desert patch 1.13 FPS regression",
    source_domain: "community.example.com",
    semantic_fingerprint: "mock-fps",
    cluster_id: clusterIds.fps,
    public_status: "public",
    summary: "Multiple PC players mention stutter and FPS drops after patch 1.13.",
    category: "performance",
    confidence: "high",
    observed_at: isoMinutesAgo(45),
    source_published_at: isoMinutesAgo(50),
    first_seen_at: isoMinutesAgo(45),
    last_seen_at: isoMinutesAgo(45),
    seen_count: 3,
  },
  {
    id: "signal-private-1",
    source: "reddit",
    source_type: "reddit",
    source_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/private/",
    canonical_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/private",
    title: "private low confidence rumor",
    source_domain: "reddit.com",
    semantic_fingerprint: "mock-private",
    cluster_id: "cluster-private",
    public_status: "private",
    summary: "private low confidence signal should stay internal",
    category: "other",
    confidence: "low",
    observed_at: isoMinutesAgo(20),
    source_published_at: isoMinutesAgo(22),
    first_seen_at: isoMinutesAgo(20),
    last_seen_at: isoMinutesAgo(20),
    seen_count: 1,
  },
  {
    id: "signal-private-mapped",
    source: "web_search",
    source_type: "web_search",
    source_url: "https://forum.example.com/crimson-desert/mount-input-rumor",
    canonical_url: "https://forum.example.com/crimson-desert/mount-input-rumor",
    title: "Possible Crimson Desert mount input lockup",
    source_domain: "forum.example.com",
    semantic_fingerprint: "mock-mount-private",
    cluster_id: clusterIds.mount,
    public_status: "private",
    summary: "Private Crimson Desert candidate used to prove public question rendering without exposing the URL.",
    category: "controls_gameplay",
    confidence: "low",
    observed_at: isoDaysAgo(2),
    source_published_at: isoMinutesAgo(25),
    first_seen_at: isoDaysAgo(2),
    last_seen_at: isoMinutesAgo(30 * 60),
    seen_count: 1,
  },
];

const automationRuns = [
  {
    id: "run-1",
    started_at: isoMinutesAgo(30),
    finished_at: isoMinutesAgo(28),
    status: "success",
    mode: "manual",
    budget_monthly_usd: 5,
    budget_remaining_before_usd: 4.92,
    estimated_cost_usd: 0.016,
    reddit_posts_seen: 12,
    search_queries_used: 2,
    search_results_seen: 8,
    llm_calls_used: 0,
    signals_inserted: 2,
    signals_deduped: 1,
    signals_reobserved: 1,
    stale_signals_hidden: 0,
    candidates_rescued: 0,
    clusters_promoted: 1,
    intent: "broad_discovery",
    skips: ["openrouter_missing"],
    errors: [],
    funnel: {
      searchResultsSeen: 8,
      candidatesSeen: 8,
      deduped: 1,
      prefilterRejected: 4,
      llmEligible: 2,
      llmCalls: 0,
      kept: 2,
      promoted: 1,
    },
  },
  {
    id: "run-2",
    started_at: isoDaysAgo(1),
    finished_at: isoDaysAgo(1),
    status: "partial",
    mode: "dry_run",
    budget_monthly_usd: 5,
    budget_remaining_before_usd: 5,
    estimated_cost_usd: 0,
    reddit_posts_seen: 4,
    search_queries_used: 0,
    search_results_seen: 0,
    llm_calls_used: 0,
    signals_inserted: 0,
    signals_deduped: 0,
    signals_reobserved: 0,
    stale_signals_hidden: 0,
    candidates_rescued: 0,
    clusters_promoted: 0,
    intent: "preview",
    skips: ["budget_zero"],
    errors: ["search disabled for dry run fixture"],
    funnel: {
      searchResultsSeen: 0,
      candidatesSeen: 0,
      deduped: 0,
      prefilterRejected: 0,
      llmEligible: 0,
      llmCalls: 0,
      kept: 0,
      promoted: 0,
    },
  },
];

const rejectedCandidates = [
  {
    id: "reject-1",
    title: "Crimson Desert patch 1.13 patch notes repost",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/patch_notes/",
    source_domain: "reddit.com",
    source_published_at: isoMinutesAgo(35),
    reason: "wrong_patch",
    created_at: isoMinutesAgo(10),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-2",
    title: "Base PS5 performance mode drops after update",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/base_ps5_performance/",
    source_domain: "reddit.com",
    source_published_at: isoMinutesAgo(52),
    reason: "source_not_issue_report",
    created_at: isoMinutesAgo(20),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-3",
    title: "Instagram reel about update 1.13 outfits",
    url: "https://www.instagram.com/reel/mock/",
    source_domain: "instagram.com",
    source_published_at: isoMinutesAgo(75),
    reason: "category_other",
    created_at: isoMinutesAgo(30),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-4",
    title: "Crimson Desert boss crash after claimed fix",
    url: "https://community.example.com/crimson-desert-boss-crash",
    source_domain: "community.example.com",
    source_published_at: isoMinutesAgo(95),
    reason: "candidate_recon",
    created_at: isoMinutesAgo(40),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-5",
    title: "YouTube review mentions patch performance",
    url: "https://www.youtube.com/watch?v=mock",
    source_domain: "youtube.com",
    source_published_at: isoMinutesAgo(120),
    reason: "source_not_issue_report",
    created_at: isoMinutesAgo(50),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-6",
    title: "Horse riding controls broke after patch",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/mock/horse_controls/",
    source_domain: "reddit.com",
    source_published_at: isoMinutesAgo(150),
    reason: "candidate_rescued",
    created_at: isoMinutesAgo(60),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-7",
    title: "Patch 1.13 full notes mirror",
    url: "https://mirror.example.com/crimson-desert-113-notes",
    source_domain: "mirror.example.com",
    source_published_at: isoMinutesAgo(170),
    reason: "source_not_issue_report",
    created_at: isoMinutesAgo(70),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
  {
    id: "reject-8",
    title: "New armor set locations guide",
    url: "https://guide.example.com/new-armor-set-locations",
    source_domain: "guide.example.com",
    source_published_at: isoMinutesAgo(190),
    reason: "category_other",
    created_at: isoMinutesAgo(80),
    expires_at: isoDaysAgo(-1),
    rescued_at: null,
  },
];

const automationSettings = [
  {
    key: "scanner",
    value: { paused: false },
    updated_at: isoMinutesAgo(35),
  },
];

// One-tap confirmations: FPS cluster gets escalated "have it" taps; the map cluster's
// claim poll gets a 2-still vs 1-fixed split so the poll strip renders in snapshots.
const issueConfirmations = [
  ["confirm-1", 30, clusterIds.fps, "pc_steam", "have_it", "mock-voter-1"],
  ["confirm-2", 90, clusterIds.fps, "pc_steam", "have_it", "mock-voter-2"],
  ["confirm-3", 200, clusterIds.fps, "ps5", "have_it", "mock-voter-3"],
  ["confirm-4", 45, clusterIds.map, "ps5", "still_happening", "mock-voter-4"],
  ["confirm-5", 50, clusterIds.map, "pc_steam", "still_happening", "mock-voter-5"],
  ["confirm-6", 55, clusterIds.map, "pc_steam", "fixed_for_me", "mock-voter-6"],
].map(([id, minutes, clusterId, platform, kind, hash]) => ({
  id,
  created_at: isoMinutesAgo(minutes),
  cluster_id: clusterId,
  patch_family: "1.13",
  patch_version: "1.13.01",
  platform,
  kind,
  voter_ip_hash: hash,
}));

const officialPatchNotes = [
  {
    id: "official-patch-113",
    board_no: "105",
    title: "Patch Notes Version 1.13.01",
    patch_version: "1.13.01",
    official_url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
    published_at: "2026-07-08T05:51:00.000Z",
    summary: "Official hotfix metadata used by Playwright visual tests.",
    observed_at: isoMinutesAgo(40),
    claimed_fix_total: 5,
    is_current: true,
  },
];

const officialPatchClaimedFixes = [
  {
    board_no: "105",
    position: 0,
    fix_text: "[PS5] Fixed an issue where opening the world map could crash or freeze the client.",
    category: "crash_startup",
    section: "Content",
  },
  {
    board_no: "105",
    position: 1,
    fix_text: "Fixed an issue where performance could drop in crowded areas.",
    category: "performance",
    section: "Graphics / Settings",
  },
];

const patchObservations = [
  {
    id: "observation-old-patch",
    created_at: isoMinutesAgo(10),
    patch_version: "1.13.00",
    kind: "community_ask",
    title: "Older patch observation should never appear in the current brief",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/old-patch-observation/",
    url_hash: "mock-observation-hash-old-patch",
    source_domain: "reddit.com",
    snippet: "This belongs to the previous patch.",
    source_published_at: isoMinutesAgo(15),
    observed_at: isoMinutesAgo(10),
    last_seen_at: isoMinutesAgo(10),
    seen_count: 4,
    is_public: true,
  },
  {
    id: "observation-1",
    created_at: isoMinutesAgo(30),
    patch_version: "1.13.01",
    kind: "press_reception",
    title: "Crimson Desert 1.13.01 hotfix tested: smoother, but not settled",
    url: "https://www.dsogaming.com/articles/crimson-desert-1-13-01-tested/",
    url_hash: "mock-observation-hash-1",
    source_domain: "dsogaming.com",
    snippet:
      "Frame rate and controller issues persist for some players, despite the hotfix addressing several crashes and glitches.",
    source_published_at: isoMinutesAgo(90),
    observed_at: isoMinutesAgo(30),
    last_seen_at: isoMinutesAgo(30),
    seen_count: 3,
    is_public: true,
  },
  {
    id: "observation-2",
    created_at: isoMinutesAgo(55),
    patch_version: "1.13.01",
    kind: "patch_release",
    title: "Crimson Desert hotfix 1.13.01 rolling out on all platforms",
    url: "https://www.pcgamer.com/crimson-desert-hotfix-1-13-01/",
    url_hash: "mock-observation-hash-2",
    source_domain: "pcgamer.com",
    snippet: "Pearl Abyss says the hotfix targets map crashes and frame rate drops reported since 1.13.00.",
    source_published_at: isoMinutesAgo(120),
    observed_at: isoMinutesAgo(55),
    last_seen_at: isoMinutesAgo(55),
    seen_count: 1,
    is_public: true,
  },
  {
    id: "observation-3",
    created_at: isoMinutesAgo(20),
    patch_version: "1.13.01",
    kind: "community_ask",
    title: "Day 20 of asking to add caracals to the desert : r/CrimsonDesert",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/mock1/day_20_of_asking/",
    url_hash: "mock-observation-hash-3",
    source_domain: "reddit.com",
    snippet: "Still no caracals. The desert needs its cats. I will be here tomorrow.",
    source_published_at: isoMinutesAgo(200),
    observed_at: isoMinutesAgo(20),
    last_seen_at: isoMinutesAgo(20),
    seen_count: 6,
    is_public: true,
  },
  {
    // Undated coverage: the display gate must keep this off every public lane
    // even though it is recent, public, and on-topic — discovery time is not
    // publication time.
    id: "observation-undated",
    created_at: isoMinutesAgo(5),
    patch_version: "1.13.01",
    kind: "patch_release",
    title: "Undated Crimson Desert 1.13.01 mirror must stay off the public wire",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/mock-undated/patch_notes_mirror/",
    url_hash: "mock-observation-hash-undated",
    source_domain: "reddit.com",
    snippet: "A patch-notes mirror whose source never disclosed a publication date.",
    source_published_at: null,
    observed_at: isoMinutesAgo(5),
    last_seen_at: isoMinutesAgo(5),
    seen_count: 1,
    is_public: true,
  },
  {
    // Hidden by a recorded Reject-and-teach decision: the public lanes must
    // skip it while the admin desk offers Undo.
    id: "observation-hidden",
    created_at: isoMinutesAgo(45),
    patch_version: "1.13.01",
    kind: "community_ask",
    title: "Hidden Crimson Desert ask stays off the public lanes",
    url: "https://www.reddit.com/r/CrimsonDesert/comments/mock-hidden/rejected_ask/",
    url_hash: "mock-observation-hash-hidden",
    source_domain: "reddit.com",
    snippet: "An ask the operator rejected and taught away.",
    source_published_at: isoMinutesAgo(300),
    observed_at: isoMinutesAgo(45),
    last_seen_at: isoMinutesAgo(45),
    seen_count: 2,
    is_public: false,
  },
];

const scannerDecisions = [
  {
    id: "mock-observation-decision-1",
    created_at: isoMinutesAgo(40),
    candidate_id: null,
    signal_id: null,
    observation_id: "observation-hidden",
    target_url: "https://www.reddit.com/r/CrimsonDesert/comments/mock-hidden/rejected_ask/",
    target_url_hash: "a".repeat(64),
    source_domain: "reddit.com",
    decision: "off_topic",
    reason: "Feature request thread, not patch context.",
    actor: "admin",
    undone_at: null,
  },
];

const steamPulseSnapshots = [
  ["2026-07-14", 12408, 31, 9, 3, 71.8],
  ["2026-07-15", 12442, 34, 11, 4, 71.9],
  ["2026-07-16", 12468, 26, 7, 2, 72.0],
  ["2026-07-17", 12511, 43, 14, 5, 71.8],
  ["2026-07-18", 12540, 29, 8, 3, 72.1],
  ["2026-07-19", 12578, 38, 12, 4, 72.4],
  ["2026-07-20", 12609, 31, 9, 3, 72.5],
  ["2026-07-21", 12657, 48, 16, 6, 72.3],
  ["2026-07-22", 12692, 35, 10, 4, 72.6],
  ["2026-07-23", 12733, 41, 13, 5, 72.8],
].map(([snapshotDay, totalReviews, delta, issueLanguageCount, leadsRetained, positivePercentage]) => ({
  snapshot_day: snapshotDay,
  collected_at: `${snapshotDay}T23:20:00.000Z`,
  total_reviews: totalReviews,
  total_positive: Math.round(totalReviews * (positivePercentage / 100)),
  total_negative: totalReviews - Math.round(totalReviews * (positivePercentage / 100)),
  positive_percentage: positivePercentage,
  review_count_delta: delta,
  reviews_scanned: Math.min(100, delta + 20),
  issue_language_count: issueLanguageCount,
  leads_retained: leadsRetained,
}));

const platformContextSnapshots = [
  [35, 184, 12840],
  [155, 201, 15120],
  [395, 142, 9840],
  [755, 118, 7210],
  [1195, 96, 5630],
].map(([minutesAgo, liveStreams, liveViewers]) => ({
    captured_at: isoMinutesAgo(minutesAgo),
    igdb_status: "ok",
    igdb_game_id: 121752,
    igdb_name: "Crimson Desert",
    igdb_slug: "crimson-desert",
    igdb_summary: "Mock public metadata for visual tests.",
    igdb_first_release_at: "2026-07-08T00:00:00.000Z",
    igdb_platforms: ["PC", "PlayStation 5", "Xbox Series X|S"],
    twitch_status: "ok",
    twitch_live_streams: liveStreams,
    twitch_live_viewers: liveViewers,
    twitch_complete: true,
  }));

const scannerFeedbackRules = [];

/**
 * Preview seed override: when PREVIEW_SEED_FILE points at a JSON file, its
 * table arrays replace the built-in Playwright seed in place. This is the
 * repo-ignored "what would the site look like with X data" harness — the seed
 * file uses the exact production row shapes (see scripts/generate-preview-seed.mjs),
 * so anything previewed here reproduces once the live scanner writes the same
 * shapes. The regular visual suite uses the built-in seed; the N=0 project
 * supplies empty tables through this same override.
 */
const previewSeedFile = process.env.PREVIEW_SEED_FILE;
if (previewSeedFile) {
  const seedTables = {
    issue_clusters: clusters,
    bug_reports: bugReports,
    approved_excerpts: excerpts,
    source_signals: signals,
    automation_runs: automationRuns,
    automation_rejected_candidates: rejectedCandidates,
    automation_settings: automationSettings,
    issue_confirmations: issueConfirmations,
    official_patch_notes: officialPatchNotes,
    official_patch_claimed_fixes: officialPatchClaimedFixes,
    patch_observations: patchObservations,
    steam_pulse_snapshots: steamPulseSnapshots,
    platform_context_snapshots: platformContextSnapshots,
    scanner_feedback_rules: scannerFeedbackRules,
  };
  const seed = JSON.parse(readFileSync(previewSeedFile, "utf8"));
  for (const [table, rows] of Object.entries(seed)) {
    const target = seedTables[table];
    if (!target) {
      console.warn(`[preview-seed] unknown table "${table}" ignored`);
      continue;
    }
    if (Array.isArray(rows)) target.splice(0, target.length, ...rows);
  }
  console.log(`[preview-seed] loaded ${previewSeedFile}`);
}

/**
 * Test-only fixture reset. Every table above is a module-level array that the
 * write handlers mutate in place, and one server process serves the whole run —
 * both Playwright projects included. Without a reset, an admin write test hands
 * the next test (and the next project's screenshots) a different fixture.
 */
/** Re-observation ledger rows written when a rescue re-sees a known URL. Starts empty. */
const signalObservationEvents = [];

const resettableTables = [
  clusters,
  bugReports,
  excerpts,
  signals,
  automationRuns,
  rejectedCandidates,
  automationSettings,
  issueConfirmations,
  officialPatchNotes,
  officialPatchClaimedFixes,
  patchObservations,
  scannerDecisions,
  scannerFeedbackRules,
  signalObservationEvents,
];
const pristineTables = resettableTables.map((table) => structuredClone(table));

let mockIdSeq = 0;
/** Stable ids per server run: production returns uuids, but nothing reads their shape. */
const nextMockId = (prefix) => `mock-${prefix}-${(mockIdSeq += 1)}`;

function resetFixture() {
  resettableTables.forEach((table, index) => {
    table.splice(0, table.length, ...structuredClone(pristineTables[index]));
  });
  mockIdSeq = 0;
}

/**
 * What this shim covers, and what it does not. The five admin RPCs below are
 * implemented against their migration semantics, so every reject/undo/override
 * control on /admin and /scanner works locally and under Playwright.
 *
 * "Keep as relevant" (rescueRejectedCandidate) is also covered: the rescue
 * pipeline's run-ledger insert, signal upsert, re-observation ledger,
 * auto-cluster create and rescued_at mark all have real handlers, and the
 * extraction step needs no stub — without OPENROUTER_API_KEY the app itself
 * falls back to deterministic extraction before any network call.
 *
 * Still unimplemented: the scan trigger itself, which is a live provider run,
 * and the issue_clusters slug unique index — POST here never returns 23505, so
 * createCluster's slug-conflict recovery has no harness coverage (unreachable
 * from a clean fixture: a repeat rescue short-circuits at
 * findExistingSignalCluster before createCluster runs).
 */
const SCANNER_DECISIONS = ["relevant", "off_topic", "wrong_patch", "not_issue_report", "duplicate"];
const OBSERVATION_DECISIONS = ["off_topic", "wrong_patch", "not_issue_report", "duplicate"];
const RULE_SCOPES = ["exact_url", "source_path", "source_domain"];
const URL_HASH_SHAPE = /^[0-9a-f]{64}$/;

/**
 * PostgREST error envelope. The wording matters as much as the status:
 * isMissingSupabaseRpc (src/lib/supabaseCompatibility.ts) reads a message that
 * names the function alongside "not found"/"schema cache" as "this RPC does not
 * exist", and the caller then silently takes a legacy path. None of the messages
 * below name their function, which is what keeps a mock failure honest.
 */
function sendPgError(res, method, status, message, code) {
  sendJson(res, method, status, { message, code, details: null, hint: null });
}
const badInput = (res, method, message) => sendPgError(res, method, 400, message, "22023");
const missingRow = (res, method, message) => sendPgError(res, method, 404, message, "P0002");

/** BEFORE INSERT OR UPDATE trigger on issue_clusters: an override outranks auto_public. */
function clampClusterVisibility(cluster) {
  if (cluster.admin_visibility_override === "force_public") cluster.is_public = true;
  if (cluster.admin_visibility_override === "force_hidden") cluster.is_public = false;
  return cluster;
}

/** BEFORE INSERT OR UPDATE trigger on source_signals: signals of a force-hidden cluster stay hidden. */
function enforceHiddenClusterSignal(signal) {
  const cluster = clusters.find((item) => item.id === signal.cluster_id);
  if (cluster?.admin_visibility_override !== "force_hidden") return signal;
  signal.public_status = "hidden";
  signal.promoted_at = null;
  signal.promotion_reason = "admin_force_hidden";
  return signal;
}

function bumpClusterRevision(clusterId) {
  const cluster = clusters.find((item) => item.id === clusterId);
  if (cluster) cluster.visibility_revision = Number(cluster.visibility_revision ?? 0) + 1;
}

/** One live rule per scope: recording a new one revokes whatever it replaces. */
function supersedeRulesForScope(scopeType, scopeValue, newRuleId, at) {
  for (const rule of scannerFeedbackRules) {
    if (rule.id === newRuleId) continue;
    if (rule.scope_type !== scopeType || rule.scope_value !== scopeValue) continue;
    if (rule.revoked_at) continue;
    rule.revoked_at = at;
    rule.superseded_by_rule_id = newRuleId;
  }
}

/**
 * The validation the two decision RPCs share, in the migration's order — the
 * order is the contract, because the operator sees the first message that fires.
 * Returns an error message, or null when the payload is good.
 */
function validateDecisionPayload(payload, { decisions, reason, confirmBroad }) {
  if (!payload.p_target_url || !String(payload.p_target_url).trim()) return "target URL is required";
  if (!URL_HASH_SHAPE.test(String(payload.p_target_url_hash ?? ""))) return "target URL hash is invalid";
  if (!decisions.includes(payload.p_decision)) {
    return decisions === OBSERVATION_DECISIONS ? "invalid observation decision" : "invalid scanner decision";
  }
  if (reason.length < 3 || reason.length > 500) return "decision reason must be 3 to 500 characters";
  if (!RULE_SCOPES.includes(payload.p_scope_type)) return "invalid rule scope";
  if (!payload.p_scope_value || !String(payload.p_scope_value).trim()) return "rule scope value is required";
  if (payload.p_scope_type !== "exact_url" && !confirmBroad) {
    return "broader feedback rules require explicit confirmation";
  }
  return null;
}

function sendJson(res, method, status, data, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    ...headers,
  });
  res.end(method === "HEAD" ? "" : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

function filterRows(table, url) {
  let rows = [...table];

  // PostgREST renders .is(column, null) as `column=is.null`. Until the admin
  // RPCs existed nothing here ever set these columns, so ignoring the filter was
  // harmless; now a decided candidate, a revoked rule and an undone decision all
  // have to leave their lists. Seed rows omit the columns entirely, which counts
  // as null the way Postgres would read a null column. The negation matters for
  // the rescue path: findExistingSignalCluster asks for clustered signals only,
  // and ignoring `not.is.null` would route a rescue into whatever row came first.
  for (const [column, value] of url.searchParams.entries()) {
    if (value === "is.null") rows = rows.filter((row) => row[column] == null);
    if (value === "not.is.null") rows = rows.filter((row) => row[column] != null);
  }

  const id = url.searchParams.get("id");
  if (id?.startsWith("eq.")) rows = rows.filter((row) => row.id === id.slice(3));
  // Keyset paging (readAdminClusters) walks by `id=gt.<last seen id>`; without
  // this the second page would repeat page one and the walk would never end.
  if (id?.startsWith("gt.")) rows = rows.filter((row) => String(row.id) > id.slice(3));

  // Feedback-rule paging walks by a compound (created_at, id) cursor sent as
  // `or=(created_at.lt.T,and(created_at.eq.T,id.lt.I))`. Other or-expressions
  // stay ignored here, as they always have been; this one cannot be, or the
  // walk would read page one forever. Deliberately shape-matched so an
  // unrecognized cursor fails loudly instead of quietly matching everything.
  const or = url.searchParams.get("or");
  if (or?.startsWith("(created_at.lt.")) {
    const cursor = /^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)\)$/.exec(or);
    if (!cursor) throw new Error(`unsupported keyset cursor ${or}`);
    const [, createdAt, lastId] = cursor;
    rows = rows.filter(
      (row) =>
        String(row.created_at) < createdAt ||
        (String(row.created_at) === createdAt && String(row.id) < lastId),
    );
  }

  const clusterId = url.searchParams.get("cluster_id");
  if (clusterId?.startsWith("eq.")) rows = rows.filter((row) => row.cluster_id === clusterId.slice(3));

  const status = url.searchParams.get("moderation_status");
  if (status?.startsWith("eq.")) rows = rows.filter((row) => row.moderation_status === status.slice(3));
  if (status?.startsWith("in.")) {
    const allowed = status
      .slice(3)
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((value) => value.replace(/^"|"$/g, ""));
    rows = rows.filter((row) => allowed.includes(row.moderation_status));
  }

  const rowStatus = url.searchParams.get("status");
  if (rowStatus?.startsWith("eq.")) rows = rows.filter((row) => row.status === rowStatus.slice(3));
  if (rowStatus?.startsWith("in.")) {
    const allowed = rowStatus
      .slice(3)
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((value) => value.replace(/^"|"$/g, ""));
    rows = rows.filter((row) => allowed.includes(row.status));
  }

  const mode = url.searchParams.get("mode");
  if (mode?.startsWith("eq.")) rows = rows.filter((row) => row.mode === mode.slice(3));
  if (mode?.startsWith("neq.")) rows = rows.filter((row) => row.mode !== mode.slice(4));

  const boardNo = url.searchParams.get("board_no");
  if (boardNo?.startsWith("eq.")) rows = rows.filter((row) => row.board_no === boardNo.slice(3));

  const submitterIpHash = url.searchParams.get("submitter_ip_hash");
  if (submitterIpHash?.startsWith("eq.")) {
    rows = rows.filter((row) => row.submitter_ip_hash === submitterIpHash.slice(3));
  }

  const createdAt = url.searchParams.get("created_at");
  if (createdAt?.startsWith("gte.")) {
    const floor = new Date(createdAt.slice(4)).getTime();
    rows = rows.filter((row) => new Date(row.created_at).getTime() >= floor);
  }

  const startedAt = url.searchParams.get("started_at");
  if (startedAt?.startsWith("gte.")) {
    const floor = new Date(startedAt.slice(4)).getTime();
    rows = rows.filter((row) => new Date(row.started_at).getTime() >= floor);
  }

  const expiresAt = url.searchParams.get("expires_at");
  if (expiresAt?.startsWith("gt.")) {
    const floor = new Date(expiresAt.slice(3)).getTime();
    rows = rows.filter((row) => new Date(row.expires_at).getTime() > floor);
  }

  const isPublic = url.searchParams.get("is_public");
  if (isPublic === "eq.true") rows = rows.filter((row) => row.is_public === true);

  const isCurrent = url.searchParams.get("is_current");
  if (isCurrent === "eq.true") rows = rows.filter((row) => row.is_current === true);

  const patchVersion = url.searchParams.get("patch_version");
  if (patchVersion?.startsWith("eq.")) rows = rows.filter((row) => row.patch_version === patchVersion.slice(3));

  const kind = url.searchParams.get("kind");
  if (kind?.startsWith("eq.")) rows = rows.filter((row) => row.kind === kind.slice(3));
  if (kind?.startsWith("in.")) {
    const allowed = kind
      .slice(3)
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((value) => value.replace(/^"|"$/g, ""));
    rows = rows.filter((row) => allowed.includes(row.kind));
  }

  const publicStatus = url.searchParams.get("public_status");
  if (publicStatus?.startsWith("eq.")) rows = rows.filter((row) => row.public_status === publicStatus.slice(3));

  const key = url.searchParams.get("key");
  if (key?.startsWith("eq.")) rows = rows.filter((row) => row.key === key.slice(3));

  // The rescue path's lookups: signal memory by external hash, existing-cluster
  // routing by semantic fingerprint (excluding Steam reviews), and the routable
  // cluster read that must not see auto-created clusters.
  const externalIdHashFilter = url.searchParams.get("external_id_hash");
  if (externalIdHashFilter?.startsWith("eq.")) {
    rows = rows.filter((row) => row.external_id_hash === externalIdHashFilter.slice(3));
  }

  const semanticFingerprint = url.searchParams.get("semantic_fingerprint");
  if (semanticFingerprint?.startsWith("eq.")) {
    rows = rows.filter((row) => row.semantic_fingerprint === semanticFingerprint.slice(3));
  }

  // SQL three-valued logic: NULL <> x and NULL NOT LIKE x are unknown, so a
  // null column drops the row in both negations, same as Postgres.
  const source = url.searchParams.get("source");
  if (source?.startsWith("neq.")) {
    rows = rows.filter((row) => row.source != null && row.source !== source.slice(4));
  }

  const slug = url.searchParams.get("slug");
  if (slug?.startsWith("eq.")) rows = rows.filter((row) => row.slug === slug.slice(3));
  if (slug?.startsWith("not.like.")) {
    // SQL LIKE, anchored; % is the only wildcard the codebase uses.
    const pattern = new RegExp(
      `^${slug.slice(9).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
    );
    rows = rows.filter((row) => row.slug != null && !pattern.test(String(row.slug)));
  }

  const order = url.searchParams.get("order");
  if (order?.startsWith("created_at.desc")) {
    // `id.desc` is the tiebreak the feedback-rule cursor depends on: with tied
    // timestamps left unordered, the next page's cursor could re-read a row.
    const breakTiesById = order.includes("id.desc");
    rows.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
        (breakTiesById ? String(b.id).localeCompare(String(a.id)) : 0),
    );
  }
  if (order?.startsWith("started_at.desc")) {
    rows.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }
  if (order?.startsWith("observed_at.desc")) {
    rows.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
  }
  if (order?.startsWith("published_at.desc")) {
    rows.sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime());
  }
  if (order?.startsWith("snapshot_day.desc")) rows.sort((a, b) => String(b.snapshot_day).localeCompare(String(a.snapshot_day)));
  if (order?.startsWith("captured_at.desc")) {
    rows.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
  }
  if (order?.startsWith("position.asc")) rows.sort((a, b) => a.position - b.position);
  if (order?.startsWith("title.asc")) rows.sort((a, b) => a.title.localeCompare(b.title));

  const limit = Number(url.searchParams.get("limit"));
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return rows;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${supabasePort}`);
  if (req.method === "OPTIONS") {
    sendJson(res, req.method, 204, {});
    return;
  }

  // Test-only: hand the next test the fixture this one started with. Admin write
  // tests call this in afterEach so their writes cannot drift a later test's
  // screenshot — the two Playwright projects share this one process.
  if (url.pathname === "/__test__/reset" && req.method === "POST") {
    resetFixture();
    sendJson(res, req.method, 200, { reset: true });
    return;
  }

  if (url.pathname === "/rest/v1/issue_clusters" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(clusters, url));
    return;
  }

  if (url.pathname === "/rest/v1/issue_clusters" && req.method === "PATCH") {
    const raw = await readBody(req);
    const patch = raw ? JSON.parse(raw) : {};
    const rows = filterRows(clusters, url);
    for (const row of rows) Object.assign(row, patch);
    sendJson(res, req.method, 200, rows);
    return;
  }

  // createCluster: a rescue whose signal routes nowhere gets a fresh auto-cluster.
  if (url.pathname === "/rest/v1/issue_clusters" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = clampClusterVisibility({
      id: nextMockId("cluster"),
      created_at: new Date(now()).toISOString(),
      admin_visibility_override: null,
      visibility_revision: 0,
      ...parsed,
    });
    clusters.push(row);
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    sendJson(res, req.method, 201, wantsObject ? row : [row]);
    return;
  }

  if (url.pathname === "/rest/v1/bug_reports" && req.method === "HEAD") {
    const rows = filterRows(bugReports, url);
    sendJson(res, req.method, 200, [], { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    return;
  }

  if (url.pathname === "/rest/v1/bug_reports" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(bugReports, url));
    return;
  }

  if (url.pathname === "/rest/v1/bug_reports" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = {
      id: `report-${bugReports.length + 1}`,
      created_at: new Date(now()).toISOString(),
      ...parsed,
    };
    bugReports.push(row);
    if (row.moderation_status === "approved" && row.cluster_id) {
      const cluster = clusters.find((item) => item.id === row.cluster_id);
      if (cluster) {
        cluster.auto_public = true;
        cluster.is_public = cluster.admin_visibility_override === "force_hidden" ? false : true;
        cluster.visibility_restore_auto_public = cluster.admin_visibility_override ? true : null;
        cluster.visibility_restore_is_public = cluster.admin_visibility_override ? true : null;
        cluster.visibility_revision = Number(cluster.visibility_revision ?? 0) + 1;
      }
    }
    // .single() requests ask PostgREST for a bare object, not an array.
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    sendJson(res, req.method, 201, wantsObject ? row : [row]);
    return;
  }

  if (url.pathname === "/rest/v1/approved_excerpts" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = {
      id: `excerpt-${excerpts.length + 1}`,
      created_at: new Date(now()).toISOString(),
      bug_reports: null,
      ...parsed,
    };
    excerpts.push(row);
    sendJson(res, req.method, 201, [row]);
    return;
  }

  if (url.pathname === "/rest/v1/approved_excerpts" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(excerpts, url));
    return;
  }

  if (url.pathname === "/rest/v1/source_signals" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(signals, url));
    return;
  }

  // upsertSignal's first-observation branch; its reobserve branch rides the
  // pre-existing PATCH handler further down. The force-hidden trigger applies
  // on insert exactly as trg_enforce_hidden_cluster_signal would.
  if (url.pathname === "/rest/v1/source_signals" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = { id: nextMockId("signal"), ...parsed };
    enforceHiddenClusterSignal(row);
    signals.push(row);
    sendJson(res, req.method, 201, [row]);
    return;
  }

  // Rescue idempotency ledger: re-seeing a known URL records an event row. Only
  // reachable when signals carry external_id_hash — production-shaped preview
  // seeds, not the Playwright fixture. The app's observationLedgerAvailable
  // latch lives in the Next process and survives fixture resets.
  if (url.pathname === "/rest/v1/signal_observation_events" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = { id: nextMockId("observation-event"), ...parsed };
    signalObservationEvents.push(row);
    sendJson(res, req.method, 201, [row]);
    return;
  }

  if (url.pathname === "/rest/v1/automation_runs" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(automationRuns, url));
    return;
  }

  // createRunLedger: insert returning id, then finalizeRunLedger patches it closed.
  if (url.pathname === "/rest/v1/automation_runs" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = { id: nextMockId("run"), created_at: new Date(now()).toISOString(), ...parsed };
    automationRuns.push(row);
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    sendJson(res, req.method, 201, wantsObject ? row : [row]);
    return;
  }

  if (url.pathname === "/rest/v1/automation_runs" && req.method === "PATCH") {
    const raw = await readBody(req);
    const patch = raw ? JSON.parse(raw) : {};
    const rows = filterRows(automationRuns, url);
    for (const row of rows) Object.assign(row, patch);
    sendJson(res, req.method, 200, rows);
    return;
  }

  if (url.pathname === "/rest/v1/automation_rejected_candidates" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(rejectedCandidates, url));
    return;
  }

  // The rescued_at mark that takes a kept candidate off the teaching desk.
  if (url.pathname === "/rest/v1/automation_rejected_candidates" && req.method === "PATCH") {
    const raw = await readBody(req);
    const patch = raw ? JSON.parse(raw) : {};
    const rows = filterRows(rejectedCandidates, url);
    for (const row of rows) Object.assign(row, patch);
    sendJson(res, req.method, 200, rows);
    return;
  }

  if (url.pathname === "/rest/v1/scanner_feedback_rules" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(scannerFeedbackRules, url));
    return;
  }

  if (url.pathname === "/rest/v1/steam_pulse_snapshots" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(steamPulseSnapshots, url));
    return;
  }

  if (url.pathname === "/rest/v1/platform_context_snapshots" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(platformContextSnapshots, url));
    return;
  }

  if (url.pathname === "/rest/v1/issue_confirmations" && req.method === "GET") {
    sendJson(res, req.method ?? "GET", 200, issueConfirmations);
    return;
  }

  if (url.pathname === "/rest/v1/rpc/record_issue_confirmation" && req.method === "POST") {
    sendJson(res, req.method, 200, "recorded");
    return;
  }

  if (url.pathname === "/rest/v1/rpc/apply_cluster_visibility_refresh" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const cluster = clusters.find((item) => item.id === parsed.p_cluster_id);
    if (!cluster) {
      sendJson(res, req.method, 404, { message: "issue cluster not found" });
      return;
    }
    if (Number(cluster.visibility_revision ?? 0) !== Number(parsed.p_expected_revision)) {
      sendJson(res, req.method, 200, false);
      return;
    }
    for (const signalPatch of parsed.p_signal_patches ?? []) {
      const signal = signals.find((item) => item.id === signalPatch.id && item.cluster_id === parsed.p_cluster_id);
      if (signal) Object.assign(signal, signalPatch);
    }
    const automaticPatch = parsed.p_cluster_patch ?? {};
    Object.assign(cluster, automaticPatch, {
      is_public:
        cluster.admin_visibility_override === "force_public"
          ? true
          : cluster.admin_visibility_override === "force_hidden"
            ? false
            : automaticPatch.is_public,
      visibility_restore_auto_public: cluster.admin_visibility_override ? automaticPatch.auto_public : null,
      visibility_restore_is_public: cluster.admin_visibility_override ? automaticPatch.is_public : null,
      visibility_revision: Number(cluster.visibility_revision ?? 0) + 1,
    });
    sendJson(res, req.method, 200, true);
    return;
  }

  // Teach the scanner about a rejected candidate or kill a bad live lead.
  // Mirrors supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:74-232.
  if (url.pathname === "/rest/v1/rpc/record_scanner_decision" && req.method === "POST") {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const candidateId = payload.p_candidate_id ?? null;
    const signalId = payload.p_signal_id ?? null;
    const reason = String(payload.p_reason ?? "").trim();
    const confirmBroad = payload.p_confirm_broad === true;

    if ((candidateId === null) === (signalId === null)) {
      badInput(res, req.method, "exactly one candidate or signal is required");
      return;
    }
    const invalid = validateDecisionPayload(payload, { decisions: SCANNER_DECISIONS, reason, confirmBroad });
    if (invalid) {
      badInput(res, req.method, invalid);
      return;
    }
    if (signalId !== null && payload.p_scope_type !== "exact_url") {
      badInput(res, req.method, "source-signal feedback must target one exact URL");
      return;
    }
    if (signalId !== null && payload.p_decision === "relevant") {
      badInput(res, req.method, "a retained source signal is already relevant");
      return;
    }
    if (payload.p_expires_at && Date.parse(payload.p_expires_at) <= now()) {
      badInput(res, req.method, "rule expiry must be in the future");
      return;
    }

    const candidate = candidateId === null ? null : rejectedCandidates.find((row) => row.id === candidateId);
    if (candidateId !== null && !candidate) {
      missingRow(res, req.method, "rejected candidate not found");
      return;
    }
    const signal = signalId === null ? null : signals.find((row) => row.id === signalId);
    if (signalId !== null && !signal) {
      missingRow(res, req.method, "source signal not found");
      return;
    }

    const at = new Date(now()).toISOString();
    const decisionId = nextMockId("decision");
    const ruleId = nextMockId("rule");
    scannerDecisions.push({
      id: decisionId,
      created_at: at,
      candidate_id: candidateId,
      signal_id: signalId,
      observation_id: null,
      target_url: payload.p_target_url,
      target_url_hash: payload.p_target_url_hash,
      source_domain: payload.p_source_domain ?? null,
      decision: payload.p_decision,
      reason,
      actor: "admin",
      undone_at: null,
    });
    scannerFeedbackRules.push({
      id: ruleId,
      created_at: at,
      decision_id: decisionId,
      // The check constraint ties action to decision, so it is derived, never taken from the caller.
      action: payload.p_decision === "relevant" ? "allow" : "block",
      decision: payload.p_decision,
      scope_type: payload.p_scope_type,
      scope_value: payload.p_scope_value,
      reason,
      confirmed_at: payload.p_scope_type === "exact_url" || confirmBroad ? at : null,
      expires_at: payload.p_expires_at ?? null,
      revoked_at: null,
      superseded_by_rule_id: null,
    });
    supersedeRulesForScope(payload.p_scope_type, payload.p_scope_value, ruleId, at);

    if (candidate) {
      candidate.decision_id = decisionId;
      candidate.feedback_rule_id = ruleId;
      candidate.decided_at = at;
    }
    let affectedClusterId = null;
    if (signal) {
      Object.assign(signal, {
        public_status: "hidden",
        promoted_at: null,
        promotion_reason: "operator_feedback_blocked",
      });
      enforceHiddenClusterSignal(signal);
      affectedClusterId = signal.cluster_id ?? null;
      if (affectedClusterId) bumpClusterRevision(affectedClusterId);
    }

    sendJson(res, req.method, 200, [
      { decision_id: decisionId, rule_id: ruleId, affected_cluster_id: affectedClusterId },
    ]);
    return;
  }

  // Hide a Wire/Asks observation and remember why.
  // Mirrors supabase/migrations/20260724200000_observation_moderation.sql:24-153.
  if (url.pathname === "/rest/v1/rpc/record_observation_decision" && req.method === "POST") {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const reason = String(payload.p_reason ?? "").trim();
    const confirmBroad = payload.p_confirm_broad === true;

    if (!payload.p_observation_id) {
      badInput(res, req.method, "observation id is required");
      return;
    }
    const invalid = validateDecisionPayload(payload, { decisions: OBSERVATION_DECISIONS, reason, confirmBroad });
    if (invalid) {
      badInput(res, req.method, invalid);
      return;
    }
    if (payload.p_expires_at && Date.parse(payload.p_expires_at) <= now()) {
      badInput(res, req.method, "rule expiry must be in the future");
      return;
    }
    const observation = patchObservations.find((row) => row.id === payload.p_observation_id);
    if (!observation) {
      missingRow(res, req.method, "observation not found");
      return;
    }
    // The hide IS the guard: `where is_public = true` matching zero rows is what
    // rejects a second decision on an already-hidden item, and it writes nothing.
    if (observation.is_public !== true) {
      sendPgError(
        res,
        req.method,
        500,
        "observation is already hidden — undo its existing decision before deciding again",
        "55000",
      );
      return;
    }
    observation.is_public = false;

    const at = new Date(now()).toISOString();
    const decisionId = nextMockId("decision");
    const ruleId = nextMockId("rule");
    scannerDecisions.push({
      id: decisionId,
      created_at: at,
      candidate_id: null,
      signal_id: null,
      observation_id: observation.id,
      target_url: payload.p_target_url,
      target_url_hash: payload.p_target_url_hash,
      source_domain: payload.p_source_domain ?? null,
      decision: payload.p_decision,
      reason,
      actor: "admin",
      undone_at: null,
    });
    scannerFeedbackRules.push({
      id: ruleId,
      created_at: at,
      decision_id: decisionId,
      action: "block",
      decision: payload.p_decision,
      scope_type: payload.p_scope_type,
      scope_value: payload.p_scope_value,
      reason,
      confirmed_at: payload.p_scope_type === "exact_url" || confirmBroad ? at : null,
      expires_at: payload.p_expires_at ?? null,
      revoked_at: null,
      superseded_by_rule_id: null,
    });
    supersedeRulesForScope(payload.p_scope_type, payload.p_scope_value, ruleId, at);

    sendJson(res, req.method, 200, [{ decision_id: decisionId, rule_id: ruleId }]);
    return;
  }

  // Take a lesson back. Mirrors the LATER definition at
  // supabase/migrations/20260724200000_observation_moderation.sql:157-216.
  if (url.pathname === "/rest/v1/rpc/undo_scanner_decision" && req.method === "POST") {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const decision = scannerDecisions.find((row) => row.id === payload.p_decision_id && row.undone_at == null);
    // No argument validation upstream either: an unknown or already-undone id is
    // a quiet `undone: false`, never an error, and the caller turns that into its
    // own message.
    if (!decision) {
      sendJson(res, req.method, 200, [{ undone: false, affected_cluster_id: null }]);
      return;
    }

    const at = new Date(now()).toISOString();
    decision.undone_at = at;
    for (const rule of scannerFeedbackRules) {
      // No `revoked_at is null` filter here, and coalesce keeps an earlier
      // revocation — a rule superseded by a later decision stays stamped with
      // the time it actually lost, not the time of this undo.
      if (rule.decision_id === decision.id) rule.revoked_at = rule.revoked_at ?? at;
    }
    for (const candidate of rejectedCandidates) {
      // Deliberately skips rescued candidates: undo revokes the rule but never
      // pulls a published lead back, so a rescue is not fully reversible.
      if (candidate.decision_id !== decision.id || candidate.rescued_at != null) continue;
      candidate.decision_id = null;
      candidate.feedback_rule_id = null;
      candidate.decided_at = null;
    }
    if (decision.observation_id) {
      const observation = patchObservations.find((row) => row.id === decision.observation_id);
      if (observation) observation.is_public = true;
    }
    let affectedClusterId = null;
    if (decision.signal_id) {
      // Undo does not un-hide the signal itself; it bumps the revision and lets
      // the app's refresh recompute what the cluster should show.
      affectedClusterId = signals.find((row) => row.id === decision.signal_id)?.cluster_id ?? null;
      if (affectedClusterId) bumpClusterRevision(affectedClusterId);
    }

    sendJson(res, req.method, 200, [{ undone: true, affected_cluster_id: affectedClusterId }]);
    return;
  }

  // Break-glass visibility. Mirrors the 3-argument definition at
  // supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql:422-486.
  if (url.pathname === "/rest/v1/rpc/set_cluster_visibility_override" && req.method === "POST") {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const visibility = payload.p_visibility;
    const reason = String(payload.p_reason ?? "").trim();

    if (!["auto", "force_public", "force_hidden"].includes(visibility)) {
      badInput(res, req.method, "invalid visibility override");
      return;
    }
    if (visibility !== "auto" && (reason.length < 3 || reason.length > 500)) {
      badInput(res, req.method, "visibility override reason required");
      return;
    }
    const cluster = clusters.find((row) => row.id === payload.p_cluster_id);
    if (!cluster) {
      missingRow(res, req.method, "issue cluster not found");
      return;
    }

    // SQL evaluates every SET expression against the pre-update row, so the old
    // values are read once up front. Assigning in sequence would let the new
    // override decide what the restore columns remember.
    const previous = {
      override: cluster.admin_visibility_override ?? null,
      isPublic: cluster.is_public,
      autoPublic: cluster.auto_public,
      restoreIsPublic: cluster.visibility_restore_is_public ?? null,
      restoreAutoPublic: cluster.visibility_restore_auto_public ?? null,
    };
    const returningToAuto = visibility === "auto";
    Object.assign(cluster, {
      visibility_restore_is_public: returningToAuto
        ? null
        : previous.override === null
          ? previous.isPublic
          : (previous.restoreIsPublic ?? previous.isPublic),
      visibility_restore_auto_public: returningToAuto
        ? null
        : previous.override === null
          ? previous.autoPublic
          : (previous.restoreAutoPublic ?? previous.autoPublic),
      admin_visibility_override: returningToAuto ? null : visibility,
      admin_visibility_reason: returningToAuto ? null : reason,
      admin_visibility_changed_at: returningToAuto ? null : new Date(now()).toISOString(),
      auto_public: returningToAuto ? (previous.restoreAutoPublic ?? previous.autoPublic) : previous.autoPublic,
      is_public:
        visibility === "force_public"
          ? true
          : visibility === "force_hidden"
            ? false
            : (previous.restoreIsPublic ?? previous.isPublic),
      visibility_revision: Number(cluster.visibility_revision ?? 0) + 1,
    });
    clampClusterVisibility(cluster);

    if (visibility === "force_hidden") {
      for (const signal of signals) {
        if (signal.cluster_id !== cluster.id) continue;
        Object.assign(signal, {
          public_status: "hidden",
          promoted_at: null,
          promotion_reason: "admin_force_hidden",
        });
      }
    }

    sendJson(res, req.method, 200, null);
    return;
  }

  // Break-glass patch pointer. Mirrors
  // supabase/migrations/20260710021010_atomic_current_patch_override.sql:1-62.
  if (url.pathname === "/rest/v1/rpc/set_current_patch_override" && req.method === "POST") {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const version = payload.p_patch_version;
    if (!version || !/^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$/.test(String(version))) {
      // This one raises without an errcode, so it lands as P0001 rather than 22023.
      sendPgError(res, req.method, 400, "invalid patch version", "P0001");
      return;
    }
    if (!payload.p_observed_at) {
      sendPgError(res, req.method, 400, "observed time is required", "P0001");
      return;
    }

    for (const note of officialPatchNotes) {
      if (note.is_current === true) note.is_current = false;
    }
    // board_no is synthesized from the version, so re-overriding the same version
    // updates one manual row instead of stacking them.
    const boardNo = `manual-${version}`;
    const manual = {
      title: `Manual override: Patch ${version}`,
      patch_version: version,
      official_url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice",
      published_at: null,
      summary: null,
      observed_at: payload.p_observed_at,
      is_current: true,
    };
    const existing = officialPatchNotes.find((note) => note.board_no === boardNo);
    // claimed_fix_total is absent from both the insert and the conflict update, so
    // a manual override never clears a count the scraper wrote.
    if (existing) Object.assign(existing, manual);
    else officialPatchNotes.push({ id: nextMockId("patch-note"), board_no: boardNo, ...manual });

    sendJson(res, req.method, 200, null);
    return;
  }

  if (url.pathname === "/rest/v1/automation_settings" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(automationSettings, url));
    return;
  }

  if (url.pathname === "/rest/v1/automation_settings" && req.method === "POST") {
    const raw = await readBody(req);
    const parsed = raw ? JSON.parse(raw) : {};
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (rows.some((row) => !row || typeof row.key !== "string" || !Object.hasOwn(row, "value"))) {
      sendJson(res, req.method, 400, { message: "settings require a key and value" });
      return;
    }
    for (const row of rows) {
      const existing = automationSettings.find((setting) => setting.key === row.key);
      if (existing) Object.assign(existing, row);
      else automationSettings.push({ ...row });
    }
    sendJson(res, req.method, 201, rows);
    return;
  }

  if (url.pathname === "/rest/v1/official_patch_notes" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(officialPatchNotes, url));
    return;
  }

  if (url.pathname === "/rest/v1/official_patch_claimed_fixes" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(officialPatchClaimedFixes, url));
    return;
  }

  if (url.pathname === "/rest/v1/patch_observations" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(patchObservations, url));
    return;
  }

  if (url.pathname === "/rest/v1/scanner_decisions" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(scannerDecisions, url));
    return;
  }

  // Aggregate view fixture: derives the daily rollup from the same seed rows,
  // mirroring the migration's semantics (family reports, current-stance taps,
  // persisted non-dry-run kept leads).
  if (url.pathname === "/rest/v1/daily_signal_rollup" && req.method === "GET") {
    const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);
    // Derive the current patch family from the seeded notes (mirrors the
    // migration) so preview seeds on other patch versions roll up correctly.
    const currentNote = officialPatchNotes.find((note) => note.is_current) ?? officialPatchNotes[0];
    const family = String(currentNote?.patch_version ?? "1.13")
      .split(".")
      .slice(0, 2)
      .map((part) => String(Number(part)))
      .join(".");
    const publishedDay = new Date(currentNote?.published_at ?? "2026-07-08T00:00:00.000Z");
    publishedDay.setUTCHours(0, 0, 0, 0);
    const floor = new Date(Math.max(publishedDay.getTime(), now() - 30 * 24 * 60 * 60 * 1000));
    const reportsByDay = new Map();
    for (const report of bugReports) {
      if (report.moderation_status !== "approved") continue;
      const reportVersion = String(report.patch_version ?? "");
      if (reportVersion !== family && !reportVersion.startsWith(`${family}.`)) continue;
      const key = dayKey(report.created_at);
      reportsByDay.set(key, (reportsByDay.get(key) ?? 0) + 1);
    }
    const tapsByDay = new Map();
    for (const tap of issueConfirmations) {
      const key = dayKey(tap.created_at);
      tapsByDay.set(key, (tapsByDay.get(key) ?? 0) + 1);
    }
    const keptByDay = new Map();
    for (const run of automationRuns) {
      if (run.mode === "dry_run" || !["success", "partial"].includes(run.status)) continue;
      const key = dayKey(run.started_at);
      keptByDay.set(key, (keptByDay.get(key) ?? 0) + (run.signals_inserted ?? 0));
    }
    const rows = [];
    for (let time = floor.getTime(); time <= now(); time += 24 * 60 * 60 * 1000) {
      const key = new Date(time).toISOString().slice(0, 10);
      rows.push({
        day: key,
        reports: reportsByDay.get(key) ?? 0,
        taps: tapsByDay.get(key) ?? 0,
        kept_leads: keptByDay.get(key) ?? 0,
      });
    }
    sendJson(res, req.method, 200, rows);
    return;
  }

  if (url.pathname === "/rest/v1/source_signals" && req.method === "PATCH") {
    const raw = await readBody(req);
    const patch = raw ? JSON.parse(raw) : {};
    const rows = filterRows(signals, url);
    for (const row of rows) Object.assign(row, patch);
    sendJson(res, req.method, 200, rows);
    return;
  }

  sendJson(res, req.method ?? "GET", 404, { error: `mock supabase route not found: ${req.method} ${url.pathname}` });
});

let child;

function stop() {
  if (child && !child.killed) child.kill("SIGTERM");
  server.close();
}

server.listen(supabasePort, "127.0.0.1", () => {
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const freezeTimePreload = path
    .join(process.cwd(), "tests", "e2e", "freeze-time.cjs")
    .replaceAll("\\", "/");
  const nodeOptions = `${process.env.NODE_OPTIONS?.trim() ?? ""} --require="${freezeTimePreload}"`.trim();
  child = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
      ADMIN_PASSWORD: "admin-password",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      CRON_SECRET: "mock-cron-secret",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.PLAYWRIGHT_TURNSTILE === "true" ? "1x00000000000000000000AA" : "",
      TURNSTILE_SECRET_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
      // Blanked with the rest: a developer's real key in .env.local otherwise
      // flips the Observatory's Tavily card from "Off" to "Connected" and the
      // committed screenshots — taken with no keys — fail locally but not in CI.
      TAVILY_API_KEY: "",
      XAI_API_KEY: "",
      PLAYWRIGHT_NOW: fixtureNowIso,
      NODE_OPTIONS: nodeOptions,
    },
    stdio: "inherit",
  });
});

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
