# Crimson Desert Community Report Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the complete Crimson Desert Community Report Hub — an unofficial, zero-dollar, moderation-gated community tracker that turns patch 1.13.00 complaints into structured evidence Pearl Abyss can act on.

**Architecture:** Next.js 15 App Router (TypeScript, Tailwind) on Vercel Hobby, Supabase Free Postgres as the only datastore. ALL database access is server-side through the service-role key (RLS is enabled deny-all; no client-side Supabase). Anonymous public submissions flow through one validated API route with Cloudflare Turnstile + per-IP rate limiting into a moderation queue. Admin surface is cookie-gated (HMAC-signed token). The dossier compiler is deterministic-first; AI drafting (Groq/OpenRouter free tiers) and the Reddit monitor are optional features that fail closed when keys are absent.

**Tech Stack:** Next.js 15 (App Router, server components + server actions), TypeScript, Tailwind CSS, `@supabase/supabase-js`, `zod`, `vitest`, Cloudflare Turnstile, Vercel Cron.

---

## Definition of done (nothing ships as "done" until ALL of these are true on the live URL)

- [ ] Public dark dashboard `/` shows live moderated aggregates: totals, per-category counts, top issues with fix-status, platform breakdown, 30-day sparkline, freshness.
- [ ] `/report` submits an anonymous structured report protected by Turnstile + rate limiting; lands as `pending`.
- [ ] `/issues` shows public issue clusters with fix-status lifecycle and admin-approved excerpts ONLY — never raw unmoderated text.
- [ ] `/about` states purpose, privacy, unofficial status, and links to Pearl Abyss's official report/PERS channels.
- [ ] `/admin` (password-gated): review queue with approve / reject / spam, cluster assignment, excerpt approval, fix-status editing.
- [ ] CSV export of reports from the admin surface.
- [ ] `/admin/compile` generates the Pearl Abyss dossier: deterministic Markdown always; AI-drafted when a free AI key exists; every run stored in `dossier_runs`.
- [ ] `/admin/source-monitor` runs the Reddit monitor (official OAuth only) when keys exist; shows a clear disabled state when they don't; raw source text auto-purges within 48h.
- [ ] X evidence arrives via the report form's evidence URL field (admin-verified). Automated X ingestion is code-complete behind `XAI_API_KEY` but dormant at $0.
- [ ] Daily Vercel cron keeps the Supabase free project awake and purges expired raw source text.
- [ ] Deployed on Vercel Hobby + Supabase Free with zero paid services. All seed taxonomy tagged `seed_unverified` and hidden from "top issues" until real reports back it.

## File map (what exists when done)

```
D:\CD Report Hub\
├── docs/superpowers/plans/2026-07-05-crimson-desert-report-hub.md   (this plan)
├── vercel.json
├── vitest.config.ts
├── .env.local.example
├── supabase/migrations/
│   ├── 0001_schema.sql
│   └── 0002_seed_clusters.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx                     (dark shell: header nav, footer disclaimer)
│   │   ├── globals.css                    (design tokens + utility classes)
│   │   ├── page.tsx                       (public dashboard)
│   │   ├── report/page.tsx                (anonymous submission form, client)
│   │   ├── issues/page.tsx                (public clusters + approved excerpts)
│   │   ├── about/page.tsx
│   │   ├── admin/
│   │   │   ├── page.tsx                   (review queue)
│   │   │   ├── login/page.tsx
│   │   │   ├── actions.ts                 (server actions: moderate, fix-status, compile, monitor)
│   │   │   ├── compile/page.tsx
│   │   │   └── source-monitor/page.tsx
│   │   └── api/
│   │       ├── reports/route.ts           (POST: public submission)
│   │       ├── admin/login/route.ts       (POST password → session cookie; DELETE logout)
│   │       ├── admin/export/route.ts      (GET CSV)
│   │       └── cron/keepalive/route.ts    (GET: DB touch + raw-text purge)
│   ├── components/
│   │   ├── ui.tsx                         (StatCard, MeterBar, Badge, SectionCard)
│   │   └── Sparkline.tsx
│   └── lib/
│       ├── constants.ts                   (platforms, categories, labels)
│       ├── env.ts                         (env access + computeFeatures)
│       ├── supabase.ts                    (service-role server client)
│       ├── crypto.ts                      (fingerprint, normalizeTitle, hashIp)
│       ├── session.ts                     (HMAC session tokens, admin guard)
│       ├── reportSchema.ts                (zod schema)
│       ├── turnstile.ts                   (captcha verify, fail-open only when unconfigured)
│       ├── aggregates.ts                  (pure transforms: countBy, buildDailySeries)
│       ├── queries.ts                     (server-side dashboard/issues/admin queries)
│       ├── csv.ts                         (csvEscape, buildCsv)
│       ├── dossier.ts                     (deterministic Markdown builder)
│       ├── ai.ts                          (optional Groq/OpenRouter drafting, fail closed)
│       └── reddit.ts                      (OAuth token, fetch, classifySignal, hashes)
└── tests/                                 (vitest — mirrors lib modules)
```

Notes for the executor:
- Working dir is `D:\CD Report Hub` (path contains a space — always quote it in shell commands).
- This machine is Windows; commands below are for Git Bash / POSIX sh unless stated.
- A Supabase MCP server may be available; migrations can be applied with its `apply_migration` tool instead of the dashboard SQL editor. Both paths are given in Task 4.
- Commit after every task minimum; the steps mark the exact commit points.

---

## Task 0: Accounts and keys (human + agent checklist, no code)

**Files:** none. All free.

- [ ] **Step 1:** Supabase: create a free project named `cd-report-hub` at https://supabase.com/dashboard (org: personal). Record: Project URL, `service_role` key (Settings → API). Region: closest US region.
- [ ] **Step 2:** Cloudflare Turnstile: at https://dash.cloudflare.com → Turnstile → Add site. Domain: `*.vercel.app` (add the real domain after first deploy — Turnstile requires explicit hostnames; add `localhost` for dev). Widget mode: Managed. Record Site Key + Secret Key.
- [ ] **Step 3:** Vercel: ensure a free Hobby account exists and the GitHub account is connected.
- [ ] **Step 4:** GitHub: create empty private repo `cd-report-hub` (no README).
- [ ] **Step 5 (optional, still $0):** Groq free API key (https://console.groq.com) and/or OpenRouter key (https://openrouter.ai). Reddit app (https://www.reddit.com/prefs/apps → create app → type `script`): record client id + secret; user agent string format: `web:cd-report-hub:v1.0 (by /u/<username>)`.
- [ ] **Step 6:** Generate secrets locally and save for Task 22:

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 16   # CRON_SECRET
# ADMIN_PASSWORD: pick a long passphrase (16+ chars)
```

---

## Task 1: Scaffold, test runner, first commit

**Files:**
- Create: entire Next.js scaffold in `D:\CD Report Hub`
- Create: `vitest.config.ts`, `tests/smoke.test.ts`, `.env.local.example`
- Modify: `package.json` (test script)

- [ ] **Step 1: Scaffold Next.js in the current (empty) directory**

```bash
cd "/d/CD Report Hub"
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

Expected: scaffold completes, `src/app/page.tsx` exists, git repo initialized (verify with `git status`; if not initialized run `git init && git add -A && git commit -m "chore: next.js scaffold"`).

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
npm i @supabase/supabase-js zod
npm i -D vitest
```

Expected: both succeed, `package.json` lists them.

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 4: Add test script to `package.json`** — in the `"scripts"` block add:

```json
"test": "vitest run"
```

- [ ] **Step 5: Write smoke test** — create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test runner", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 7: Create `.env.local.example`**

```bash
# --- required ---
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key-here
ADMIN_PASSWORD=long-passphrase-here
SESSION_SECRET=64-hex-chars-here
# --- spam protection (strongly recommended; site works without but unprotected) ---
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
# --- cron auth (set on Vercel; Vercel sends it automatically to cron routes) ---
CRON_SECRET=
# --- optional: AI dossier drafting (free tiers) ---
GROQ_API_KEY=
OPENROUTER_API_KEY=
# --- optional: Reddit monitor (free OAuth app, type "script") ---
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=
# --- optional: X search via xAI (PAID - leave empty for $0 build; feature stays dormant) ---
XAI_API_KEY=
```

Also copy it to a real `.env.local` and fill in the Task 0 values (`.env.local` is already gitignored by the scaffold — verify with `git check-ignore .env.local`).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold next.js, vitest, env template"
```

---

## Task 2: Design tokens, app shell, shared UI components

The site is a dark, serious incident tracker. One palette, defined once. No Pearl Abyss / Reddit / X logos or artwork anywhere.

**Files:**
- Modify: `src/app/globals.css` (replace scaffold content)
- Modify: `src/app/layout.tsx` (replace scaffold content)
- Create: `src/components/ui.tsx`

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  --bg: #0b0e13;
  --panel: #121722;
  --panel-2: #0f131c;
  --border: #232b3a;
  --text: #e6e9ef;
  --text-dim: #93a0b4;
  --text-faint: #5c687a;
  --crimson: #d84a3a;
  --crimson-dim: #8a2f24;
  --amber: #e0a33a;
  --green: #4fae6b;
  --blue: #4a86d8;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem 1.25rem;
}

.stat-label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
.stat-value { font-size: 1.75rem; font-weight: 600; line-height: 1.2; }

.badge {
  display: inline-block; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
  padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim);
}
.badge-crimson { color: #ff8a7a; border-color: var(--crimson-dim); background: rgba(216, 74, 58, 0.12); }
.badge-amber { color: #f0c274; border-color: #6b4d1b; background: rgba(224, 163, 58, 0.12); }
.badge-green { color: #86d6a0; border-color: #245c38; background: rgba(79, 174, 107, 0.12); }
.badge-dim { color: var(--text-dim); }

.meter { height: 6px; border-radius: 3px; background: var(--panel-2); overflow: hidden; }
.meter > div { height: 100%; border-radius: 3px; }

input, select, textarea {
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 0.5rem 0.75rem; width: 100%; font-size: 0.9rem;
}
input:focus, select:focus, textarea:focus { outline: 2px solid var(--crimson-dim); outline-offset: 0; }
label { font-size: 0.8rem; color: var(--text-dim); display: block; margin-bottom: 4px; }

.btn {
  display: inline-block; background: var(--crimson); color: #fff; font-weight: 600;
  border-radius: 8px; padding: 0.55rem 1.1rem; font-size: 0.9rem; border: none; cursor: pointer;
}
.btn:hover { background: #e75b4b; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-dim); }
.btn-ghost:hover { background: var(--panel-2); color: var(--text); }
```

- [ ] **Step 2: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crimson Desert Report Hub — unofficial community tracker",
  description:
    "Community-run tracker aggregating structured Crimson Desert bug and performance reports for patch 1.13.00. Not affiliated with Pearl Abyss.",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/report", label: "Submit report" },
  { href: "/issues", label: "Issues" },
  { href: "/about", label: "About" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              <span style={{ color: "var(--crimson)" }}>Crimson Desert</span> report hub
            </Link>
            <nav className="flex gap-4 text-sm" style={{ color: "var(--text-dim)" }}>
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-[var(--text)]">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="border-t border-[var(--border)] py-6 text-center text-xs" style={{ color: "var(--text-dim)" }}>
          Unofficial fan-run tracker. Not affiliated with Pearl Abyss, Reddit, or X. No accounts, no ads, no tracking.
          For crash logs use Pearl Abyss&apos;s official support channels.
        </footer>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create `src/components/ui.tsx`**

```tsx
export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: "crimson" | "amber" | "green" | "dim" }) {
  const toneColor =
    tone === "crimson" ? "#ff8a7a" : tone === "amber" ? "#f0c274" : tone === "green" ? "#86d6a0" : "var(--text-dim)";
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="text-xs" style={{ color: toneColor }}>{note}</div> : null}
    </div>
  );
}

