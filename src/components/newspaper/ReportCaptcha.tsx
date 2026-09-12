"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useNewspaperTheme } from "./useNewspaperTheme";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; theme: "light" | "dark"; size: "compact"; callback?: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }) => string | undefined;
      remove: (widgetId: string) => void;
    };
  }
}

export function ReportCaptcha({ siteKey, onToken, onError }: { siteKey: string; onToken?: (token: string) => void; onError?: () => void }) {
  const theme = useNewspaperTheme();
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onToken, onError });
  useEffect(() => { callbacks.current = { onToken, onError }; }, [onToken, onError]);

  useEffect(() => {
    const api = window.turnstile;
    if (!ready || !api || !container.current) return;
    // Turnstile reads its theme at creation; replace the widget and its token together.
    callbacks.current.onToken?.("");
    const widgetId = api.render(container.current, {
      sitekey: siteKey, theme, size: "compact",
      callback: (token) => callbacks.current.onToken?.(token),
      "expired-callback": () => callbacks.current.onToken?.(""),
      "error-callback": () => { callbacks.current.onToken?.(""); callbacks.current.onError?.(); },
    });
    return () => {
      if (widgetId !== undefined) api.remove(widgetId);
    };
  }, [ready, siteKey, theme]);

  return <>
    <div ref={container} className="turnstile-widget" />
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="lazyOnload" onReady={() => setReady(true)} onError={() => callbacks.current.onError?.()} />
  </>;
}
