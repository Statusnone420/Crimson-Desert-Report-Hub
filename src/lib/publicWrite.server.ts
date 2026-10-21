import "server-only";
import { ipNetwork } from "@/lib/crypto";

/** A write sent by this site's own pages: Fetch Metadata when the browser sends it, else Origin. */
export function isSameOriginRequest(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

/** The client address and the network it counts as, or null when either is missing. */
export function requestNetwork(req: Request): { ip: string; network: string } | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const network = ip ? ipNetwork(ip) : null;
  return ip && network ? { ip, network } : null;
}
