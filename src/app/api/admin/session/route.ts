import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminSessionSecret } from "@/lib/adminGuard";
import { currentSessionGeneration } from "@/lib/adminSessions.server";
import { ADMIN_COOKIE, adminCookieOptions, createSessionToken, readSessionToken, sessionNeedsRenewal } from "@/lib/session";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Keeps a used login alive. Operator pages call this once per visit, and a
 * session issued more than a day ago is re-issued for another 30 days, so a
 * login lapses only after a month without admin use. A session from before
 * "Sign out everywhere" is refused and never renewed.
 */
export async function POST() {
  const secret = adminSessionSecret();
  const store = await cookies();
  const session = secret ? readSessionToken(store.get(ADMIN_COOKIE)?.value, secret) : null;
  if (!secret || !session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (!sessionNeedsRenewal(session)) return new NextResponse(null, { status: 204, headers: NO_STORE });
  const generation = await currentSessionGeneration();
  if (generation === null) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  if (generation !== session.generation) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const res = new NextResponse(null, { status: 204, headers: NO_STORE });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(secret, generation), adminCookieOptions());
  return res;
}
