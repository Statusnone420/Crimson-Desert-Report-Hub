"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

export type PublicClaim = { fixText: string; category: string | null; section: string | null };
export type ClaimGroup = { key: string; label: string; visual: string; claims: PublicClaim[] };

const SECTION_ART: Record<string, { icon: string; image: string; position: string; alt: string }> = {
  content: { icon: "scroll-text", image: "/official/content.jpg", position: "40% center", alt: "An adventurer overlooking a riverside settlement" },
  combat: { icon: "swords", image: "/official/combat.jpg", position: "46% center", alt: "Two armored fighters clashing in a stone courtyard" },
  interface: { icon: "panels-top-left", image: "/official/interface.png", position: "48% center", alt: "An adventurer facing a stone mechanism" },
  graphics: { icon: "aperture", image: "/official/graphics.jpg", position: "center", alt: "A sunlit valley with distant mountains" },
  localization: { icon: "languages", image: "/official/localization.jpg", position: "40% center", alt: "A group of armed travelers gathered by torchlight" },
  other: { icon: "wrench", image: "/official/other.jpg", position: "48% center", alt: "A Crimson Desert environment" },
};

function visualForSection(section: string | null): string {
  const normalized = section?.trim().toLocaleLowerCase() ?? "";
  if (normalized.startsWith("content")) return "content";
  if (normalized.startsWith("combat") || normalized.includes("action") || normalized.startsWith("controls")) return "combat";
  if (normalized.startsWith("interface") || normalized.startsWith("ui")) return "interface";
  if (normalized.startsWith("graphics")) return "graphics";
  if (normalized.startsWith("localization") || normalized.startsWith("language")) return "localization";
  return "other";
}
function artFor(visual: string) { return SECTION_ART[visual] ?? SECTION_ART.other; }
function CategorySymbol({ visual }: { visual: string }) { const art = artFor(visual); return <span className="category-symbol" aria-hidden="true" style={{ maskImage: `url(/icons/${art.icon}.svg)` }} />; }

/** Preserve official order and section headings. Legacy rows stay flat rather than receiving an invented heading. */
export function buildClaimGroups(claims: PublicClaim[]): ClaimGroup[] {
  const groups: ClaimGroup[] = [];
  for (const claim of claims) {
    const key = claim.section?.trim() || "";
    const previous = groups.at(-1);
    if (previous && previous.key === key) {
      previous.claims.push(claim);
      continue;
    }
    groups.push({ key, label: key || "Official claims", visual: visualForSection(claim.section), claims: [claim] });
  }
  return groups;
}

export function filterClaimGroups(groups: ClaimGroup[], query: string, selected: string): ClaimGroup[] {
  const search = query.trim().toLocaleLowerCase();
  return groups
    .filter((group) => selected === "all" || group.key === selected)
    .map((group) => ({ ...group, claims: group.claims.filter((claim) => `${group.label} ${claim.fixText}`.toLocaleLowerCase().includes(search)) }))
    .filter((group) => group.claims.length > 0);
}

export function ClaimsRecord({ claims, claimsUnavailable, sourceTotal, officialUrl }: { claims: PublicClaim[]; claimsUnavailable: boolean; sourceTotal: number | null | undefined; officialUrl: string }) {
  const [selected, setSelected] = useState("all");
  const [search, setSearch] = useState("");
  const groups = useMemo(() => buildClaimGroups(claims), [claims]);
  const visibleGroups = useMemo(() => filterClaimGroups(groups, search, selected), [groups, search, selected]);
  const visibleCount = visibleGroups.reduce((count, group) => count + group.claims.length, 0);
  const selectedGroup = groups.find((group) => group.key === selected);
  const selectedArt = selectedGroup ? artFor(selectedGroup.visual) : null;
  const sourceHasMore = typeof sourceTotal === "number" && sourceTotal > claims.length;
  function selectGroup(key: string) { setSelected(key); setSearch(""); }

  if (claimsUnavailable) return <section id="claims" className="claims-record" aria-labelledby="claims-title"><div className="claims-heading"><div><p className="kicker">Inside the update</p><h2 id="claims-title">The official claims record is unavailable.</h2></div><p>The official register could not be read. This is not a report of zero claimed fixes.</p></div><a className="action" href={officialUrl} target="_blank" rel="noreferrer noopener">Read Pearl Abyss’s complete notes ↗</a></section>;

  return <section id="claims" className="claims-record" aria-labelledby="claims-title">
    <div className="claims-heading"><div><p className="kicker">Inside the update</p><h2 id="claims-title">What changed in your corner of Pywel?</h2></div><p>Browse the official fix claims exactly as stored from the current notes.</p></div>
    {groups.length > 1 ? <div className="category-index" role="group" aria-label="Filter claims by official section">{groups.map((group, index) => <button className={`category-choice category-${group.visual}`} key={`${group.key}-${index}`} aria-label={`${group.label}, ${group.claims.length} ${group.claims.length === 1 ? "claim" : "claims"}`} aria-pressed={selected === group.key} aria-controls="claim-results" onClick={() => selectGroup(group.key)}><CategorySymbol visual={group.visual} /><span className="category-name">{group.label}</span><span className="category-total">{group.claims.length} {group.claims.length === 1 ? "claim" : "claims"}</span>{selected === group.key ? <span className="claim-filter-line" aria-hidden="true" /> : null}</button>)}</div> : null}
    <div className="claims-controls"><button className="view-all-claims" aria-pressed={selected === "all" && !search} onClick={() => selectGroup("all")}>View all {claims.length} fixes <span aria-hidden="true">↗</span></button><label className="claim-search"><span>Find a fix</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setSelected("all"); }} placeholder="Search official claims…" /></label></div>
    <div className="claim-results-bar"><p className="claim-count" role="status">Showing {visibleCount} of {claims.length} stored official fix claims{selectedGroup ? ` · ${selectedGroup.label}` : ""}</p>{search ? <button className="clear-claims" onClick={() => selectGroup("all")}>Clear search</button> : null}</div>
    {sourceHasMore ? <p className="claims-register-note">Showing the first {claims.length} of {sourceTotal} official fixes.</p> : null}
    <div id="claim-results" className={selectedArt ? `selected-claims category-${selectedGroup?.visual}` : "all-claims"}>{selectedArt ? <div className="claim-feature"><figure className="claim-art"><Image src={selectedArt.image} alt={selectedArt.alt} width={1920} height={1080} sizes="(max-width: 750px) 112px, 48vw" style={{ objectPosition: selectedArt.position }} /><figcaption>Image: Pearl Abyss</figcaption></figure><p className="claim-feature-title">Official patch notes</p><p className="claim-feature-description">The image illustrates the section. The claims below are the official record.</p></div> : null}<div className="claim-ledger">{visibleGroups.map((group, groupIndex) => { const groupId = `claims-${group.key || "official"}-${groupIndex}`; return <section className={`claim-group category-${group.visual}`} key={groupId} aria-labelledby={groupId}><div className="claim-group-heading"><h3 id={groupId}><CategorySymbol visual={group.visual} />{group.label}</h3><span>{group.claims.length.toString().padStart(2, "0")}</span></div><ul>{group.claims.map((claim, index) => <li key={`${groupId}-${index}`}>{claim.fixText}</li>)}</ul><a className="claim-source" href={officialUrl} target="_blank" rel="noreferrer noopener">Read the complete patch notes ↗</a></section>; })}</div></div>
    {visibleCount === 0 ? <div className="claims-empty"><h3>No matching claims.</h3><p>Try another phrase or clear the search to see the stored register.</p></div> : null}
  </section>;
}
