"use client";

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
