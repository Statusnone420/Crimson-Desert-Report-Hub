"use client";

import { useId, useState } from "react";

/** A textarea with a visible character count. The server enforces the same limit. */
export function CharacterCountField({ name, label, limit, defaultValue = "", required = false, rows = 5 }: {
  name: string;
  label: string;
  limit: number;
  defaultValue?: string;
  required?: boolean;
  rows?: number;
}) {
  const id = useId();
  const [length, setLength] = useState(defaultValue.length);
  return <div className="workspace-field workspace-field--wide">
    <label htmlFor={id}>{label}</label>
    <textarea id={id} name={name} rows={rows} maxLength={limit} required={required} defaultValue={defaultValue} aria-describedby={`${id}-count`}
      onChange={(event) => setLength(event.target.value.length)} />
    <small id={`${id}-count`} className="workspace-note">{length.toLocaleString("en-US")} of {limit.toLocaleString("en-US")} characters</small>
  </div>;
}
