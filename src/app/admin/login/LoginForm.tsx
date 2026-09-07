"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { resolveLoginReturn } from "@/lib/loginReturn";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) router.push(resolveLoginReturn(searchParams.get("from")));
      else setError(res.status === 401 ? "Check your password and try again." : "Sign-in is unavailable. Try again shortly.");
    } catch {
      setError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="np-login" aria-busy={busy}>
      <h1>Admin sign-in</h1>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => { setPassword(event.target.value); setError(""); }}
          autoComplete="current-password"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
          autoFocus
        />
      </div>
      {error ? (
        <p id="login-error" className="np-login-error" role="alert">{error}</p>
      ) : null}
      <button type="submit" disabled={busy || password.length === 0}>
        {busy ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
