import { CATCH_UP_HIGHLIGHTS_START, CATCH_UP_MILESTONES, type CatchUpMilestone } from "./catchUpContent";

export type CatchUpSelection = { kind: "highlights" } | { kind: "since"; value: string } | { kind: "patch"; value: string };

export function parseCatchUpHash(hash: string, now = new Date()): CatchUpSelection {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
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

export function catchUpHash(selection: CatchUpSelection) {
  if (selection.kind === "highlights") return "";
  return `#${new URLSearchParams({ [selection.kind]: selection.value })}`;
}

export function selectCatchUpMilestones(selection: CatchUpSelection, milestones: readonly CatchUpMilestone[] = CATCH_UP_MILESTONES) {
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
  if (selection.kind === "patch") return `Since patch ${selection.value}`;
  if (selection.kind === "since") return `Since ${catchUpDate(selection.value)}`;
  return "The recent highlights";
}
