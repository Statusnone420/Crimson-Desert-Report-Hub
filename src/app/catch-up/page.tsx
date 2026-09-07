import type { ResolvingMetadata } from "next";
import { PublicShell } from "@/components/dispatch/Chrome";
import { CatchUpExperience } from "@/components/catchup/CatchUpExperience";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata("Catch up on Pywel", "/catch-up", "A short Crimson Desert briefing, followed by a chronological journey through recent updates and announcements. Choose where to begin.", parent);
}

export default function CatchUpPage() {
  return <PublicShell><CatchUpExperience /></PublicShell>;
}
