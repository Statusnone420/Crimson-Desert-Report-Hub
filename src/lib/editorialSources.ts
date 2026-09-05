export type EditorialSourceKind = "official" | "press" | "creator";

export type EditorialSource = {
  id: string;
  kind: EditorialSourceKind;
  label: string;
  allowedHosts: readonly string[];
  allowSubdomains: boolean;
  enabled: boolean;
  verifiedChannelId: string | null;
  canonicalHandleUrl?: string;
  rssUrl?: string;
};

/** Separate from scanner trust: only these sources can enter the newspaper. */
export const EDITORIAL_SOURCES = [
  {
    id: "pearl-abyss-crimson-desert",
    kind: "official",
    label: "Pearl Abyss · Crimson Desert",
    allowedHosts: ["crimsondesert.pearlabyss.com"],
    allowSubdomains: false,
    enabled: true,
    verifiedChannelId: null,
  },
  {
    id: "pc-gamer",
    kind: "press",
    label: "PC Gamer",
    allowedHosts: ["pcgamer.com", "www.pcgamer.com"],
    allowSubdomains: false,
    enabled: true,
    verifiedChannelId: null,
  },
  {
    id: "khraze-gaming",
    kind: "creator",
    label: "KhrazeGaming",
    allowedHosts: ["youtube.com", "www.youtube.com"],
    allowSubdomains: false,
    enabled: true,
    verifiedChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
    canonicalHandleUrl: "https://www.youtube.com/@Khrazegaming",
    rssUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCFXUSG_393wZJaRTErU6Pjw",
  },
] as const satisfies readonly EditorialSource[];

export function editorialSourceById(id: string): EditorialSource | null {
  return EDITORIAL_SOURCES.find((source) => source.id === id) ?? null;
}

export function sourceAllowsHost(source: EditorialSource, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return source.allowedHosts.some((allowedHost) => {
    const allowed = allowedHost.toLowerCase();
    return host === allowed || (source.allowSubdomains && host.endsWith("." + allowed));
  });
}