export function MeterBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="meter">
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

const FIX_STATUS_META: Record<string, { label: string; cls: string }> = {
  reported: { label: "Reported", cls: "badge badge-dim" },
  acknowledged: { label: "PA acknowledged", cls: "badge badge-amber" },
  fix_claimed: { label: "Fix claimed", cls: "badge badge-amber" },
  verified_fixed: { label: "Verified fixed", cls: "badge badge-green" },
  persists: { label: "Persists after claimed fix", cls: "badge badge-crimson" },
};

export function FixStatusBadge({ status }: { status: string }) {
  const meta = FIX_STATUS_META[status] ?? FIX_STATUS_META.reported;
  return <span className={meta.cls}>{meta.label}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "seed_unverified") return <span className="badge badge-dim">Unverified seed</span>;
  if (confidence === "low") return <span className="badge badge-dim">Low confidence</span>;
  if (confidence === "medium") return <span className="badge badge-amber">Medium confidence</span>;
  return <span className="badge badge-green">Confirmed</span>;
}
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: compiles with no type errors (scaffold home page still present; replaced in Task 12).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dark design system, app shell, shared UI components"
```

---

## Task 3: Constants and env/feature flags (TDD)

**Files:**
- Create: `src/lib/constants.ts`
- Create: `src/lib/env.ts`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Create `src/lib/constants.ts`**

```ts
export const CURRENT_PATCH = "1.13.00";
export const PATCH_VERSIONS = ["1.13.00", "1.12.00", "other"] as const;

export const PLATFORMS = ["pc_steam", "ps5", "ps5_pro", "xbox_series_x", "xbox_series_s", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  pc_steam: "PC (Steam)",
  ps5: "Base PS5",
  ps5_pro: "PS5 Pro",
  xbox_series_x: "Xbox Series X",
  xbox_series_s: "Xbox Series S",
  other: "Other",
};

export const CATEGORIES = ["performance", "crash_startup", "controls_gameplay", "graphics_visual", "audio", "quest_progression", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  performance: "Performance",
  crash_startup: "Crashes and startup",
  controls_gameplay: "Controls and gameplay",
  graphics_visual: "Graphics and visual",
  audio: "Audio",
  quest_progression: "Quests and progression",
  other: "Other",
};

export const SEVERITIES = ["low", "medium", "high", "blocking"] as const;
export const FREQUENCIES = ["once", "sometimes", "often", "always"] as const;

export const FIX_STATUSES = ["reported", "acknowledged", "fix_claimed", "verified_fixed", "persists"] as const;
export const CONFIDENCES = ["seed_unverified", "low", "medium", "confirmed"] as const;
```

- [ ] **Step 2: Write the failing test** — create `tests/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeFeatures } from "@/lib/env";

describe("computeFeatures", () => {
  it("everything off with no keys", () => {
    expect(computeFeatures({})).toEqual({ turnstile: false, reddit: false, ai: false, xSearch: false });
  });

  it("reddit requires all three reddit vars", () => {
    expect(computeFeatures({ REDDIT_CLIENT_ID: "a", REDDIT_CLIENT_SECRET: "b" }).reddit).toBe(false);
    expect(
      computeFeatures({ REDDIT_CLIENT_ID: "a", REDDIT_CLIENT_SECRET: "b", REDDIT_USER_AGENT: "c" }).reddit,
    ).toBe(true);
  });

  it("ai on with either groq or openrouter", () => {
    expect(computeFeatures({ GROQ_API_KEY: "g" }).ai).toBe(true);
    expect(computeFeatures({ OPENROUTER_API_KEY: "o" }).ai).toBe(true);
  });

  it("turnstile and xSearch flip on their keys", () => {
    expect(computeFeatures({ TURNSTILE_SECRET_KEY: "t" }).turnstile).toBe(true);
    expect(computeFeatures({ XAI_API_KEY: "x" }).xSearch).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/env.test.ts`
Expected: FAIL — cannot resolve `@/lib/env`.

- [ ] **Step 4: Create `src/lib/env.ts`**

```ts
type EnvLike = Record<string, string | undefined>;

export type Features = { turnstile: boolean; reddit: boolean; ai: boolean; xSearch: boolean };

export function computeFeatures(env: EnvLike): Features {
  return {
    turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
    reddit: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USER_AGENT),
    ai: Boolean(env.GROQ_API_KEY || env.OPENROUTER_API_KEY),
    xSearch: Boolean(env.XAI_API_KEY),
  };
}

export function features(): Features {
  return computeFeatures(process.env);
}

export function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "ADMIN_PASSWORD" | "SESSION_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/env.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: domain constants and feature flags with tests"
```

---
## Task 4: Database schema and seed taxonomy

**Files:**
- Create: `supabase/migrations/0001_schema.sql`
- Create: `supabase/migrations/0002_seed_clusters.sql`

- [ ] **Step 1: Create `supabase/migrations/0001_schema.sql`**

```sql
-- Crimson Desert Report Hub schema. All access is via service role; RLS is deny-all.

create table issue_clusters (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  slug text not null unique,
  title text not null,
  category text not null check (category in ('performance','crash_startup','controls_gameplay','graphics_visual','audio','quest_progression','other')),
  description text not null default '',
  fix_status text not null default 'reported' check (fix_status in ('reported','acknowledged','fix_claimed','verified_fixed','persists')),
  confidence text not null default 'seed_unverified' check (confidence in ('seed_unverified','low','medium','confirmed')),
  is_public boolean not null default true
);

create table bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  patch_version text not null,
  platform text not null check (platform in ('pc_steam','ps5','ps5_pro','xbox_series_x','xbox_series_s','other')),
  category text not null check (category in ('performance','crash_startup','controls_gameplay','graphics_visual','audio','quest_progression','other')),
  severity text not null check (severity in ('low','medium','high','blocking')),
  frequency text not null check (frequency in ('once','sometimes','often','always')),
  issue_title text not null,
  description text not null,
  repro_steps text,
  expected_behavior text,
  actual_behavior text,
  location_quest text,
  hardware_specs text,
  graphics_mode text,
  driver_os text,
  troubleshooting_tried text,
  pers_id text,
  official_report_submitted boolean not null default false,
  evidence_url text,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected','spam')),
  cluster_id uuid references issue_clusters(id) on delete set null,
  duplicate_fingerprint text not null,
  submitter_ip_hash text
);

create index idx_reports_status on bug_reports (moderation_status);
create index idx_reports_created on bug_reports (created_at desc);
create index idx_reports_fingerprint on bug_reports (duplicate_fingerprint);
create index idx_reports_cluster on bug_reports (cluster_id);
create index idx_reports_ip_time on bug_reports (submitter_ip_hash, created_at desc);

create table approved_excerpts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references bug_reports(id) on delete cascade,
  excerpt_text text not null check (char_length(excerpt_text) <= 500)
);

create table source_signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('reddit','x_manual','x_search')),
  source_url text not null,
  external_id_hash text not null unique,
  summary text not null,
  extracted_facts jsonb not null default '{}'::jsonb,
  category text not null check (category in ('performance','crash_startup','controls_gameplay','graphics_visual','audio','quest_progression','other')),
  confidence text not null check (confidence in ('low','medium','high')),
  observed_at timestamptz not null,
  raw_text text,
  raw_expires_at timestamptz
);

create index idx_signals_observed on source_signals (observed_at desc);

create table dossier_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  markdown text not null,
  provider text not null default 'deterministic',
  stats jsonb not null default '{}'::jsonb
);

-- Deny-all RLS: service role bypasses RLS; anon/authenticated get nothing.
alter table issue_clusters enable row level security;
alter table bug_reports enable row level security;
alter table approved_excerpts enable row level security;
alter table source_signals enable row level security;
alter table dossier_runs enable row level security;
```

- [ ] **Step 2: Create `supabase/migrations/0002_seed_clusters.sql`** — the GPT-report taxonomy, honestly tagged. `combat_airborne_cancel` is not public until direct reports exist.

```sql
insert into issue_clusters (slug, title, category, description, fix_status, confidence, is_public) values
  ('performance_regression', 'FPS / performance regression since 1.13.00', 'performance',
   'Frame-rate drops, stutter, and frame-pacing issues reported after patch 1.13.00 across PC and console.',
   'reported', 'seed_unverified', true),
  ('crash_startup_hang', 'Crashes and startup hangs', 'crash_startup',
   'Crashes to desktop/home and hangs at or shortly after launch.',
   'reported', 'seed_unverified', true),
  ('map_open_crash_persistent', 'Map-open crash (persists after claimed fix)', 'crash_startup',
   'Patch notes claimed a fix for crashes when opening the map; reports indicate it still occurs.',
   'persists', 'seed_unverified', true),
  ('boss_rematch_crash_persistent', 'Boss rematch crash (persists after claimed fix)', 'crash_startup',
   'Patch notes claimed a fix for crashes when rematching bosses; reports indicate it still occurs.',
   'persists', 'seed_unverified', true),
  ('controls_input_gameplay', 'Mount, input, and title-screen lockups', 'controls_gameplay',
   'Horse/mount control failures, unresponsive inputs, and title-screen lockups.',
   'reported', 'seed_unverified', true),
  ('hardware_driver_specific', 'Hardware/driver-specific issues', 'performance',
   'Reports tied to specific hardware or drivers: AMD 26.6.2+, GTX 1060 with FSR/frame-gen, NVIDIA laptop and high-end GPUs.',
   'reported', 'seed_unverified', true),
  ('combat_airborne_cancel', 'Airborne maneuvers canceling mid-combat', 'controls_gameplay',
   'Low-confidence reports of airborne combat maneuvers canceling. Hidden from public top issues until direct submissions confirm.',
   'reported', 'seed_unverified', false);
```

- [ ] **Step 3: Apply both migrations to the Supabase project.**

Preferred (if the Supabase MCP server is connected): use its `apply_migration` tool twice — name `0001_schema` with the contents of the first file, then `0002_seed_clusters` with the second.

Fallback: Supabase dashboard → SQL Editor → paste `0001_schema.sql` → Run → then paste `0002_seed_clusters.sql` → Run.

Expected: both succeed; Table Editor shows 5 tables; `issue_clusters` has 7 rows.

- [ ] **Step 4: Verify RLS is deny-all** — in SQL Editor run:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Expected: all 5 tables show `rowsecurity = true` (and no policies exist, so anon reads return nothing).

- [ ] **Step 5: Commit**

```bash
git add supabase && git commit -m "feat: database schema, deny-all RLS, seed taxonomy (seed_unverified)"
```

---

## Task 5: Supabase server client

**Files:**
- Create: `src/lib/supabase.ts`

- [ ] **Step 1: Create `src/lib/supabase.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/** Server-only. Never import from a client component. */
export function createServiceClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

- [ ] **Step 2: Guard against client-side import** — add as the first line of the file:

```ts
import "server-only";
```

And install the guard package:

```bash
npm i server-only
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: server-only supabase service client"
```

