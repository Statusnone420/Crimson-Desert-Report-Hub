import { redirect } from "next/navigation";

// The source monitor now lives at the role-aware /scanner tab (admin view).
// Kept as a redirect so existing bookmarks and in-app links keep working.
export default function SourceMonitorRedirect() {
  redirect("/scanner");
}
