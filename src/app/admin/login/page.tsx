import { LoginForm } from "@/app/admin/login/LoginForm";
import { PublicShell } from "@/components/dispatch/Chrome";

// Signed-out surface: public chrome (crimson topline). The amber operator
// chrome appears only after authentication.
export default function AdminLoginPage() {
  return (
    <PublicShell>
      <div className="dispatch-container" style={{ paddingBlock: 40, minHeight: "50vh" }}>
        <LoginForm />
      </div>
    </PublicShell>
  );
}
