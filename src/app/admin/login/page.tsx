import { Suspense } from "react";
import { LoginForm } from "@/app/admin/login/LoginForm";
import { PublicShell } from "@/components/dispatch/Chrome";

// Signed-out surface: public chrome (crimson topline). The amber operator
// chrome appears only after authentication. The Suspense boundary is required
// because the form reads ?from= via useSearchParams on a static page.
export default function AdminLoginPage() {
  return (
    <PublicShell>
      <div className="dispatch-container" style={{ paddingBlock: 40, minHeight: "50vh" }}>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </PublicShell>
  );
}
