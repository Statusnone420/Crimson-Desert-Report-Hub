import Link from "next/link";
import { DirectionIcon } from "@/components/newspaper/ReadingLink";
import { PatchArchiveRail } from "@/components/newspaper/PatchArchiveRail";
import { patchPath, type PatchEdition } from "@/lib/patchPublications";

export function PatchArchive({ editions, unavailable }: { editions: readonly PatchEdition[]; unavailable: boolean }) {
  return <section className="patch-archive" id="archive" aria-labelledby="patch-archive-title">
    <p className="kicker">The official record</p>
    <div className="patch-archive-heading">
      <h2 id="patch-archive-title">Patch archive</h2>
      <p>A preview from Pearl Abyss’s notes. Open a patch for the full record.</p>
    </div>
    {unavailable ? <p role="status">Patch history could not be loaded. Try again shortly.</p> : editions.length === 0 ? <p>No official patches are in the archive yet.</p> : <PatchArchiveRail versions={editions.map((edition) => edition.version)}>
      {editions.map((edition) => {
        const preview = edition.fixes[0];
        return <li key={edition.version} className="patch-archive-item">
          <Link className="patch-preview" href={patchPath(edition.version)} prefetch={false} aria-label={`Patch ${edition.version}`}>
            <span className="patch-preview-date">{edition.publishedAt ? <time dateTime={edition.publishedAt}>{new Date(edition.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time> : "Official date unavailable"}</span>
            <h3><span>Patch</span>{edition.version}</h3>
            <div className="patch-preview-copy">
              {preview?.section ? <p className="patch-preview-section">{preview.section}</p> : null}
              <p className="patch-preview-excerpt">{preview?.fixText ?? "Read the official notes for this update. A fix preview is not available."}</p>
            </div>
            <span className="patch-preview-footer"><span>{edition.totalClaimedFixes === null ? "Official notes" : `${edition.totalClaimedFixes} listed ${edition.totalClaimedFixes === 1 ? "fix" : "fixes"}`}</span><span>Read patch <DirectionIcon /></span></span>
          </Link>
        </li>;
      })}
    </PatchArchiveRail>}
  </section>;
}
