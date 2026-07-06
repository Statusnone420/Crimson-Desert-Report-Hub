import "server-only";

export function isVercelPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function assertProductionWriteAllowed(): void {
  if (isVercelPreview()) throw new Error("preview writes disabled");
}
