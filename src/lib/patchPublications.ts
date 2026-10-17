import { editorialArticles, type EditorialArticle } from "./editorialArticles";
import { isValidPatchVersion } from "./officialPatch";
import { matchesPatchVersion } from "./patchWatch";
import type { ClaimedFix } from "./officialPatch.server";

export type PatchEdition = {
  version: string;
  officialUrl: string;
  publishedAt: string | null;
  observedAt: string;
  fixes: ClaimedFix[];
  totalClaimedFixes: number | null;
};

export const RUNDOWN_FIX_LIMIT = 6;

export function comparePatchVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function patchPath(version: string): `/patches/${string}` {
  return `/patches/${version.replaceAll(".", "-")}`;
}

export function patchVersionFromSlug(slug: string): string | null {
  if (!/^\d+-\d{1,2}(?:-\d{1,2})?$/.test(slug)) return null;
  const version = slug.replaceAll("-", ".");
  return isValidPatchVersion(version) ? version : null;
}

export function patchRundown(edition: PatchEdition): EditorialArticle {
  const version = edition.version;
  const title = `Crimson Desert patch ${version}: patch notes rundown`;
  const description = `Pearl Abyss’s official notes for patch ${version}, with a short rundown of the listed fixes and a link to the full update.`;
  const highlights = edition.fixes.slice(0, RUNDOWN_FIX_LIMIT).map(({ fixText }) => fixText);
  return {
    publicationKind: "rundown",
    slug: `patch-${version.replaceAll(".", "-")}`,
    path: `/articles/patch-${version.replaceAll(".", "-")}`,
    section: "Patch notes rundown",
    patchVersion: version,
    title,
    searchTitle: title,
    description,
    publishedAt: edition.publishedAt ?? edition.observedAt,
    sourceNote: "From Pearl Abyss’s official patch notes. Listed fixes are developer claims, not player verification.",
    heroImage: { src: "/official/combat.jpg", width: 1920, height: 1080, alt: "Two fighters in a stone courtyard in Crimson Desert. Official artwork by Pearl Abyss." },
    sources: [{ label: `Pearl Abyss — Patch ${version} notes`, url: edition.officialUrl }],
    catchUp: {
      kind: Number(version.split(".")[2] ?? 0) > 0 ? "hotfix" : "update",
      publishedAt: edition.publishedAt ?? edition.observedAt,
      availableAt: edition.observedAt,
      title: `Patch ${version}: official notes`,
      summary: description,
      highlights: highlights.length ? [highlights[0], ...highlights.slice(1)] : ["Read Pearl Abyss’s complete notes for the changes and platform rollout."],
    },
  };
}

/** Manual coverage wins only for the same exact version. No scanner content enters this list. */
export function patchPublications(editions: readonly PatchEdition[], manual: readonly EditorialArticle[] = editorialArticles): EditorialArticle[] {
  const rundowns = editions.filter((edition) => !manual.some((article) => matchesPatchVersion(article.patchVersion, edition.version))).map(patchRundown);
  return [...manual, ...rundowns].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function frontPagePublications(articles: readonly EditorialArticle[], manual: readonly EditorialArticle[] = editorialArticles): EditorialArticle[] {
  const latestPatch = articles.filter((article) => article.patchVersion).toSorted((a, b) => comparePatchVersions(b.patchVersion!, a.patchVersion!))[0];
  const latestNews = articles.filter((article) => !article.patchVersion).toSorted((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
  const lead = latestNews && (!latestPatch || Date.parse(latestNews.publishedAt) > Date.parse(latestPatch.publishedAt))
    ? latestNews : latestPatch ?? articles[0];
  if (!lead) return [];
  const ordered = [lead, latestPatch, ...manual].filter((article): article is EditorialArticle => !!article);
  return ordered.filter((article, index) => ordered.findIndex((item) => item.path === article.path) === index);
}
