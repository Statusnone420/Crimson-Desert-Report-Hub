import { permanentRedirect } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The public written-report intake has permanently moved to the issue board. */
export default async function ReportPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ issue?: string | string[] }>;
} = {}) {
  const { issue } = await searchParams;
  const destination = typeof issue === "string" && UUID.test(issue)
    ? `/issues#issue-${encodeURIComponent(issue)}`
    : "/issues";

  permanentRedirect(destination);
}
