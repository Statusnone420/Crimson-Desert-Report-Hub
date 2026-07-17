"use client";

import { useState } from "react";

export function DossierOutput({ markdown }: { markdown: string }) {
  return (
    <textarea
      readOnly
      rows={24}
      defaultValue={markdown}
      className="w-full font-mono text-xs"
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

/** Copies the already-generated dossier text; never touches generation. */
export function CopyDossierButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button type="button" className="dispatch-btn dispatch-btn--secondary" onClick={onCopy}>
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed — select the text instead" : "Copy to clipboard"}
    </button>
  );
}
