import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * True when the request carries exactly `Authorization: Bearer <secret>`. Both sides
 * are hashed to one length first, so the comparison takes the same time whatever
 * the header holds and cannot leak the secret one character at a time.
 */
export function hasCronAuthorization(req: Request, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}
