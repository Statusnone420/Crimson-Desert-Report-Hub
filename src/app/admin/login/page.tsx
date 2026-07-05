"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.push("/admin");
    else setError(true);
  }

  return (
    <form onSubmit={onSubmit} className="panel mx-auto mt-16 max-w-sm space-y-4">
      <div>
        <p className="stat-label">Admin</p>
        <h1 className="text-xl font-semibold">Moderator access</h1>
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
      </div>
      {error ? (
        <p className="text-sm" style={{ color: "var(--crimson)" }}>
          Wrong password.
        </p>
      ) : null}
      <button className="btn w-full" disabled={busy || password.length === 0}>
        {busy ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
