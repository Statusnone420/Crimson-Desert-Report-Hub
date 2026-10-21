import Link from "next/link";
import { formatUtcTimestamp } from "@/lib/editorials/content";
import { countdownWords, EXPANSION } from "@/lib/expansion";

/** One line before release, from the time the newest official notice sets. */
export function LaunchClock({ at, days }: { at: string; days: number }) {
  return (
    <p className="launch-clock">
      <Link href={EXPANSION.path}>{EXPANSION.name}</Link> lands {countdownWords(days)}, <time dateTime={at}>{formatUtcTimestamp(at)}</time>.
    </p>
  );
}
