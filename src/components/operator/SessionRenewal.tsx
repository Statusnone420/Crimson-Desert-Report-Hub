"use client";

import { useEffect, useState } from "react";
import { renewAdminSession } from "@/lib/sessionRenewal";

/**
 * Each operator page load keeps a used login alive: the endpoint re-issues a
 * session that is more than a day old. A renewal the server cannot complete is
 * shown, because the login then runs out on its original date.
 */
export function SessionRenewal() {
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void renewAdminSession().then((outcome) => {
      if (!cancelled) setUnavailable(outcome === "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div role="status">
      {unavailable ? (
        <p className="workspace-preview-notice">
          Your sign-in could not be extended just now. You are still signed in; reload the page to try again.
        </p>
      ) : null}
    </div>
  );
}
