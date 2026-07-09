import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

// A previous `next dev` session against different (or blank) Supabase env can
// leave stale unstable_cache entries in .next; the mock run must start clean.
rmSync(path.join(process.cwd(), ".next", "cache"), { recursive: true, force: true });

const appPort = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const supabasePort = Number(process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765);

const now = () => Date.now();
const isoMinutesAgo = (minutes) => new Date(now() - minutes * 60 * 1000).toISOString();
const isoDaysAgo = (days) => new Date(now() - days * 24 * 60 * 60 * 1000).toISOString();

const clusters = [
  {
    id: "cluster-fps",
    slug: "fps-regression-113",
    title: "FPS regression since 1.13",
    category: "performance",
    description: "Players report lower frame rate and stutter in open-field combat after patch 1.13.00.",
    fix_status: "reported",
    confidence: "medium",
    is_public: true,
  },
  {
    id: "cluster-map",
    slug: "map-open-crash-persists",
    title: "Map-open crash persists after fix",
    category: "crash_startup",
    description: "Opening the world map can still crash or freeze the client after the claimed fix.",
    fix_status: "fix_claimed",
    fix_claimed_at: "2026-07-08T06:00:00.000Z",
    confidence: "medium",
    is_public: true,
  },
  {
    id: "cluster-mount",
    slug: "mount-input-lockups",
    title: "Mount and input lockups",
    category: "controls_gameplay",
    description: "Mount controls can stop responding until players reload or return to title.",
    fix_status: "reported",
    confidence: "low",
    is_public: true,
  },
  {
    id: "cluster-ghosting",
    slug: "fsr-ghosting",
    title: "FSR ghosting on performance mode",
    category: "graphics_visual",
    description: "Reports mention trailing artifacts and texture shimmer when upscaling is enabled.",
    fix_status: "acknowledged",
    confidence: "low",
    is_public: true,
  },
];

const reportSeed = [
  ["cluster-fps", "performance", "pc_steam", 18],
  ["cluster-fps", "performance", "pc_steam", 54],
  ["cluster-fps", "performance", "pc_steam", 90],
  ["cluster-fps", "performance", "ps5", 160],
  ["cluster-fps", "performance", "ps5_pro", 260],
  ["cluster-fps", "performance", "xbox_series_x", 430],
  ["cluster-map", "crash_startup", "pc_steam", 72],
  ["cluster-map", "crash_startup", "ps5", 188],
  ["cluster-map", "crash_startup", "ps5_pro", 610],
  ["cluster-mount", "controls_gameplay", "ps5", 1440],
  ["cluster-mount", "controls_gameplay", "xbox_series_x", 2200],
  ["cluster-ghosting", "graphics_visual", "pc_steam", 3200],
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
  description: "Pending report stays private.",
  repro_steps: null,
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
    bug_reports: { cluster_id: "cluster-fps", platform: "pc_steam" },
  },
  {
    id: "excerpt-2",
    created_at: isoMinutesAgo(38),
    excerpt_text: "The map crash still happens after the patch note said it was fixed.",
    bug_reports: { cluster_id: "cluster-map", platform: "ps5" },
  },
  {
    id: "excerpt-3",
    created_at: isoDaysAgo(1),
    excerpt_text: "Horse controls locked until returning to title, then recovered.",
    bug_reports: { cluster_id: "cluster-mount", platform: "xbox_series_x" },
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
    cluster_id: "cluster-fps",
    public_status: "public",
    summary: "FPS drops since patch 1.13 (body retained for 48h moderator review)",
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
    cluster_id: "cluster-fps",
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
  ["confirm-1", 30, "cluster-fps", "pc_steam", "have_it", "mock-voter-1"],
  ["confirm-2", 90, "cluster-fps", "pc_steam", "have_it", "mock-voter-2"],
  ["confirm-3", 200, "cluster-fps", "ps5", "have_it", "mock-voter-3"],
  ["confirm-4", 45, "cluster-map", "ps5", "still_happening", "mock-voter-4"],
  ["confirm-5", 50, "cluster-map", "pc_steam", "still_happening", "mock-voter-5"],
  ["confirm-6", 55, "cluster-map", "pc_steam", "fixed_for_me", "mock-voter-6"],
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
    is_current: true,
  },
];

const officialPatchClaimedFixes = [
  {
    board_no: "105",
    position: 0,
    fix_text: "Fixed an issue where opening the world map could crash or freeze the client.",
    category: "crash_startup",
  },
  {
    board_no: "105",
    position: 1,
    fix_text: "Fixed an issue where performance could drop in crowded areas.",
    category: "performance",
  },
];

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

  const publicStatus = url.searchParams.get("public_status");
  if (publicStatus?.startsWith("eq.")) rows = rows.filter((row) => row.public_status === publicStatus.slice(3));

  const key = url.searchParams.get("key");
  if (key?.startsWith("eq.")) rows = rows.filter((row) => row.key === key.slice(3));

  const order = url.searchParams.get("order");
  if (order?.startsWith("created_at.desc")) {
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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

  if (url.pathname === "/rest/v1/issue_clusters" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(clusters, url));
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
      created_at: new Date().toISOString(),
      ...parsed,
    };
    bugReports.push(row);
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
      created_at: new Date().toISOString(),
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

  if (url.pathname === "/rest/v1/automation_runs" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(automationRuns, url));
    return;
  }

  if (url.pathname === "/rest/v1/automation_rejected_candidates" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(rejectedCandidates, url));
    return;
  }

  if (url.pathname === "/rest/v1/issue_confirmations" && req.method === "GET") {
    sendJson(res, req.method ?? "GET", 200, issueConfirmations);
    return;
  }

  if (url.pathname === "/rest/v1/automation_settings" && req.method === "GET") {
    sendJson(res, req.method, 200, filterRows(automationSettings, url));
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

  if (url.pathname === "/rest/v1/source_signals" && req.method === "PATCH") {
    for (const signal of signals) {
      signal.raw_text = null;
      signal.raw_expires_at = null;
    }
    sendJson(res, req.method, 200, signals);
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
  child = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
      ADMIN_PASSWORD: "admin-password",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      CRON_SECRET: "mock-cron-secret",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      REDDIT_CLIENT_ID: "",
      REDDIT_CLIENT_SECRET: "",
      REDDIT_USER_AGENT: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
      XAI_API_KEY: "",
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
