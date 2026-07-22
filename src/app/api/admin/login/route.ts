import { NextResponse } from "next/server";
import { ADMIN_COOKIE, createSessionToken, passwordMatches } from "@/lib/session";
import { requiredEnv } from "@/lib/env";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.password || !passwordMatches(body.password, requiredEnv("ADMIN_PASSWORD"), requiredEnv("SESSION_SECRET"))) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(requiredEnv("SESSION_SECRET")), {
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
