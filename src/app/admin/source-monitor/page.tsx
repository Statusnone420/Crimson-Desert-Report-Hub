import { redirect } from "next/navigation";
import { workspaceHref } from "@/lib/operatorWorkspace";

// The source monitor lives in the authenticated Scanner workspace.
// Kept as a redirect so existing bookmarks and in-app links keep working.
export default function SourceMonitorRedirect() {
  redirect(workspaceHref("scanner"));
}
