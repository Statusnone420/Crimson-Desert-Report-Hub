import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";

export async function GET() {
  return NextResponse.json({ admin: await isAdmin() });
}
