"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

export function OwnerConsole() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const router = useRouter();

  async function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && admin === null) {
      setBusy(true);
      setAdmin(await readAdminStatus());
      setBusy(false);
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
    router.refresh();
  }

  async function onLogout() {
    setBusy(true);
    await fetch("/api/admin/login", { method: "DELETE" });
    setBusy(false);
    setAdmin(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="text-xs hover:text-[var(--text)]"
        style={{ color: "var(--text-dim)" }}
        aria-expanded={open}
      >
        Owner
      </button>
      {open ? (
        <div className="panel absolute right-0 bottom-full z-50 mb-3 w-72 space-y-3 shadow-xl">
          <div>
            <div className="stat-label">Owner console</div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
              Private controls for moderation and scanner runs.
            </p>
          </div>

          {busy && admin === null ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              Checking access...
            </p>
          ) : admin ? (
            <div className="space-y-2">
              <Link className="btn btn-ghost w-full text-center" href="/admin" onClick={() => setOpen(false)}>
                Moderation queue
              </Link>
              <Link className="btn btn-ghost w-full text-center" href="/admin/source-monitor" onClick={() => setOpen(false)}>
                Source monitor
              </Link>
              <Link className="btn btn-ghost w-full text-center" href="/admin/compile" onClick={() => setOpen(false)}>
                Compile dossier
              </Link>
              <button type="button" className="btn w-full" disabled={busy} onClick={onLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={onLogin}>
              <div>
                <label htmlFor="owner-password">Admin password</label>
                <input
                  id="owner-password"
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
              <button className="btn w-full" disabled={busy || password.length === 0}>
                {busy ? "Checking..." : "Unlock controls"}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