---

## Task 6: Fingerprint + IP hashing (TDD)

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `tests/crypto.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeTitle, reportFingerprint, hashIp } from "@/lib/crypto";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeTitle("  FPS   DROPS!!! since 1.13  ")).toBe("fps drops since 113");
  });
});

describe("reportFingerprint", () => {
  it("is stable for equivalent titles", () => {
    const a = reportFingerprint("performance", "ps5", "FPS drops since 1.13");
    const b = reportFingerprint("performance", "ps5", "fps DROPS since 1.13!!");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs across category or platform", () => {
    const a = reportFingerprint("performance", "ps5", "fps drops");
    expect(reportFingerprint("crash_startup", "ps5", "fps drops")).not.toBe(a);
    expect(reportFingerprint("performance", "pc_steam", "fps drops")).not.toBe(a);
  });
});

describe("hashIp", () => {
  it("is deterministic per secret and never contains the raw ip", () => {
    const h = hashIp("203.0.113.7", "secret1");
    expect(h).toBe(hashIp("203.0.113.7", "secret1"));
    expect(h).not.toBe(hashIp("203.0.113.7", "secret2"));
    expect(h).not.toContain("203");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/crypto.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto`.

- [ ] **Step 3: Create `src/lib/crypto.ts`**

```ts
import { createHash } from "node:crypto";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function reportFingerprint(category: string, platform: string, title: string): string {
  return createHash("sha256").update(`${category}|${platform}|${normalizeTitle(title)}`).digest("hex");
}

/** Salted one-way hash — we never store raw IPs. */
export function hashIp(ip: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
}

export function externalIdHash(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/crypto.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: duplicate fingerprint and salted ip hashing with tests"
```

---

## Task 7: Admin session tokens (TDD)

**Files:**
- Create: `src/lib/session.ts`
- Test: `tests/session.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken, passwordMatches } from "@/lib/session";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const token = createSessionToken(SECRET);
    expect(verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects undefined, malformed, and wrong-secret tokens", () => {
    expect(verifySessionToken(undefined, SECRET)).toBe(false);
    expect(verifySessionToken("garbage", SECRET)).toBe(false);
    expect(verifySessionToken("123.abc", SECRET)).toBe(false);
    const token = createSessionToken(SECRET);
    expect(verifySessionToken(token, "another-secret-another-secret!!")).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken(SECRET, -1000);
    expect(verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rejects tampered expiry", () => {
    const token = createSessionToken(SECRET);
    const [, sig] = token.split(".");
    expect(verifySessionToken(`${Date.now() + 999999999}.${sig}`, SECRET)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("constant-time compare of password strings", () => {
    expect(passwordMatches("hunter2hunter2hunter2", "hunter2hunter2hunter2")).toBe(true);
    expect(passwordMatches("hunter2hunter2hunter2", "wrong")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/session.test.ts`
Expected: FAIL — cannot resolve `@/lib/session`.

- [ ] **Step 3: Create `src/lib/session.ts`**

```ts
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "cd_admin";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessionToken(secret: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const expiresAt = String(Date.now() + ttlMs);
  const sig = createHmac("sha256", secret).update(expiresAt).digest("base64url");
  return `${expiresAt}.${sig}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiresAt, sig] = parts;
  if (!/^\d+$/.test(expiresAt)) return false;
  const expected = createHmac("sha256", secret).update(expiresAt).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  return Number(expiresAt) > Date.now();
}

export function passwordMatches(candidate: string, actual: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(actual).digest();
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/session.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Add the server-side admin guard** — append to `src/lib/session.ts`:

```ts
// --- server helpers (next runtime only) ---
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requiredEnv } from "@/lib/env";

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value, requiredEnv("SESSION_SECRET"));
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
```

Note: `next/headers` imports are inert under vitest because the tests only import the pure functions above them. If vitest complains about the `next/headers` import, split the guard into `src/lib/adminGuard.ts` with the same code and keep `session.ts` pure — then `adminGuard.ts` re-exports nothing testable and pages import `requireAdmin` from `@/lib/adminGuard`.

- [ ] **Step 6: Re-run full test suite**

Run: `npm test`
Expected: all green. If `tests/session.test.ts` now fails to import (because of `next/headers`), do the split described in Step 5 and re-run until green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: hmac session tokens, constant-time password check, admin guard"
```

---

## Task 8: Report validation schema (TDD)

**Files:**
- Create: `src/lib/reportSchema.ts`
- Test: `tests/reportSchema.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/reportSchema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reportSchema } from "@/lib/reportSchema";

const valid = {
  patch_version: "1.13.00",
  platform: "ps5",
  category: "performance",
  severity: "high",
  frequency: "often",
  issue_title: "FPS drops to 20 in Heartlands",
  description: "Since 1.13.00 frame rate tanks in open field combat, was smooth on 1.12. Happens in performance mode.",
};

