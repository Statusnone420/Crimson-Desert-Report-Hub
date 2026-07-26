"use client";

import { type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  className = "btn",
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  // Forms that branch on which button was pressed (the moderation decision
  // row) submit their choice as the button's own name/value pair.
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
