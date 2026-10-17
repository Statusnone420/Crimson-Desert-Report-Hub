import type { ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/dispatch/Chrome";
import { ClaimsRecord } from "@/components/newspaper/ClaimsRecord";
import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { getPatchPublications } from "@/lib/patchPublications.server";
import { patchPath, patchVersionFromSlug } from "@/lib/patchPublications";
import { claimReviewKey } from "@/lib/claimReview";
import { routeMetadata } from "@/lib/site";
import { matchesPatchVersion } from "@/lib/patchWatch";

export const revalidate = 300;
type Props = { params: Promise<{ version: string }> };

async function resolveEdition({ params }: Props) {
  const version = patchVersionFromSlug((await params).version);
  if (!version) notFound();
  const catalog = await getPatchPublications();
  if (catalog.unavailable) throw new Error("Patch history is temporarily unavailable. Please try again shortly.");
  const edition = catalog.editions.find((item) => item.version === version);
  if (!edition) notFound();
  return { edition, article: catalog.articles.find((item) => matchesPatchVersion(item.patchVersion, version)) };
}

export async function generateMetadata(props: Props, parent: ResolvingMetadata) {
  const { edition } = await resolveEdition(props);
  return routeMetadata(`Crimson Desert patch ${edition.version}: official fix record`, patchPath(edition.version), `Official fix claims and source notes for Crimson Desert patch ${edition.version}.`, parent);
}

export default async function PatchEditionPage(props: Props) {
  const { edition, article } = await resolveEdition(props);
  return <PublicShell active="patches">
    <div className="dispatch-container article-paper patch-paper" id="patch-top">
      <section className="patch-heading">
        <ReadingLink variant="quiet" direction="back" className="back-link" href="/patches#archive">Back to the patch archive</ReadingLink>
        <p className="kicker">The patch archive</p>
        <h1>Patch {edition.version}</h1>
        {edition.publishedAt && <p>Official notes published <time dateTime={edition.publishedAt}>{new Date(edition.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></p>}
        <p className="patch-intro">The official fix record for this version. Developer claims do not establish that a player’s issue is resolved.</p>
        <div className="patch-heading-actions">
          {article && <ReadingLink href={article.path}>{article.publicationKind === "rundown" ? "Read the rundown" : "Read the report"}</ReadingLink>}
          <ReadingLink variant="source" href={edition.officialUrl}>Read Pearl Abyss’s complete notes</ReadingLink>
          <ReadingLink variant="quiet" href="/patches">Current patch and player record</ReadingLink>
        </div>
      </section>
      <ClaimsRecord claims={edition.fixes.map((fix) => ({ ...fix, key: claimReviewKey(edition.version, fix.fixText) }))} claimsUnavailable={false} sourceTotal={edition.totalClaimedFixes} officialUrl={edition.officialUrl} />
    </div>
  </PublicShell>;
}
