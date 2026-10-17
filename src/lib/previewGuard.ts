import "server-only";

export function isVercelPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

/** Reviews use the same dashboard with a browser-only sample data adapter. */
export function isAiSettingsPreviewAllowed(): boolean {
  return isVercelPreview() || process.env.NODE_ENV === "development";
}

/** Provider calls and credential writes are unavailable in every review build. */
export function isAiSettingsLiveAllowed(): boolean {
  return process.env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
}

export function assertProductionWriteAllowed(): void {
  if (isVercelPreview()) throw new Error("preview writes disabled");
}
