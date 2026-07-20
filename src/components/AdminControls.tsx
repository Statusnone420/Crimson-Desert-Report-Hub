"use client";

import { usePathname, useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

async function readAdminStatus(): Promise<boolean> {
  try {
    const response = await fetch("/api/admin/status", { cache: "no-store" });
    if (!response.ok) return false;
    const data = (await response.json()) as { admin?: boolean };
    return data.admin === true;
  } catch {
    return false;
  }
}

export function AdminControls() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const router = useRouter();
  const pathname = usePathname();

  // /admin/login renders its own full-page sign-in form; showing the footer
  // popover there presented two competing sign-in forms at once.
  if (pathname?.startsWith("/admin")) return null;

  async function onAdminClick() {
    setError(false);
    if (admin === true) {
      router.push("/admin");
      return;
    }

    setOpen(true);
    if (admin === null) {
      setBusy(true);
      const hasAccess = await readAdminStatus();
      setBusy(false);
      setAdmin(hasAccess);
      if (hasAccess) {
        setOpen(false);
        router.push("/admin");
      }
    }
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(true);
      return;
    }
    setPassword("");
    setAdmin(true);
    setOpen(false);
    router.push("/admin");
  }

  return (
    <div className="relative">
      <button type="button" onClick={onAdminClick} aria-expanded={open}>
        Admin
      </button>
      {open ? (
        <div className="pointer-events-none fixed inset-0 z-[var(--z-dropdown)]">
          <div className="pointer-events-auto absolute bottom-16 right-4 w-72 max-w-[calc(100vw-2rem)]">
            <div
              className="max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto"
              style={{
                background: "var(--dispatch-inset)",
                border: "1px solid rgba(236, 227, 208, 0.18)",
                borderTop: "2px solid var(--rule-strong)",
                padding: "16px 18px",
                textTransform: "none",
                letterSpacing: "normal",
                fontFamily: "var(--font-sans)",
              }}
            >
              <div>
                <div className="mono-label">Operator sign-in</div>
                <p className="mt-1 text-sm" style={{ color: "var(--dispatch-dim)" }}>
                  Sign in to open the admin workspace.
                </p>
              </div>

              {busy && admin === null ? (
                <p className="text-sm" style={{ color: "var(--dispatch-dim)" }}>
                  Checking access...
                </p>
              ) : (
                <form className="space-y-3" onSubmit={onLogin}>
                  <div className="dispatch-field">
                    <label htmlFor="admin-password">Admin password</label>
                    <input
                      id="admin-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  {error ? (
                    <p className="text-sm" style={{ color: "var(--crimson)" }}>
                      Wrong password.
                    </p>
                  ) : null}
                  <button className="dispatch-btn w-full" disabled={busy || password.length === 0}>
                    {busy ? "Checking..." : "Sign in"}
                  </button>
                  <button
                    type="button"
                    className="dispatch-btn dispatch-btn--secondary w-full"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
