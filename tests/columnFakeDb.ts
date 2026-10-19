import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * An in-memory stand-in for the column's tables and functions, with the same unique
 * constraints and the same reserve, settle, merge and approve rules as the migration.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { code?: string; message: string } | null };

export type FakeDb = {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  touched: Set<string>;
  missing: Set<string>;
};

const COLUMN_TABLES = ["editorials", "editorial_ai_spend", "style_notes", "voice_examples"];

function missingError(table: string): Result {
  return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` } };
}

function compare(value: unknown, other: unknown): number {
  if (typeof value === "number" && typeof other === "number") return value - other;
  return String(value ?? "").localeCompare(String(other ?? ""));
}

/** A column's value, or a key inside a JSON column for PostgREST's `column->>key`. */
function field(row: Row, column: string): unknown {
  const [base, key] = column.split("->>");
  if (key === undefined) return row[column];
  const value = row[base];
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] ?? null : null;
}

export function createFakeDb(seed: Partial<Record<string, Row[]>> = {}, now: () => Date = () => new Date()): FakeDb {
  const tables: Record<string, Row[]> = {
    automation_settings: [{ key: "scanner", value: { paused: false }, updated_at: "2026-10-01T00:00:00Z" }],
    editorials: [], editorial_ai_spend: [], style_notes: [], voice_examples: [],
    ...Object.fromEntries(Object.entries(seed).map(([key, rows]) => [key, structuredClone(rows ?? [])])),
  };
  const touched = new Set<string>();
  const missing = new Set<string>();
  let sequence = 0;

  function uniqueViolation(table: string, candidate: Row, ignoreId?: unknown): boolean {
    if (table !== "editorials") return false;
    return tables.editorials.some((row) => row.id !== ignoreId && (
      (!candidate.is_test && !row.is_test && row.slot_key === candidate.slot_key)
      || (candidate.slug != null && row.slug === candidate.slug)
    ));
  }

  function builder(table: string) {
    touched.add(table);
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    const orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
    let limit: number | null = null;
    let offset = 0;
    let returning = false;
    // PostgREST's `alias:column->>key` columns, added to each row read.
    let aliases: [string, string][] = [];
    const withAliases = (row: Row): Row => ({ ...row, ...Object.fromEntries(aliases.map(([alias, path]) => [alias, field(row, path)])) });

    function run(): Result {
      if (missing.has(table)) return missingError(table);
      const rows = tables[table] ??= [];
      if (mode === "insert") {
        const inserted: Row[] = [];
        for (const raw of payload) {
          const row: Row = {
            id: raw.id ?? `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
            ...(table === "editorials" ? { is_test: false, author: "Statusnone", created_at: now().toISOString(), updated_at: now().toISOString(), publish_at: null, vetoed_at: null, published_at: null, slug: null } : {}),
            ...(table === "style_notes" || table === "voice_examples" ? { created_at: now().toISOString() } : {}),
            ...raw,
          };
          if (uniqueViolation(table, row)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          if (table === "voice_examples" && rows.length + inserted.length >= 5) return { data: null, error: { code: "23514", message: "voice_examples_limit" } };
          inserted.push(row);
        }
        rows.push(...inserted);
        return { data: returning ? inserted.map((row) => ({ ...row })) : null, error: null };
      }
      let matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (mode === "delete") {
        tables[table] = rows.filter((row) => !matched.includes(row));
        return { data: returning ? matched.map((row) => ({ ...row })) : null, error: null };
      }
      if (mode === "update") {
        for (const row of matched) if (uniqueViolation(table, { ...row, ...patch }, row.id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        for (const row of matched) Object.assign(row, patch);
        return { data: returning ? matched.map((row) => ({ ...row })) : null, error: null };
      }
      for (const order of [...orders].reverse()) {
        matched = [...matched].sort((a, b) => {
          const left = field(a, order.column);
          const right = field(b, order.column);
          if (order.nullsFirst !== undefined && (left == null) !== (right == null)) return (left == null) === order.nullsFirst ? -1 : 1;
          return compare(left, right) * (order.ascending ? 1 : -1);
        });
      }
      if (limit !== null || offset) matched = matched.slice(offset, limit === null ? undefined : offset + limit);
      return { data: matched.map(withAliases), error: null };
    }

    const query = {
      select: (columns = "*") => {
        if (mode !== "select") returning = true;
        aliases = columns.split(",").map((column) => column.trim().split(":")).filter((pair): pair is [string, string] => pair.length === 2 && pair[1].includes("->>"));
        return query;
      },
      insert: (rows: Row | Row[]) => { mode = "insert"; payload = Array.isArray(rows) ? rows : [rows]; return query; },
      update: (values: Row) => { mode = "update"; patch = values; return query; },
      delete: () => { mode = "delete"; return query; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      neq: (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return query; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query; },
      is: (column: string, value: null) => { filters.push((row) => (row[column] ?? null) === value); return query; },
      not: (column: string, operator: string, value: null) => { if (operator === "is" && value === null) filters.push((row) => row[column] != null); return query; },
      gte: (column: string, value: string) => { filters.push((row) => row[column] != null && Date.parse(String(row[column])) >= Date.parse(value)); return query; },
      lte: (column: string, value: string) => { filters.push((row) => row[column] != null && Date.parse(String(row[column])) <= Date.parse(value)); return query; },
      // PostgREST's or filter, for the terms the column uses: `column.is.null` and `column.gt.<time>`.
      or: (expression: string) => {
        const terms = expression.split(",").map((term) => {
          const [column, operator] = term.split(".", 2);
          return { column, operator, value: term.slice(column.length + operator.length + 2) };
        });
        filters.push((row) => terms.some(({ column, operator, value }) => {
          if (operator === "is" && value === "null") return row[column] == null;
          if (operator === "gt") return row[column] != null && Date.parse(String(row[column])) > Date.parse(value);
          throw new Error(`The fake database can't read the or term ${column}.${operator}.${value}`);
        }));
        return query;
      },
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => { orders.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst }); return query; },
      limit: (count: number) => { limit = count; return query; },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return query; },
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return query;
  }

  function settingsRow(): Row | undefined {
    return tables.automation_settings.find((row) => row.key === "column");
  }

  const rpcs: Record<string, (args: Row) => Result> = {
    editorial_ai_reserve: (args) => {
      if (missing.has("editorial_ai_spend")) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.editorial_ai_reserve in the schema cache" } };
      const month = now().toISOString().slice(0, 7);
      const spent = tables.editorial_ai_spend.filter((row) => row.month === month).reduce((sum, row) => sum + Number(row.settled_usd ?? row.reserved_usd), 0);
      const reserve = Math.ceil(Number(args.p_reserved_usd) * 1e8) / 1e8;
      if (reserve > Number(args.p_request_cap_usd)) return { data: { status: "blocked", reason: "request_cap", spentUsd: spent }, error: null };
      if (spent + reserve > Math.min(Number(args.p_monthly_cap_usd), 50)) return { data: { status: "blocked", reason: "monthly_cap", spentUsd: spent }, error: null };
      if (args.p_operation === "test_writer") {
        const today = now().toISOString().slice(0, 10);
        const tests = tables.editorial_ai_spend.filter((row) => row.operation === "test_writer" && String(row.created_at).slice(0, 10) === today).length;
        if (tests >= Number(args.p_test_daily_cap)) return { data: { status: "blocked", reason: "test_daily_cap", spentUsd: spent }, error: null };
      }
      tables.editorial_ai_spend.push({ id: args.p_id, month, operation: args.p_operation, provider: args.p_provider, model: args.p_model, reserved_usd: reserve, settled_usd: null, cost_state: "reserved", created_at: now().toISOString() });
      return { data: { status: "reserved", reservedUsd: reserve, spentUsd: spent }, error: null };
    },
    editorial_ai_settle: (args) => {
      const row = tables.editorial_ai_spend.find((item) => item.id === args.p_id);
      if (!row) return { data: "missing", error: null };
      if (row.cost_state !== "reserved") return { data: "already_settled", error: null };
      Object.assign(row, { settled_usd: Math.ceil(Number(args.p_settled_usd) * 1e8) / 1e8, cost_state: args.p_state, input_tokens: args.p_input_tokens, output_tokens: args.p_output_tokens });
      return { data: "settled", error: null };
    },
    editorial_settings_merge: (args) => {
      const row = settingsRow();
      if (row) row.value = { ...(row.value as Row), ...(args.p_patch as Row) };
      else tables.automation_settings.push({ key: "column", value: { ...(args.p_patch as Row) }, updated_at: now().toISOString() });
      return { data: settingsRow()!.value, error: null };
    },
    editorial_settings_clear_next_model: (args) => {
      const row = settingsRow();
      if (!row || (row.value as Row).nextEditionModel !== args.p_model) return { data: false, error: null };
      row.value = { ...(row.value as Row), nextEditionModel: null };
      return { data: true, error: null };
    },
    voice_examples_reorder: (args) => {
      const ids = args.p_ids as string[];
      const rows = tables.voice_examples;
      const current = [...rows].sort((a, b) => compare(a.position, b.position) || compare(a.created_at, b.created_at) || compare(a.id, b.id)).map((row) => row.id);
      if (JSON.stringify(current) !== JSON.stringify(args.p_expected ?? null)) {
        return { data: null, error: { code: "22023", message: "voice_examples_reorder_stale" } };
      }
      if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !rows.some((row) => row.id === id))) {
        return { data: null, error: { code: "22023", message: "voice_examples_reorder_mismatch" } };
      }
      for (const [position, id] of ids.entries()) Object.assign(rows.find((row) => row.id === id)!, { position });
      return { data: ids.length, error: null };
    },
    editorial_approve: (args) => {
      const edition = tables.editorials.find((row) => row.id === args.p_id && row.status === "held" && !row.is_test && row.publish_at == null && row.vetoed_at == null);
      if (!edition) return { data: "not_pending", error: null };
      Object.assign(edition, { status: "published", publish_at: now().toISOString(), published_at: now().toISOString() });
      const row = settingsRow();
      const remaining = row && typeof (row.value as Row).approveFirstRemaining === "number" ? (row.value as Row).approveFirstRemaining as number : 3;
      if (row) row.value = { ...(row.value as Row), approveFirstRemaining: Math.max(remaining - 1, 0) };
      else tables.automation_settings.push({ key: "column", value: { approveFirstRemaining: 2 } });
      return { data: "approved", error: null };
    },
  };

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Row) => {
      touched.add(`rpc:${name}`);
      const handler = rpcs[name];
      if (!handler) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } };
      return handler(args);
    },
  } as unknown as SupabaseClient;

  return { client, tables, touched, missing };
}

export function markColumnTablesMissing(db: FakeDb): void {
  for (const table of COLUMN_TABLES) db.missing.add(table);
}
