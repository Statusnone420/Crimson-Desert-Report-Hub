import { describe, expect, it } from "vitest";
import { countIndependentDomains, domainTier, isProviderContextSource, isReconExtractDomain } from "@/lib/automation/domains";

describe("search trust and recon reading", () => {
  it("keeps Reddit, GameSpot and Steam discussions trusted for search but never reads their pages", () => {
    for (const host of ["reddit.com", "old.reddit.com", "www.reddit.com", "gamespot.com", "www.gamespot.com", "steamcommunity.com"]) {
      expect(domainTier(host)).toBe("trusted");
      expect(isReconExtractDomain(host)).toBe(false);
    }
    // The two-source rule still counts them.
    expect(countIndependentDomains(["old.reddit.com", "steamcommunity.com"])).toEqual({ independentDomainCount: 2, trustedDomainCount: 2 });
  });

  it("reads only the sites verified as readable", () => {
    for (const host of ["www.ign.com", "pcgamer.com", "www.eurogamer.net", "rockpapershotgun.com", "polygon.com", "www.youtube.com",
      "crimsondesert.pearlabyss.com", "crimsondesertgame.wiki.fextralife.com", "crimsondesert.wiki.fextralife.com"]) {
      expect(isReconExtractDomain(host)).toBe(true);
    }
    for (const host of ["resetera.com", "x.com", "twitter.com", "store.steampowered.com", "kotaku.com", "example.com",
      "eldenring.wiki.fextralife.com", "fextralife.com", "", null]) {
      expect(isReconExtractDomain(host)).toBe(false);
    }
  });

  it("trusts the Crimson Desert wiki on Fextralife without trusting the rest of Fextralife", () => {
    expect(domainTier("crimsondesertgame.wiki.fextralife.com")).toBe("trusted");
    expect(domainTier("CrimsonDesert.Wiki.Fextralife.com.")).toBe("trusted");
    expect(domainTier("eldenring.wiki.fextralife.com")).toBe("unknown");
    expect(domainTier("fextralife.com")).toBe("unknown");
    expect(countIndependentDomains(["crimsondesertgame.wiki.fextralife.com", "reddit.com"])).toEqual({ independentDomainCount: 2, trustedDomainCount: 2 });
    expect(countIndependentDomains(["eldenring.wiki.fextralife.com", "reddit.com"])).toEqual({ independentDomainCount: 2, trustedDomainCount: 1 });
    // The wiki and Fextralife's forums are one registrable domain: one source.
    expect(countIndependentDomains(["crimsondesertgame.wiki.fextralife.com", "fextralife.com"])).toEqual({ independentDomainCount: 1, trustedDomainCount: 1 });
  });

  it("treats the publisher's Steam announcements as official context and leaves player pages alone", () => {
    expect(isProviderContextSource({ url: "https://store.steampowered.com/news/app/3321460/view/1844751498217378" })).toBe(true);
    expect(isProviderContextSource({ url: "https://steamcommunity.com/games/3321460/announcements/detail/1844751498217378" })).toBe(true);
    expect(isProviderContextSource({ domain: "steamcommunity.com", url: "https://steamcommunity.com/app/3321460/discussions/0/582810005140000021/" })).toBe(false);
    expect(isProviderContextSource({ url: "https://store.steampowered.com/app/3321460/Crimson_Desert/" })).toBe(false);
    expect(isProviderContextSource({ url: "https://store.steampowered.com/news/app/1234567/view/1" })).toBe(false);
  });
});
