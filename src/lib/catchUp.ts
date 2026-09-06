import { CATCH_UP_HIGHLIGHTS_START, CATCH_UP_MILESTONES, type CatchUpMilestone } from "./catchUpContent";

export type CatchUpSelection = { kind: "highlights" } | { kind: "all" } | { kind: "since"; value: string } | { kind: "patch"; value: string };

export function parseCatchUpHash(hash: string, now = new Date()): CatchUpSelection {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("history") === "all") return { kind: "all" };
  const patch = params.get("patch");
  if (patch && CATCH_UP_MILESTONES.some((item) => item.patch === patch)) return { kind: "patch", value: patch };
  const since = params.get("since");
  if (since && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(since)) {
    const time = Date.parse(since);
    if (Number.isFinite(time) && time <= now.getTime() && new Date(time).toISOString().slice(0, 10) === since.slice(0, 10)) {
      return { kind: "since", value: new Date(time).toISOString() };
    }
  }
  return { kind: "highlights" };
}

export function catchUpHash(selection: CatchUpSelection, chapter?: string) {
  const params = new URLSearchParams();
  if (selection.kind === "all") params.set("history", "all");
  else if (selection.kind !== "highlights") params.set(selection.kind, selection.value);
  if (chapter) params.set("chapter", chapter);
  return params.size ? `#${params}` : "";
}

export function parseCatchUpChapter(hash: string): string | null {
  const chapter = new URLSearchParams(hash.replace(/^#/, "")).get("chapter");
  return chapter === "cu-brief" || CATCH_UP_MILESTONES.some((item) => item.id === chapter) ? chapter : null;
}

export function selectCatchUpMilestones(selection: CatchUpSelection, milestones: readonly CatchUpMilestone[] = CATCH_UP_MILESTONES) {
  if (selection.kind === "all") return [...milestones];
  if (selection.kind === "highlights") return milestones.filter((item) => Date.parse(item.publishedAt) >= Date.parse(CATCH_UP_HIGHLIGHTS_START));
  if (selection.kind === "patch") {
    const index = milestones.findIndex((item) => item.patch === selection.value);
    return index < 0 ? [...milestones] : milestones.slice(index + 1);
  }
  return milestones.filter((item) => Date.parse(item.publishedAt) > Date.parse(selection.value));
}

export function catchUpDate(value: string, year = false) {
  return new Date(value).toLocaleDateString("en-US", { month: "long", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function catchUpSelectionLabel(selection: CatchUpSelection) {
  if (selection.kind === "all") return "Full history";
  if (selection.kind === "patch") return `After patch ${selection.value}`;
  if (selection.kind === "since") return `Since ${new Date(selection.value).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
  return "The recent highlights";
}
