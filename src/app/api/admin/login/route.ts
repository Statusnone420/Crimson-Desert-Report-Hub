import { NextResponse } from "next/server";
import { ADMIN_COOKIE, createSessionToken, passwordMatches } from "@/lib/session";
import { requiredEnv } from "@/lib/env";
import { readLoginPassword, reserveLoginAttempt } from "@/lib/adminLogin.server";
import { isVercelPreview } from "@/lib/previewGuard";

export async function POST(req: Request) {
  if (isVercelPreview()) {
    return NextResponse.json({ error: "preview_sign_in_disabled" }, { status: 403 });
  }
  if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "json_required" }, { status: 415 });
  }
  const password = await readLoginPassword(req);
  if (password === null) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  let secret: string;
  let actual: string;
  try {
    secret = requiredEnv("SESSION_SECRET");
    actual = requiredEnv("ADMIN_PASSWORD");
  } catch {
    return NextResponse.json({ error: "sign_in_unavailable" }, { status: 503 });
  }

  const admission = await reserveLoginAttempt(req, secret);
  if (!admission) return NextResponse.json({ error: "sign_in_unavailable" }, { status: 503 });
  if (!admission.allowed) {
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429, headers: { "Retry-After": String(admission.retryAfter), "Cache-Control": "no-store" },
    });
  }
  if (!await passwordMatches(password, actual, secret)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