describe("reportSchema", () => {
  it("accepts a minimal valid report", () => {
    const r = reportSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects short titles and descriptions", () => {
    expect(reportSchema.safeParse({ ...valid, issue_title: "bad" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, description: "too short" }).success).toBe(false);
  });

  it("rejects unknown platform/category/severity/frequency", () => {
    expect(reportSchema.safeParse({ ...valid, platform: "n64" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, category: "vibes" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, severity: "catastrophic" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, frequency: "constantly" }).success).toBe(false);
  });

  it("accepts optional fields as empty strings and normalizes them to null", () => {
    const r = reportSchema.safeParse({ ...valid, repro_steps: "", evidence_url: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.repro_steps).toBeNull();
      expect(r.data.evidence_url).toBeNull();
    }
  });

  it("rejects a non-url evidence_url", () => {
    expect(reportSchema.safeParse({ ...valid, evidence_url: "not a url" }).success).toBe(false);
  });

  it("accepts x.com and reddit.com evidence urls", () => {
    expect(reportSchema.safeParse({ ...valid, evidence_url: "https://x.com/user/status/123" }).success).toBe(true);
    expect(reportSchema.safeParse({ ...valid, evidence_url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/" }).success).toBe(true);
  });

  it("caps description length at 4000", () => {
    expect(reportSchema.safeParse({ ...valid, description: "x".repeat(4001) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reportSchema.test.ts`
Expected: FAIL — cannot resolve `@/lib/reportSchema`.

- [ ] **Step 3: Create `src/lib/reportSchema.ts`**

```ts
import { z } from "zod";
import { PLATFORMS, CATEGORIES, SEVERITIES, FREQUENCIES } from "@/lib/constants";

/** "" -> null, otherwise trimmed string capped at `max`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optionalUrl = z
  .union([z.string().trim().url().max(500), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

export const reportSchema = z.object({
  patch_version: z.string().trim().min(1).max(20),
  platform: z.enum(PLATFORMS),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  frequency: z.enum(FREQUENCIES),
  issue_title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(4000),
  repro_steps: optionalText(2000),
  expected_behavior: optionalText(1000),
  actual_behavior: optionalText(1000),
  location_quest: optionalText(200),
  hardware_specs: optionalText(500),
  graphics_mode: optionalText(200),
  driver_os: optionalText(200),
  troubleshooting_tried: optionalText(1000),
  pers_id: optionalText(50),
  official_report_submitted: z.coerce.boolean().default(false),
  evidence_url: optionalUrl,
  turnstile_token: z.string().optional(),
});

export type ReportInput = z.infer<typeof reportSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/reportSchema.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: zod report schema with empty-string-to-null normalization"
```

---

## Task 9: Turnstile verification (TDD)

Fail-open ONLY when unconfigured (feature disabled); fail-closed whenever a secret exists.

**Files:**
- Create: `src/lib/turnstile.ts`
- Test: `tests/turnstile.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/turnstile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

describe("verifyTurnstile", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("skips (ok) when no secret is configured", async () => {
    const r = await verifyTurnstile("anything", null);
    expect(r).toEqual({ ok: true, skipped: true });
  });

  it("fails when secret exists but no token supplied", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    const r = await verifyTurnstile(undefined, null);
    expect(r).toEqual({ ok: false, skipped: false });
  });

  it("passes through cloudflare success", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }) as unknown as typeof fetch;
    const r = await verifyTurnstile("tok", "203.0.113.7");
    expect(r).toEqual({ ok: true, skipped: false });
  });

  it("fails closed on cloudflare rejection or network error", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/turnstile.test.ts`
Expected: FAIL — cannot resolve `@/lib/turnstile`.

- [ ] **Step 3: Create `src/lib/turnstile.ts`**

```ts
export type CaptchaResult = { ok: boolean; skipped: boolean };

export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<CaptchaResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data = (await res.json()) as { success?: boolean };
    return { ok: data.success === true, skipped: false };
  } catch {
    return { ok: false, skipped: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/turnstile.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: turnstile verification, fail-closed when configured"
```

---
## Task 10: Public submission API — `POST /api/reports` (TDD)

**Files:**
- Create: `src/app/api/reports/route.ts`
- Test: `tests/reportsRoute.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/reportsRoute.test.ts`. We mock the supabase client and turnstile modules so the route logic (validation → captcha → rate limit → insert) is tested in isolation:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const countChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== "bug_reports") throw new Error(`unexpected table ${table}`);
      return {
        insert: insertMock,
        select: countChain.select,
        eq: countChain.eq,
        gte: countChain.gte,
      };
    },
  }),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async (token: string | undefined) =>
    token === "good" || token === undefined ? { ok: token === "good", skipped: false } : { ok: false, skipped: false },
  ),
}));

process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import { POST } from "@/app/api/reports/route";

const valid = {
  patch_version: "1.13.00",
  platform: "ps5",
  category: "performance",
  severity: "high",
  frequency: "often",
  issue_title: "FPS drops to 20 in Heartlands",
  description: "Since 1.13.00 frame rate tanks in open field combat, was smooth on 1.12. Performance mode.",
  turnstile_token: "good",
};

function makeRequest(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ data: null, error: null });
  countChain.select.mockClear().mockReturnThis();
  countChain.eq.mockClear().mockReturnThis();
  countChain.gte.mockReset().mockResolvedValue({ count: 0, error: null });
});

describe("POST /api/reports", () => {
  it("201 on valid report; inserts pending with fingerprint and ip hash, no raw ip", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0];
    expect(row.moderation_status).toBe("pending");
    expect(row.duplicate_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(row.submitter_ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row.turnstile_token).toBeUndefined();
  });

  it("400 on invalid json and on validation failure", async () => {
    const bad = new Request("http://localhost/api/reports", { method: "POST", body: "{not json" });
    expect((await POST(bad)).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, issue_title: "x" }))).status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("403 when captcha fails", async () => {
    const res = await POST(makeRequest({ ...valid, turnstile_token: "bad" }));
    expect(res.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("429 when ip exceeded 5 reports in the past hour", async () => {
    countChain.gte.mockResolvedValue({ count: 5, error: null });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("500 when insert errors", async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reportsRoute.test.ts`
Expected: FAIL — cannot resolve `@/app/api/reports/route`.

- [ ] **Step 3: Create `src/app/api/reports/route.ts`**

```ts
import { NextResponse } from "next/server";
import { reportSchema } from "@/lib/reportSchema";
import { verifyTurnstile } from "@/lib/turnstile";
import { createServiceClient } from "@/lib/supabase";
import { reportFingerprint, hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";

const MAX_PER_HOUR = 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const captcha = await verifyTurnstile(parsed.data.turnstile_token, ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: "captcha_failed" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const ipHash = ip ? hashIp(ip, requiredEnv("SESSION_SECRET")) : null;

  if (ipHash) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("bug_reports")
      .select("id", { count: "exact", head: true })
      .eq("submitter_ip_hash", ipHash)
      .gte("created_at", oneHourAgo);
    if (countError) return NextResponse.json({ error: "rate_check_failed" }, { status: 500 });
    if ((count ?? 0) >= MAX_PER_HOUR) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }

  const { turnstile_token: _drop, ...report } = parsed.data;
  const { error } = await supabase.from("bug_reports").insert({
    ...report,
    moderation_status: "pending",
    duplicate_fingerprint: reportFingerprint(report.category, report.platform, report.issue_title),
    submitter_ip_hash: ipHash,
  });
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
```

Note for the executor: the test mocks `@/lib/supabase`, so the route's chained call `from().select().eq().gte()` must match the mock's chain shape exactly as written above. If you restructure the query, restructure the mock.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/reportsRoute.test.ts`
Expected: 5 passed. (If `server-only` throws under vitest, add `alias: { "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") }` to `vitest.config.ts` resolve.alias and create `tests/stubs/server-only.ts` containing just `export {};`.)

- [ ] **Step 5: Run the whole suite, then commit**

Run: `npm test`
Expected: all green.

```bash
git add -A && git commit -m "feat: public report submission api with captcha, rate limit, fingerprint"
```

---

## Task 11: Aggregate transforms (TDD) + server queries

**Files:**
- Create: `src/lib/aggregates.ts` (pure, tested)
- Create: `src/lib/queries.ts` (server-side, thin)
- Test: `tests/aggregates.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/aggregates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countBy, buildDailySeries, rankClusters } from "@/lib/aggregates";

describe("countBy", () => {
  it("counts by key and ignores null keys", () => {
    const rows = [{ k: "a" }, { k: "b" }, { k: "a" }, { k: null }];
    expect(countBy(rows, (r) => r.k)).toEqual({ a: 2, b: 1 });
  });
});

describe("buildDailySeries", () => {
  it("returns one bucket per day for the window, zero-filled, oldest first", () => {
    const today = new Date("2026-07-05T12:00:00Z");
    const rows = [
      { created_at: "2026-07-05T01:00:00Z" },
      { created_at: "2026-07-05T02:00:00Z" },
      { created_at: "2026-07-03T09:00:00Z" },
      { created_at: "2026-06-01T00:00:00Z" }, // outside window
    ];
    const series = buildDailySeries(rows, 3, today);
    expect(series).toEqual([
      { date: "2026-07-03", count: 1 },
      { date: "2026-07-04", count: 0 },
      { date: "2026-07-05", count: 2 },
    ]);
  });
});

describe("rankClusters", () => {
  it("attaches counts and sorts descending, keeping zero-count clusters", () => {
    const clusters = [
      { id: "c1", title: "One" },
      { id: "c2", title: "Two" },
    ];
    const reports = [{ cluster_id: "c2" }, { cluster_id: "c2" }, { cluster_id: null }];
    const ranked = rankClusters(clusters, reports);
    expect(ranked.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(ranked[0].count).toBe(2);
    expect(ranked[1].count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/aggregates.test.ts`
Expected: FAIL — cannot resolve `@/lib/aggregates`.

- [ ] **Step 3: Create `src/lib/aggregates.ts`**

```ts
export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function buildDailySeries(
  rows: { created_at: string }[],
  days: number,
  today: Date,
): { date: string; count: number }[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const counts = countBy(rows, (r) => dayKey(new Date(r.created_at)));
  const series: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = dayKey(d);
    series.push({ date: key, count: counts[key] ?? 0 });
  }
  return series;
}

export function rankClusters<C extends { id: string }>(
  clusters: C[],
  reports: { cluster_id: string | null }[],
): (C & { count: number })[] {
  const counts = countBy(reports, (r) => r.cluster_id);
  return clusters
    .map((c) => ({ ...c, count: counts[c.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/aggregates.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Create `src/lib/queries.ts`** (thin server layer over supabase — untested by unit tests, exercised by pages):

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase";
import { countBy, buildDailySeries, rankClusters } from "@/lib/aggregates";

export type ClusterRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  fix_status: string;
  confidence: string;
  is_public: boolean;
};

export async function getDashboardData() {
  const supabase = createServiceClient();

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("category, platform, created_at, cluster_id")
    .eq("moderation_status", "approved");
  const rows = reports ?? [];

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, confidence, is_public")
    .eq("is_public", true);

  const { count: pendingCount } = await supabase
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending");

  const { data: latest } = await supabase
    .from("bug_reports")
    .select("created_at")
    .in("moderation_status", ["approved", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    weekDelta: rows.filter((r) => new Date(r.created_at).getTime() > weekAgo).length,
    byCategory: countBy(rows, (r) => r.category),
    platforms: countBy(rows, (r) => r.platform),
    series: buildDailySeries(rows, 30, new Date()),
    topClusters: rankClusters((clusterData ?? []) as ClusterRow[], rows),
    pendingCount: pendingCount ?? 0,
    latestReportAt: latest?.[0]?.created_at ?? null,
  };
}

export async function getIssuesData() {
  const supabase = createServiceClient();

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, confidence, is_public")
    .eq("is_public", true);

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("cluster_id, platform")
    .eq("moderation_status", "approved");

  const { data: excerpts } = await supabase
    .from("approved_excerpts")
    .select("excerpt_text, created_at, bug_reports(cluster_id, platform)")
    .order("created_at", { ascending: false })
    .limit(100);

  const clusters = rankClusters((clusterData ?? []) as ClusterRow[], reports ?? []);
  const excerptsByCluster: Record<string, { text: string; platform: string }[]> = {};
  for (const e of excerpts ?? []) {
    const report = e.bug_reports as unknown as { cluster_id: string | null; platform: string } | null;
    const key = report?.cluster_id ?? "unclustered";
    (excerptsByCluster[key] ??= []).push({ text: e.excerpt_text, platform: report?.platform ?? "other" });
  }
  return { clusters, excerptsByCluster };
}
```

- [ ] **Step 6: Full suite + commit**

Run: `npm test` — all green.

```bash
git add -A && git commit -m "feat: aggregate transforms with tests, server query layer"
```

---

## Task 12: Public dashboard `/` + Sparkline

**Files:**
- Create: `src/components/Sparkline.tsx`
- Modify: `src/app/page.tsx` (replace scaffold content entirely)

- [ ] **Step 1: Create `src/components/Sparkline.tsx`** (server-renderable pure SVG, no chart library):

```tsx
export function Sparkline({ points, width = 640, height = 60 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${(height - (p / max) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Reports per day, last 30 days">
      <path d={path} fill="none" stroke="var(--crimson)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
import Link from "next/link";
import { getDashboardData } from "@/lib/queries";
import { StatCard, MeterBar, FixStatusBadge } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { PLATFORM_LABELS, CATEGORY_LABELS, CURRENT_PATCH } from "@/lib/constants";

export const dynamic = "force-dynamic";

function timeAgo(iso: string | null): string {
  if (!iso) return "no reports yet";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function DashboardPage() {
  const d = await getDashboardData();
  const maxCluster = Math.max(...d.topClusters.map((c) => c.count), 1);
  const platformEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Community report dashboard</h1>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Patch {CURRENT_PATCH} · moderated community reports · last report {timeAgo(d.latestReportAt)}
          </p>
        </div>
        <Link href="/report" className="btn">Submit patch {CURRENT_PATCH} report</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Approved reports" value={d.total} note={`+${d.weekDelta} this week`} tone="green" />
        <StatCard label="Performance" value={d.byCategory.performance ?? 0} note="Top watched category" tone="crimson" />
        <StatCard label="Crashes / startup" value={d.byCategory.crash_startup ?? 0} tone="amber" />
        <StatCard label="Awaiting review" value={d.pendingCount} note="Moderation queue" tone="dim" />
      </div>

      <div className="panel">
        <div className="stat-label mb-2">Reports per day — last 30 days</div>
        <Sparkline points={d.series.map((s) => s.count)} />
      </div>

      <div className="grid gap-3 md:grid-cols-[1.6fr_1fr]">
        <div className="panel">
          <div className="stat-label mb-3">Top issues this patch</div>
          {d.topClusters.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>No issue clusters yet.</p>
          )}
          <div className="space-y-3">
            {d.topClusters.map((c) => (
              <div key={c.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    {c.title} <FixStatusBadge status={c.fix_status} />
                  </span>
                  <span style={{ color: "var(--text-dim)" }}>{c.count} reports</span>
                </div>
                <MeterBar value={c.count} max={maxCluster} color={c.fix_status === "persists" ? "var(--amber)" : "var(--crimson)"} />
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs" style={{ color: "var(--text-dim)" }}>
            Counts include admin-approved direct reports only. Seeded issue clusters start at zero until the community confirms them.
          </p>
        </div>

        <div className="panel">
          <div className="stat-label mb-3">Platforms</div>
          {platformEntries.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>No approved reports yet — be the first.</p>
          )}
          {platformEntries.map(([platform, count]) => (
            <div key={platform} className="flex items-center justify-between border-b py-2 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
              <span>{PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
          <div className="stat-label mb-2 mt-5">By category</div>
          {Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
            <div key={cat} className="flex items-center justify-between py-1 text-sm">
              <span style={{ color: "var(--text-dim)" }}>{CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}</span>
              <span>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run dev server and verify**

Run: `npm run dev` → open http://localhost:3000
Expected: dark dashboard renders with zeros, seeded clusters listed (all showing 0 reports with their fix-status badges), no console errors. `combat_airborne_cancel` must NOT appear (is_public=false).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: public dashboard with sparkline, top issues, platform breakdown"
```

---

## Task 13: `/report` submission form

**Files:**
- Create: `src/app/report/page.tsx`

- [ ] **Step 1: Create `src/app/report/page.tsx`** — client component. Only 7 required fields; everything else folded into a collapsed "Add detail" section so the form never feels like homework:

```tsx
"use client";

import { useState } from "react";
import Script from "next/script";
import {
  PATCH_VERSIONS, PLATFORMS, PLATFORM_LABELS, CATEGORIES, CATEGORY_LABELS, SEVERITIES, FREQUENCIES,
} from "@/lib/constants";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const OPTIONAL_FIELDS: { name: string; label: string; textarea?: boolean; placeholder?: string }[] = [
  { name: "repro_steps", label: "Steps to reproduce", textarea: true, placeholder: "1. Open world map during combat\n2. ..." },
  { name: "expected_behavior", label: "Expected behavior" },
  { name: "actual_behavior", label: "Actual behavior" },
  { name: "location_quest", label: "Location / quest" },
  { name: "hardware_specs", label: "Hardware (GPU, CPU, RAM)", placeholder: "RTX 4060 8GB, i5-13600K, 32GB" },
  { name: "graphics_mode", label: "Graphics mode / FPS setting", placeholder: "Performance mode / FSR on" },
  { name: "driver_os", label: "Driver / OS version", placeholder: "NVIDIA 566.14, Windows 11 24H2" },
  { name: "troubleshooting_tried", label: "Troubleshooting you tried", textarea: true },
  { name: "pers_id", label: "Pearl Abyss PERS ID (if you filed one)" },
  { name: "evidence_url", label: "Evidence link (YouTube, Reddit, X, etc.)", placeholder: "https://..." },
];

export default function ReportPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrors({});
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    fd.forEach((value, key) => {
      if (key === "cf-turnstile-response") payload.turnstile_token = String(value);
      else payload[key] = String(value);
    });
    payload.official_report_submitted = fd.get("official_report_submitted") === "on";

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 201) {
      setStatus("done");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setErrors(data.issues ?? {});
    setMessage(
      res.status === 429
        ? "Rate limit reached — max 5 reports per hour. Thank you for the enthusiasm; try again later."
        : res.status === 403
          ? "Spam check failed. Refresh and try again."
          : "Something in the form needs fixing — see the highlighted fields.",
    );
    setStatus("error");
  }

  if (status === "done") {
    return (
      <div className="panel mx-auto max-w-xl text-center">
        <h1 className="mb-2 text-xl font-semibold">Report received</h1>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Your report is in the moderation queue and will appear in the public counts once reviewed.
          If you have crash logs, please also file through Pearl Abyss&apos;s official support so their
          engineers get the technical data.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Submit a patch report</h1>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Anonymous. No account, no email. Reports are reviewed before appearing in public counts.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="patch_version">Patch version</label>
          <select id="patch_version" name="patch_version" defaultValue="1.13.00">
            {PATCH_VERSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="platform">Platform</label>
          <select id="platform" name="platform" required defaultValue="">
            <option value="" disabled>Select…</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="category">Category</label>
          <select id="category" name="category" required defaultValue="">
            <option value="" disabled>Select…</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="severity">Severity</label>
          <select id="severity" name="severity" required defaultValue="medium">
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="frequency">How often?</label>
          <select id="frequency" name="frequency" required defaultValue="sometimes">
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="issue_title">One-line summary</label>
        <input id="issue_title" name="issue_title" required minLength={5} maxLength={120}
          placeholder="FPS drops to ~20 in open-field combat since 1.13" />
        {errors.issue_title && <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>{errors.issue_title[0]}</p>}
      </div>

      <div>
        <label htmlFor="description">What happened?</label>
        <textarea id="description" name="description" required minLength={20} maxLength={4000} rows={5}
          placeholder="What were you doing, what went wrong, and how does it compare to before the patch?" />
        {errors.description && <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>{errors.description[0]}</p>}
      </div>

      <details className="panel">
        <summary className="cursor-pointer text-sm font-semibold">Add detail (optional — every field helps Pearl Abyss)</summary>
        <div className="mt-4 space-y-3">
          {OPTIONAL_FIELDS.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name}>{f.label}</label>
              {f.textarea
                ? <textarea id={f.name} name={f.name} rows={3} placeholder={f.placeholder} />
                : <input id={f.name} name={f.name} placeholder={f.placeholder} />}
              {errors[f.name] && <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>{errors[f.name][0]}</p>}
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
            <input type="checkbox" name="official_report_submitted" className="w-auto" />
            I also filed this through Pearl Abyss&apos;s official report tool
          </label>
        </div>
      </details>

      {SITE_KEY ? (
        <>
          <div className="cf-turnstile" data-sitekey={SITE_KEY} data-theme="dark" />
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />
        </>
      ) : null}

      {status === "error" && <p className="text-sm" style={{ color: "var(--crimson)" }}>{message}</p>}

      <button className="btn" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev` → http://localhost:3000/report
- Submit with empty required fields → browser blocks (native validation).
- Fill required fields with a real test report → success screen appears.
- Check Supabase Table Editor: row exists in `bug_reports` with `moderation_status = 'pending'`, `duplicate_fingerprint` set, and no raw IP anywhere.
- Submit 6 reports quickly → 6th shows the rate-limit message.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: anonymous report form with optional detail section and turnstile"
```

---

## Task 14: `/issues` and `/about` pages

**Files:**
- Create: `src/app/issues/page.tsx`
- Create: `src/app/about/page.tsx`

- [ ] **Step 1: Create `src/app/issues/page.tsx`**

```tsx
import { getIssuesData } from "@/lib/queries";
import { FixStatusBadge, ConfidenceBadge } from "@/components/ui";
import { PLATFORM_LABELS, CATEGORY_LABELS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const { clusters, excerptsByCluster } = await getIssuesData();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Issue clusters</h1>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Grouped from moderated community reports. Quotes below are admin-approved excerpts —
          raw submissions are never published.
        </p>
      </div>
      {clusters.map((c) => (
        <div key={c.id} className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{c.title}</h2>
            <div className="flex items-center gap-2">
              <FixStatusBadge status={c.fix_status} />
              <ConfidenceBadge confidence={c.confidence} />
            </div>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
            {CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS] ?? c.category} · {c.count} approved reports
          </p>
          <p className="mt-2 text-sm">{c.description}</p>
          {(excerptsByCluster[c.id] ?? []).length > 0 && (
            <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              {(excerptsByCluster[c.id] ?? []).slice(0, 3).map((e, i) => (
                <blockquote key={i} className="text-sm italic" style={{ color: "var(--text-dim)" }}>
                  “{e.text}” — {PLATFORM_LABELS[e.platform as keyof typeof PLATFORM_LABELS] ?? e.platform} player
                </blockquote>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/about/page.tsx`**

```tsx
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">About this tracker</h1>
      <div className="panel space-y-3 text-sm">
        <p>
          The Crimson Desert Report Hub is an unofficial, fan-run community tracker. It exists to turn
          scattered complaints about patch issues into structured, moderated evidence that Pearl Abyss
          can actually act on — and to show players they&apos;re not the only ones hitting a problem.
        </p>
        <p>
          <strong>Not affiliated</strong> with Pearl Abyss, Reddit, or X. No Pearl Abyss assets or
          artwork are used here.
        </p>
      </div>
      <div className="panel space-y-3 text-sm">
        <h2 className="font-semibold">Privacy</h2>
        <p>No accounts. No email. No ads. No analytics trackers.</p>
        <p>
          Submissions are anonymous. We store a salted one-way hash of your IP for one purpose only:
          rate-limiting spam. The raw IP is never stored. Reports are reviewed by a moderator before
          any text appears publicly.
        </p>
      </div>
      <div className="panel space-y-3 text-sm">
        <h2 className="font-semibold">Report to Pearl Abyss too</h2>
        <p>
          This site aggregates community evidence — it does not replace official channels. If you have
          crash dumps or logs, file them with Pearl Abyss support so their engineers get technical data,
          and paste your PERS ID into your report here so we can cross-reference.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification** — visit `/issues` (clusters render with badges, hidden cluster absent) and `/about`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: public issues page with approved excerpts, about page"
```

---
## Task 15: Admin auth — login page + session routes

**Files:**
- Create: `src/app/admin/login/page.tsx`
- Create: `src/app/api/admin/login/route.ts`

- [ ] **Step 1: Create `src/app/api/admin/login/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createSessionToken, passwordMatches, ADMIN_COOKIE } from "@/lib/session";
import { requiredEnv } from "@/lib/env";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.password || !passwordMatches(body.password, requiredEnv("ADMIN_PASSWORD"))) {
    // Small fixed delay to blunt online guessing.
    await new Promise((r) => setTimeout(r, 750));
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(requiredEnv("SESSION_SECRET")), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
```

- [ ] **Step 2: Create `src/app/admin/login/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.push("/admin");
    else setError(true);
  }

  return (
    <form onSubmit={onSubmit} className="panel mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-lg font-semibold">Moderator access</h1>
      <div>
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </div>
      {error && <p className="text-sm" style={{ color: "var(--crimson)" }}>Wrong password.</p>}
      <button className="btn w-full" disabled={busy || password.length === 0}>
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Manual verification** — `npm run dev`, visit `/admin/login`, wrong password → error after ~0.75s; right password (from `.env.local`) → redirects to `/admin` (404 until Task 16 — that's expected).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: admin login with hardened cookie session"
```

---

## Task 16: Admin review queue + server actions

**Files:**
- Create: `src/app/admin/actions.ts`
- Create: `src/app/admin/page.tsx`

- [ ] **Step 1: Create `src/app/admin/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { FIX_STATUSES } from "@/lib/constants";

const DECISIONS = ["approved", "rejected", "spam"] as const;

export async function moderateReport(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const clusterId = String(formData.get("cluster_id") ?? "");
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  if (!id || !(DECISIONS as readonly string[]).includes(decision)) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("bug_reports")
    .update({ moderation_status: decision, cluster_id: clusterId || null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (decision === "approved" && excerpt) {
    await supabase.from("approved_excerpts").insert({ report_id: id, excerpt_text: excerpt.slice(0, 500) });
  }
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/issues");
}

export async function setClusterFixStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const clusterId = String(formData.get("cluster_id") ?? "");
  const fixStatus = String(formData.get("fix_status") ?? "");
  if (!clusterId || !(FIX_STATUSES as readonly string[]).includes(fixStatus)) throw new Error("bad input");
  const supabase = createServiceClient();
  const { error } = await supabase.from("issue_clusters").update({ fix_status: fixStatus }).eq("id", clusterId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/issues");
}
```

- [ ] **Step 2: Create `src/app/admin/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { moderateReport, setClusterFixStatus } from "@/app/admin/actions";
import { PLATFORM_LABELS, CATEGORY_LABELS, FIX_STATUSES } from "@/lib/constants";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createServiceClient();

  const { data: pending } = await supabase
    .from("bug_reports")
    .select("*")
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  const { data: clusters } = await supabase
    .from("issue_clusters")
    .select("id, title, fix_status")
    .order("title");

  const { data: dupes } = await supabase
    .from("bug_reports")
    .select("duplicate_fingerprint")
    .in("moderation_status", ["approved", "pending"]);
  const fingerprintCounts: Record<string, number> = {};
  for (const d of dupes ?? []) {
    fingerprintCounts[d.duplicate_fingerprint] = (fingerprintCounts[d.duplicate_fingerprint] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Moderation queue ({pending?.length ?? 0})</h1>
        <div className="flex gap-2 text-sm">
          <Link className="btn-ghost btn" href="/admin/compile">Compile dossier</Link>
          <Link className="btn-ghost btn" href="/admin/source-monitor">Source monitor</Link>
          <a className="btn-ghost btn" href="/api/admin/export">Export CSV</a>
        </div>
      </div>

      {(pending ?? []).length === 0 && (
        <div className="panel text-sm" style={{ color: "var(--text-dim)" }}>Queue is empty. Rest.</div>
      )}

      {(pending ?? []).map((r) => (
        <div key={r.id} className="panel space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
            <span className="badge badge-dim">{PLATFORM_LABELS[r.platform as keyof typeof PLATFORM_LABELS] ?? r.platform}</span>
            <span className="badge badge-dim">{CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] ?? r.category}</span>
            <span className="badge badge-dim">{r.severity} / {r.frequency}</span>
            <span>patch {r.patch_version}</span>
            <span>{new Date(r.created_at).toLocaleString()}</span>
            {fingerprintCounts[r.duplicate_fingerprint] > 1 && (
              <span className="badge badge-amber">possible duplicate ×{fingerprintCounts[r.duplicate_fingerprint]}</span>
            )}
          </div>
          <div>
            <p className="font-semibold">{r.issue_title}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--text-dim)" }}>{r.description}</p>
            {r.repro_steps && <p className="mt-2 text-sm"><span className="stat-label">Repro: </span>{r.repro_steps}</p>}
            {r.hardware_specs && <p className="text-sm"><span className="stat-label">Hardware: </span>{r.hardware_specs}</p>}
            {r.evidence_url && (
              <p className="text-sm">
                <span className="stat-label">Evidence: </span>
                <a href={r.evidence_url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--blue)" }}>{r.evidence_url}</a>
              </p>
            )}
            {r.pers_id && <p className="text-sm"><span className="stat-label">PERS: </span>{r.pers_id}</p>}
          </div>
          <form action={moderateReport} className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto_auto]">
            <input type="hidden" name="id" value={r.id} />
            <select name="cluster_id" defaultValue="">
              <option value="">No cluster</option>
              {(clusters ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <input name="excerpt" placeholder="Public excerpt (optional, ≤500 chars, anonymized)" maxLength={500} />
            <button className="btn" name="decision" value="approved">Approve</button>
            <button className="btn btn-ghost" name="decision" value="rejected">Reject</button>
            <button className="btn btn-ghost" name="decision" value="spam">Spam</button>
          </form>
        </div>
      ))}

      <div className="panel">
        <div className="stat-label mb-3">Cluster fix-status</div>
        <div className="space-y-2">
          {(clusters ?? []).map((c) => (
            <form key={c.id} action={setClusterFixStatus} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="cluster_id" value={c.id} />
              <span className="flex-1">{c.title}</span>
              <select name="fix_status" defaultValue={c.fix_status} className="w-56">
                {FIX_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
              <button className="btn btn-ghost">Save</button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification** — log in, open `/admin`:
- The test reports from Task 13 appear in the queue.
- Approve one with a cluster + excerpt → it disappears from the queue; `/` total increments; `/issues` shows the excerpt under that cluster.
- Reject one → gone from queue, public counts unchanged.
- Change a cluster's fix-status → badge updates on `/` and `/issues`.
- Sign out (devtools → delete `cd_admin` cookie) → `/admin` redirects to login.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: admin moderation queue, excerpt approval, fix-status editor"
```

---

## Task 17: CSV export (TDD)

**Files:**
- Create: `src/lib/csv.ts`
- Create: `src/app/api/admin/export/route.ts`
- Test: `tests/csv.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { csvEscape, buildCsv } from "@/lib/csv";

describe("csvEscape", () => {
  it("passes plain values, quotes commas/quotes/newlines, doubles quotes", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("emits header row plus data rows in column order", () => {
    const rows = [
      { b: "2", a: "1,x" },
      { a: "3", b: null },
    ];
    const csv = buildCsv(rows, ["a", "b"]);
    expect(csv).toBe('a,b\r\n"1,x",2\r\n3,');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/csv.test.ts`
Expected: FAIL — cannot resolve `@/lib/csv`.

- [ ] **Step 3: Create `src/lib/csv.ts`**

```ts
export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  }
  return lines.join("\r\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/csv.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Create `src/app/api/admin/export/route.ts`**

```ts
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { buildCsv } from "@/lib/csv";

const COLUMNS = [
  "id", "created_at", "patch_version", "platform", "category", "severity", "frequency",
  "issue_title", "description", "repro_steps", "expected_behavior", "actual_behavior",
  "location_quest", "hardware_specs", "graphics_mode", "driver_os", "troubleshooting_tried",
  "pers_id", "official_report_submitted", "evidence_url", "moderation_status", "cluster_id",
];

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("bug_reports")
    .select(COLUMNS.join(","))
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  const csv = buildCsv((data ?? []) as unknown as Record<string, unknown>[], COLUMNS);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cd-reports-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
```

Note: the export deliberately excludes `submitter_ip_hash` and `duplicate_fingerprint` — internal plumbing stays internal.

- [ ] **Step 6: Manual verification** — logged in, click "Export CSV" on `/admin` → file downloads and opens in a spreadsheet. Logged out, `curl -i localhost:3000/api/admin/export` → 401.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: admin csv export with tested escaping"
```

---

## Task 18: Deterministic dossier builder (TDD)

The Pearl Abyss deliverable. Pure function, no AI, no network — always works.

**Files:**
- Create: `src/lib/dossier.ts`
- Test: `tests/dossier.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/dossier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDeterministicDossier, type DossierInput } from "@/lib/dossier";

const input: DossierInput = {
  generatedAt: "2026-07-05T18:00:00Z",
  patchVersion: "1.13.00",
  totalApproved: 40,
  pendingCount: 6,
  byCategory: { performance: 25, crash_startup: 10, controls_gameplay: 5 },
  platforms: { ps5: 18, pc_steam: 15, ps5_pro: 7 },
  clusters: [
    { title: "Map-open crash", fixStatus: "persists", confidence: "confirmed", count: 8, topPlatform: "ps5" },
    { title: "FPS regression", fixStatus: "reported", confidence: "medium", count: 25, topPlatform: "pc_steam" },
    { title: "Airborne cancel", fixStatus: "reported", confidence: "seed_unverified", count: 0, topPlatform: null },
  ],
  reproNotes: [{ title: "Map-open crash", steps: "Open world map during mounted combat" }],
  evidenceUrls: ["https://www.reddit.com/r/CrimsonDesert/comments/abc/"],
};

describe("buildDeterministicDossier", () => {
  const md = buildDeterministicDossier(input);

  it("contains all seven required sections", () => {
    for (const h of [
      "## Executive summary",
      "## Top issues",
      "## Platform and hardware breakdown",
      "## Reproduction patterns",
      "## Evidence links",
      "## Known confidence gaps",
      "## Recommended wording for Pearl Abyss",
    ]) {
      expect(md).toContain(h);
    }
  });

  it("ranks issues by count descending", () => {
    expect(md.indexOf("FPS regression")).toBeLessThan(md.indexOf("Map-open crash"));
  });

  it("flags persists-after-fix issues and excludes zero-count unverified from top issues", () => {
    expect(md).toContain("persists after a claimed fix");
    const topSection = md.split("## Top issues")[1].split("## Platform")[0];
    expect(topSection).not.toContain("Airborne cancel");
  });

  it("lists unverified clusters in confidence gaps", () => {
    const gaps = md.split("## Known confidence gaps")[1];
    expect(gaps).toContain("Airborne cancel");
  });

  it("includes headline numbers", () => {
    expect(md).toContain("40 moderated community reports");
    expect(md).toContain("1.13.00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dossier.test.ts`
Expected: FAIL — cannot resolve `@/lib/dossier`.

- [ ] **Step 3: Create `src/lib/dossier.ts`**

```ts
import { PLATFORM_LABELS, CATEGORY_LABELS } from "@/lib/constants";

export type DossierCluster = {
  title: string;
  fixStatus: string;
  confidence: string;
  count: number;
  topPlatform: string | null;
};

export type DossierInput = {
  generatedAt: string;
  patchVersion: string;
  totalApproved: number;
  pendingCount: number;
  byCategory: Record<string, number>;
  platforms: Record<string, number>;
  clusters: DossierCluster[];
  reproNotes: { title: string; steps: string }[];
  evidenceUrls: string[];
};

const label = (map: Record<string, string>, key: string) => map[key] ?? key;

export function buildDeterministicDossier(d: DossierInput): string {
  const ranked = [...d.clusters].sort((a, b) => b.count - a.count);
  const top = ranked.filter((c) => c.count > 0);
  const gaps = ranked.filter((c) => c.confidence === "seed_unverified" || c.confidence === "low");
  const persists = top.filter((c) => c.fixStatus === "persists");
  const catEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const platEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);

  const lines: string[] = [];
  lines.push(`# Crimson Desert community report dossier — patch ${d.patchVersion}`);
  lines.push("");
  lines.push(`Generated ${d.generatedAt} by the Crimson Desert Report Hub (unofficial community tracker).`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push(
    `This dossier aggregates ${d.totalApproved} moderated community reports for patch ${d.patchVersion}` +
      (d.pendingCount > 0 ? ` (${d.pendingCount} more awaiting moderation)` : "") +
      `. The largest category is ${catEntries[0] ? label(CATEGORY_LABELS, catEntries[0][0]) : "n/a"}` +
      (catEntries[0] ? ` with ${catEntries[0][1]} reports` : "") +
      `. Most affected platform: ${platEntries[0] ? label(PLATFORM_LABELS, platEntries[0][0]) : "n/a"}.`,
  );
  if (persists.length > 0) {
    lines.push("");
    lines.push(
      `${persists.length} issue(s) below are marked **persists after a claimed fix** — patch notes stated a fix, ` +
        `but community reports since the patch indicate the problem continues. These are flagged as the highest-value items to re-examine.`,
    );
  }
  lines.push("");
  lines.push("## Top issues");
  lines.push("");
  lines.push("| Rank | Issue | Reports | Fix status | Confidence | Most-affected platform |");
  lines.push("| ---- | ----- | ------- | ---------- | ---------- | ---------------------- |");
  top.forEach((c, i) => {
    lines.push(
      `| ${i + 1} | ${c.title} | ${c.count} | ${c.fixStatus.replace(/_/g, " ")} | ${c.confidence.replace(/_/g, " ")} | ${
        c.topPlatform ? label(PLATFORM_LABELS, c.topPlatform) : "—"
      } |`,
    );
  });
  if (top.length === 0) lines.push("| — | No clusters have confirmed reports yet | — | — | — | — |");
  lines.push("");
  lines.push("## Platform and hardware breakdown");
  lines.push("");
  for (const [p, n] of platEntries) lines.push(`- ${label(PLATFORM_LABELS, p)}: ${n} reports`);
  if (platEntries.length === 0) lines.push("- No approved reports yet.");
  lines.push("");
  for (const [c, n] of catEntries) lines.push(`- ${label(CATEGORY_LABELS, c)}: ${n} reports`);
  lines.push("");
  lines.push("## Reproduction patterns");
  lines.push("");
  for (const r of d.reproNotes) lines.push(`- **${r.title}**: ${r.steps}`);
  if (d.reproNotes.length === 0) lines.push("- No reproduction steps captured yet.");
  lines.push("");
  lines.push("## Evidence links");
  lines.push("");
  for (const url of d.evidenceUrls) lines.push(`- ${url}`);
  if (d.evidenceUrls.length === 0) lines.push("- No admin-verified evidence links yet.");
  lines.push("");
  lines.push("## Known confidence gaps");
  lines.push("");
  for (const g of gaps) {
    lines.push(
      `- ${g.title}: confidence is ${g.confidence.replace(/_/g, " ")}` +
        (g.count === 0 ? " and no direct community reports yet — treat as unconfirmed." : ` with ${g.count} reports.`),
    );
  }
  if (gaps.length === 0) lines.push("- None — all listed clusters are backed by direct reports.");
  lines.push("");
  lines.push("## Recommended wording for Pearl Abyss");
  lines.push("");
  lines.push(
    `> Community telemetry (self-reported, moderated) for patch ${d.patchVersion} shows ` +
      `${catEntries[0] ? `${label(CATEGORY_LABELS, catEntries[0][0]).toLowerCase()} as the dominant complaint (${catEntries[0][1]}/${d.totalApproved} reports)` : "no dominant category yet"}` +
      (persists.length > 0
        ? `, and ${persists.length} previously-patched issue(s) still being reported post-fix. We recommend prioritizing re-verification of the claimed fixes listed above.`
        : ". No previously-patched issues are currently reported as recurring."),
  );
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dossier.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: deterministic pearl abyss dossier builder with tests"
```

---
## Task 19: Optional AI drafting + `/admin/compile`

AI is admin-only, optional, and fails closed to the deterministic dossier. Public pages never touch it.

**Files:**
- Create: `src/lib/ai.ts`
- Create: `src/app/admin/compile/page.tsx`
- Modify: `src/app/admin/actions.ts` (add `compileDossier`)

- [ ] **Step 1: Create `src/lib/ai.ts`**

```ts
import "server-only";

type Attempt = { name: string; url: string; key: string; model: string };

function attempts(): Attempt[] {
  const list: Attempt[] = [];
  if (process.env.GROQ_API_KEY) {
    list.push({
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    list.push({
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: process.env.OPENROUTER_API_KEY,
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
  }
  return list;
}

const SYSTEM_PROMPT = `You are drafting a community bug-report dossier for the game studio Pearl Abyss.
You will receive a deterministic Markdown dossier built from database aggregates.
Rewrite it into clearer, more professional prose while obeying these hard rules:
- Never invent numbers, issues, platforms, or evidence not present in the input.
- Keep every section heading exactly as-is.
- Keep the Markdown table in "Top issues" with identical data.
- Keep all confidence caveats; do not upgrade unverified claims.
- Neutral, respectful, engineering-report tone. No hype, no blame.`;

export async function draftDossierWithAi(
  deterministicMarkdown: string,
): Promise<{ markdown: string; provider: string } | null> {
  for (const a of attempts()) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${a.key}` },
        body: JSON.stringify({
          model: a.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: deterministicMarkdown },
          ],
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content && content.length > 200) return { markdown: content, provider: a.name };
    } catch {
      continue; // fail closed: fall through to next provider or deterministic
    }
  }
  return null;
}
```

- [ ] **Step 2: Add `compileDossier` to `src/app/admin/actions.ts`** — append:

```ts
import { redirect } from "next/navigation";
import { countBy, rankClusters } from "@/lib/aggregates";
import { buildDeterministicDossier, type DossierCluster } from "@/lib/dossier";
import { draftDossierWithAi } from "@/lib/ai";
import { features } from "@/lib/env";
import { CURRENT_PATCH } from "@/lib/constants";

export async function compileDossier(formData: FormData): Promise<void> {
  await requireAdmin();
  const useAi = formData.get("use_ai") === "on";
  const supabase = createServiceClient();

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("category, platform, cluster_id, evidence_url, repro_steps, issue_title")
    .eq("moderation_status", "approved");
  const rows = reports ?? [];

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, title, fix_status, confidence");

  const { count: pendingCount } = await supabase
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending");

  const ranked = rankClusters(clusterData ?? [], rows);
  const clusters: DossierCluster[] = ranked.map((c) => {
    const clusterRows = rows.filter((r) => r.cluster_id === c.id);
    const platCounts = Object.entries(countBy(clusterRows, (r) => r.platform)).sort((a, b) => b[1] - a[1]);
    return {
      title: c.title,
      fixStatus: c.fix_status,
      confidence: c.confidence,
      count: c.count,
      topPlatform: platCounts[0]?.[0] ?? null,
    };
  });

  const deterministic = buildDeterministicDossier({
    generatedAt: new Date().toISOString(),
    patchVersion: CURRENT_PATCH,
    totalApproved: rows.length,
    pendingCount: pendingCount ?? 0,
    byCategory: countBy(rows, (r) => r.category),
    platforms: countBy(rows, (r) => r.platform),
    clusters,
    reproNotes: rows
      .filter((r) => r.repro_steps)
      .slice(0, 15)
      .map((r) => ({ title: r.issue_title, steps: String(r.repro_steps) })),
    evidenceUrls: [...new Set(rows.map((r) => r.evidence_url).filter((u): u is string => Boolean(u)))].slice(0, 30),
  });

  let markdown = deterministic;
  let provider = "deterministic";
  if (useAi && features().ai) {
    const drafted = await draftDossierWithAi(deterministic);
    if (drafted) ({ markdown, provider } = drafted);
  }

  const { data: run, error } = await supabase
    .from("dossier_runs")
    .insert({ markdown, provider, stats: { totalApproved: rows.length, pendingCount: pendingCount ?? 0 } })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/admin/compile?run=${run.id}`);
}
```

- [ ] **Step 3: Create `src/app/admin/compile/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { compileDossier } from "@/app/admin/actions";
import { features } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function CompilePage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await requireAdmin();
  const { run } = await searchParams;
  const supabase = createServiceClient();
  const aiAvailable = features().ai;

  const { data: runs } = await supabase
    .from("dossier_runs")
    .select("id, created_at, provider")
    .order("created_at", { ascending: false })
    .limit(10);

  let current: { markdown: string; provider: string; created_at: string } | null = null;
  if (run) {
    const { data } = await supabase.from("dossier_runs").select("markdown, provider, created_at").eq("id", run).single();
    current = data;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Compile Pearl Abyss dossier</h1>

      <form action={compileDossier} className="panel flex flex-wrap items-center gap-4">
        <label className="flex w-auto items-center gap-2 text-sm" style={{ color: aiAvailable ? "var(--text)" : "var(--text-dim)" }}>
          <input type="checkbox" name="use_ai" className="w-auto" disabled={!aiAvailable} />
          Draft with AI {aiAvailable ? "(Groq/OpenRouter free tier)" : "— disabled: no AI key configured"}
        </label>
        <button className="btn">Compile now</button>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          Deterministic aggregates always; AI only rewrites prose and fails back to deterministic.
        </span>
      </form>

      {current && (
        <div className="panel space-y-3">
          <div className="flex items-center justify-between">
            <span className="stat-label">
              Generated {new Date(current.created_at).toLocaleString()} · provider: {current.provider}
            </span>
          </div>
          <textarea readOnly rows={24} defaultValue={current.markdown} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>Click into the box to select all, then copy.</p>
        </div>
      )}

      <div className="panel">
        <div className="stat-label mb-2">Previous runs</div>
        {(runs ?? []).map((r) => (
          <a key={r.id} href={`/admin/compile?run=${r.id}`} className="block py-1 text-sm" style={{ color: "var(--blue)" }}>
            {new Date(r.created_at).toLocaleString()} — {r.provider}
          </a>
        ))}
        {(runs ?? []).length === 0 && <p className="text-sm" style={{ color: "var(--text-dim)" }}>No runs yet.</p>}
      </div>
    </div>
  );
}
```

Note: `defaultValue` + `onFocus` on a textarea inside a server component will error — if `npm run build` complains about event handlers, wrap the textarea block in a tiny client component `src/components/DossierOutput.tsx`:

```tsx
"use client";
export function DossierOutput({ markdown }: { markdown: string }) {
  return (
    <textarea readOnly rows={24} defaultValue={markdown} className="w-full font-mono text-xs"
      onFocus={(e) => e.currentTarget.select()} />
  );
}
```

and use `<DossierOutput markdown={current.markdown} />` in the page instead.

- [ ] **Step 4: Manual verification** — `/admin/compile`: with no AI key the checkbox is disabled with the "no AI key" note; "Compile now" produces the deterministic dossier with all 7 sections and real counts; the run appears under Previous runs. With a Groq key in `.env.local`, checking the box produces AI prose with identical numbers.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dossier compile page with optional fail-closed ai drafting"
```

---

## Task 20: Reddit monitor (TDD for pure parts) + `/admin/source-monitor`

Official OAuth API only, admin-triggered only, raw text auto-expires in 48h. Fails closed to a disabled state without keys.

**Files:**
- Create: `src/lib/reddit.ts`
- Create: `src/app/admin/source-monitor/page.tsx`
- Modify: `src/app/admin/actions.ts` (add `runRedditMonitor`)
- Test: `tests/reddit.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/reddit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifySignal, summarize } from "@/lib/reddit";

describe("classifySignal", () => {
  it("routes performance language", () => {
    expect(classifySignal("Constant FPS drops and stutter since 1.13").category).toBe("performance");
  });
  it("routes crash language", () => {
    expect(classifySignal("Game crashes to desktop when opening the map").category).toBe("crash_startup");
  });
  it("routes controls language", () => {
    expect(classifySignal("My horse controls completely lock up randomly").category).toBe("controls_gameplay");
  });
  it("falls back to other with low confidence", () => {
    const r = classifySignal("Anyone else think the soundtrack is great?");
    expect(r.category).toBe("other");
    expect(r.confidence).toBe("low");
  });
});

describe("summarize", () => {
  it("truncates to 280 chars with ellipsis and strips newlines", () => {
    const s = summarize("Title here", "x".repeat(500) + "\nline2");
    expect(s.length).toBeLessThanOrEqual(280);
    expect(s.startsWith("Title here — ")).toBe(true);
    expect(s.includes("\n")).toBe(false);
    expect(s.endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reddit.test.ts`
Expected: FAIL — cannot resolve `@/lib/reddit`.

- [ ] **Step 3: Create `src/lib/reddit.ts`**

```ts
import type { Category } from "@/lib/constants";

const RULES: { category: Category; confidence: "medium" | "low"; patterns: RegExp[] }[] = [
  { category: "performance", confidence: "medium", patterns: [/\bfps\b/i, /stutter/i, /frame ?(rate|pacing|drops?|gen)/i, /performance/i, /\blag(gy|ging)?\b/i] },
  { category: "crash_startup", confidence: "medium", patterns: [/crash/i, /\bctd\b/i, /freez(e|ing)/i, /won'?t (start|launch|load)/i, /hang(s|ing)? (at|on)/i] },
  { category: "controls_gameplay", confidence: "medium", patterns: [/\bhorse\b/i, /\bmount\b/i, /controls?\b/i, /input/i, /lock(s|ed)? ?up/i, /unresponsive/i] },
  { category: "graphics_visual", confidence: "medium", patterns: [/artifact/i, /flicker/i, /texture/i, /\bfsr\b/i, /\bdlss\b/i, /ghosting/i] },
];

export function classifySignal(text: string): { category: Category; confidence: "low" | "medium" } {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return { category: rule.category, confidence: rule.confidence };
  }
  return { category: "other", confidence: "low" };
}

export function summarize(title: string, body: string): string {
  const flat = `${title} — ${body}`.replace(/\s+/g, " ").trim();
  return flat.length <= 280 ? flat : `${flat.slice(0, 279)}…`;
}

// --- network side (server only, no tests — exercised via admin UI) ---

export type RedditPost = { id: string; title: string; selftext: string; permalink: string; created_utc: number };

export async function getRedditToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID!;
  const secret = process.env.REDDIT_CLIENT_SECRET!;
  const ua = process.env.REDDIT_USER_AGENT!;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": ua,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`reddit token failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("reddit token missing in response");
  return data.access_token;
}

export async function fetchNewPosts(subreddit: string, token: string, limit = 25): Promise<RedditPost[]> {
  const res = await fetch(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=${limit}`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": process.env.REDDIT_USER_AGENT! },
  });
  if (!res.ok) throw new Error(`reddit fetch failed for r/${subreddit}: ${res.status}`);
  const data = (await res.json()) as { data?: { children?: { data: RedditPost }[] } };
  return (data.data?.children ?? []).map((c) => c.data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/reddit.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Add `runRedditMonitor` to `src/app/admin/actions.ts`** — append:

```ts
import { features as featureFlags } from "@/lib/env";
import { getRedditToken, fetchNewPosts, classifySignal, summarize } from "@/lib/reddit";
import { externalIdHash } from "@/lib/crypto";

export async function runRedditMonitor(formData: FormData): Promise<void> {
  await requireAdmin();
  if (!featureFlags().reddit) throw new Error("reddit monitor disabled: keys missing");

  const raw = String(formData.get("subreddits") ?? "");
  const subreddits = raw
    .split(",")
    .map((s) => s.trim().replace(/^r\//, ""))
    .filter(Boolean)
    .slice(0, 5);
  if (subreddits.length === 0) throw new Error("no subreddits given");

  const token = await getRedditToken();
  const supabase = createServiceClient();
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  for (const sub of subreddits) {
    const posts = await fetchNewPosts(sub, token);
    for (const post of posts) {
      const text = `${post.title} ${post.selftext ?? ""}`;
      const { category, confidence } = classifySignal(text);
      await supabase.from("source_signals").upsert(
        {
          source: "reddit",
          source_url: `https://www.reddit.com${post.permalink}`,
          external_id_hash: externalIdHash("reddit", post.id),
          summary: summarize(post.title, post.selftext ?? ""),
          extracted_facts: { subreddit: sub, classified: category },
          category,
          confidence,
          observed_at: new Date(post.created_utc * 1000).toISOString(),
          raw_text: (post.selftext ?? "").slice(0, 8000) || null,
          raw_expires_at: expires,
        },
        { onConflict: "external_id_hash", ignoreDuplicates: true },
      );
    }
  }
  revalidatePath("/admin/source-monitor");
}
```

- [ ] **Step 6: Create `src/app/admin/source-monitor/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { runRedditMonitor } from "@/app/admin/actions";
import { features } from "@/lib/env";
import { CATEGORY_LABELS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function SourceMonitorPage() {
  await requireAdmin();
  const f = features();
  const supabase = createServiceClient();
  const { data: signals } = await supabase
    .from("source_signals")
    .select("id, source, source_url, summary, category, confidence, observed_at")
    .order("observed_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Source monitor</h1>

      <div className="panel space-y-3">
        <div className="stat-label">Reddit (official OAuth API)</div>
        {f.reddit ? (
          <form action={runRedditMonitor} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor="subreddits">Subreddits (comma-separated, max 5)</label>
              <input id="subreddits" name="subreddits" defaultValue="CrimsonDesert" />
            </div>
            <button className="btn">Run monitor now</button>
          </form>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Disabled — set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT to enable.
            The site is fully functional without it.
          </p>
        )}
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Raw post text auto-purges after 48 hours; only summaries, categories, and URLs are kept.
          Signals are internal evidence — they never appear on public pages.
        </p>
      </div>

      <div className="panel space-y-3">
        <div className="stat-label">X / xAI search</div>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          {f.xSearch
            ? "XAI_API_KEY detected — automated X search available (paid usage applies per run)."
            : "Dormant — automated X search requires a paid xAI key. X evidence still flows in via the report form's evidence link field, verified by a moderator."}
        </p>
      </div>

      <div className="panel">
        <div className="stat-label mb-2">Recent signals ({signals?.length ?? 0})</div>
        {(signals ?? []).map((s) => (
          <div key={s.id} className="border-b py-2 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span className="badge badge-dim">{s.source}</span>
              <span className="badge badge-dim">{CATEGORY_LABELS[s.category as keyof typeof CATEGORY_LABELS] ?? s.category}</span>
              <span>{s.confidence} confidence</span>
              <span>{new Date(s.observed_at).toLocaleString()}</span>
            </div>
            <p className="mt-1">{s.summary}</p>
            <a href={s.source_url} target="_blank" rel="noreferrer noopener" className="text-xs" style={{ color: "var(--blue)" }}>
              {s.source_url}
            </a>
          </div>
        ))}
        {(signals ?? []).length === 0 && <p className="text-sm" style={{ color: "var(--text-dim)" }}>No signals yet.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Manual verification** — without Reddit keys: page shows both disabled states. With keys in `.env.local`: "Run monitor now" against `CrimsonDesert` populates Recent signals with categorized summaries; re-running doesn't duplicate (unique `external_id_hash`).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: reddit source monitor with classification, 48h raw-text expiry, disabled states"
```

---

## Task 21: Keep-alive cron + raw-text purge

Supabase free projects pause after ~7 days without API activity. One daily cron solves it and enforces the 48h purge promise.

**Files:**
- Create: `src/app/api/cron/keepalive/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Create `src/app/api/cron/keepalive/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient();

  // Touch the database so the free project never pauses.
  const { error: touchError } = await supabase.from("issue_clusters").select("id").limit(1);

  // Enforce the privacy promise: purge expired raw source text.
  const { error: purgeError } = await supabase
    .from("source_signals")
    .update({ raw_text: null, raw_expires_at: null })
    .lt("raw_expires_at", new Date().toISOString())
    .not("raw_text", "is", null);

  return NextResponse.json({
    ok: !touchError && !purgeError,
    touch: touchError?.message ?? "ok",
    purge: purgeError?.message ?? "ok",
  });
}
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/keepalive", "schedule": "0 9 * * *" }
  ]
}
```

(Hobby plan allows daily crons. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when the `CRON_SECRET` env var is set on the project.)

- [ ] **Step 3: Manual verification** — `curl -i http://localhost:3000/api/cron/keepalive` with no `CRON_SECRET` set locally → 200 `{"ok":true,...}`. Set `CRON_SECRET=x` in `.env.local`, restart, same curl → 401; with header `-H "authorization: Bearer x"` → 200.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: daily keepalive cron with raw-text purge"
```

---

## Task 22: Deploy to production

**Files:** none new. All free tiers.

- [ ] **Step 1: Final local gate**

```bash
npm test && npm run build
```

Expected: all tests pass, build succeeds. Do not deploy on red.

- [ ] **Step 2: Push to GitHub**

```bash
git remote add origin https://github.com/<YOUR_USER>/cd-report-hub.git
git push -u origin main
```

- [ ] **Step 3: Import to Vercel** — vercel.com → Add New → Project → import `cd-report-hub`. Framework auto-detects Next.js. Before deploying, add Environment Variables (Production):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from Task 0)
- `ADMIN_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET` (from Task 0 Step 6)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
- Optional if present: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`

Deploy. Expected: build succeeds, site live at `https://<project>.vercel.app`.

- [ ] **Step 4: Add the real hostname to Turnstile** — Cloudflare dashboard → Turnstile → the site → add `<project>.vercel.app` to allowed hostnames.

- [ ] **Step 5: Production smoke test (every item, in order)**
1. `/` renders the dashboard with seed clusters at 0.
2. Submit a real report at `/report` (Turnstile widget visible) → success screen.
3. `/admin/login` → sign in → report is in queue → approve with excerpt + cluster.
4. `/` count incremented; `/issues` shows the excerpt.
5. `/admin/compile` → compile → dossier renders with real numbers.
6. Export CSV → downloads.
7. `curl -i https://<project>.vercel.app/api/cron/keepalive` → 401 (secret enforced).
8. Vercel dashboard → Cron Jobs → shows the keepalive job scheduled.
9. Delete the test report in Supabase Table Editor if you don't want it in launch data (or leave it — your call as admin).

- [ ] **Step 6: Commit any fixes found during smoke test, push, and tag**

```bash
git tag v1.0.0 && git push --tags
```

---

## Task 23: Launch checklist (distribution is a feature)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Crimson Desert Report Hub

Unofficial, fan-run community tracker for Crimson Desert patch issues.
Turns structured, moderated community reports into evidence Pearl Abyss can act on.

- No accounts, no ads, no trackers. Anonymous submissions, moderation-gated public data.
- Not affiliated with Pearl Abyss, Reddit, or X.

## Stack
Next.js (App Router) · Supabase Postgres (deny-all RLS, server-only access) · Vercel · Cloudflare Turnstile.
Optional, fail-closed: Groq/OpenRouter dossier drafting, Reddit OAuth monitor.

## Development
```bash
cp .env.local.example .env.local   # fill in values
npm install
npm test
npm run dev
```

## Environment
See `.env.local.example`. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, SESSION_SECRET.
Everything else is optional and the corresponding feature shows a clear disabled state without it.
```

- [ ] **Step 2: Before announcing anywhere, verify the compliance posture**
- Check Pearl Abyss's current fan content guidelines before adding ANY game artwork, logo, or name styling beyond plain text. Current build uses plain text only — compliant by construction.
- Confirm the footer disclaimer renders on every page (it's in the layout).
- Confirm `/about` privacy text matches actual behavior (it does: salted IP hash only, 48h raw-text purge, moderation gate).

- [ ] **Step 3: Message the subreddit moderators BEFORE posting publicly.** Template (adapt, don't paste blindly):

> Hi mods — I built an unofficial, non-commercial community tracker for patch issues: structured anonymous reports, moderated before anything goes public, compiled into a report Pearl Abyss can actually use. No ads, no accounts, no data collection beyond the reports themselves. Would you be open to me posting it, and if the community finds it useful, would you consider adding it to the sidebar/wiki? Happy to adjust anything about it based on your feedback. Link: https://<project>.vercel.app

- [ ] **Step 4: Launch post** — post to the subreddit (with mod blessing) framed as *"a place to see you're not the only one"*, not as a complaint site. Include one screenshot of the dashboard. Ask people to include hardware details in reports.

- [ ] **Step 5: First dossier cadence** — compile weekly while 1.13 is hot. Post a public summary of each dossier back to the community thread. This closes the loop that makes people keep reporting.

- [ ] **Step 6: Commit**

```bash
git add README.md && git commit -m "docs: readme and launch checklist" && git push
```

---

## Self-review (performed at plan-writing time)

- **Spec coverage:** All acceptance criteria from the handoff doc map to tasks: anonymous structured reports (T8/T10/T13), live public aggregates (T11/T12), no raw unmoderated public text (T14/T16 — only `approved_excerpts` render publicly), admin review/excerpts/CSV/compile (T16/T17/T19), Vercel+Supabase free only (T21/T22), optional fail-closed AI and monitors with visible disabled states (T19/T20), performance-regression-first framing with weak combat evidence hidden (`0002_seed_clusters.sql`: `combat_airborne_cancel` `is_public=false`, all seeds `seed_unverified`). Additions beyond the handoff doc, agreed in brainstorming: fix-status lifecycle (T4/T16/T18), Turnstile + rate limiting (T9/T10), keep-alive cron (T21), X-via-evidence-URL (T8/T13/T20).
- **Known deviations:** xAI X search is intentionally NOT implemented as a runner — only its feature flag and UI state exist (T3/T20), per the $0 decision; wiring a runner is a future task gated on a paid key. `dossier_runs.stats` stores summary counts only.
- **Type consistency check:** `ClusterRow` (queries) vs `rankClusters` generic — compatible (`{ id: string }` constraint). `DossierCluster.fixStatus` is camelCase in the lib while DB uses `fix_status` — the mapping happens once in `compileDossier` (T19 Step 2). `features()` is the only env gate used in UI; `computeFeatures` is its tested core.
- **Executor warnings:** (1) The route test in T10 mocks the exact supabase call chain — keep query shape and mock in sync. (2) `session.ts` mixes pure crypto with `next/headers` imports; T7 Step 5 documents the split remedy if vitest chokes. (3) `searchParams` is a Promise in Next 15 — already handled in T19. (4) Windows path has a space — quote `"/d/CD Report Hub"` in every shell command.
