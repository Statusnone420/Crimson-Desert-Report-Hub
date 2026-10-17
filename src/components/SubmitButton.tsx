"use client";

import { type ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  describedBy?: string;
} & (
  // Forms that branch on which button was pressed (the moderation decision
  // row) submit their choice as the button's own name/value pair. Both halves
  // are required together: a value without a name submits nothing.
  | { name: string; value: string }
  | { name?: undefined; value?: undefined }
);

export function SubmitButton({
  children,
  pendingText,
  className = "btn",
  describedBy,
  name,
  value,
}: SubmitButtonProps) {
  const { pending, data } = useFormStatus();
  // useFormStatus reports the whole form's state, so sibling buttons would all
  // claim to be working. Only the button whose name/value the submission
  // actually carries announces itself busy; the others just go disabled.
  const isSubmitter = !name || data?.get(name) === value;
  const busy = pending && isSubmitter;
  return (
    <button
      className={className}
      disabled={pending}
      aria-busy={busy}
      aria-describedby={describedBy}
      name={name}
      value={value}
    >
      {busy ? (pendingText ?? "Working…") : children}
    </button>
  );
}
