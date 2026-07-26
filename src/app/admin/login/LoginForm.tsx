"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { resolveLoginReturn } from "@/lib/loginReturn";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

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
    // requireAdmin() put the interrupted destination in ?from=; sign-in
    // resumes there instead of always dumping the operator on Report review.
    if (res.ok) router.push(resolveLoginReturn(searchParams.get("from")));
    else setError(true);
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-16 max-w-sm space-y-4">
      <div>
        <p className="dispatch-kicker dispatch-kicker--amber">Operator console</p>
        <h1
          className="mt-2"
          style={{ fontFamily: "var(--font-display)", fontSize: 33, fontWeight: 400, lineHeight: 1.1 }}
        >
          Sign in
        </h1>
      </div>
      <div className="dispatch-field">
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
      <button className="dispatch-btn w-full" disabled={busy || password.length === 0}>
        {busy ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
