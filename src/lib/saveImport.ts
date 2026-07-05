export type SaveImportFile = {
  name: string;
  relativePath?: string;
  size: number;
  lastModified: number;
  text: string;
};

export type SaveImportAnalysis = {
  graphicsMode: string | null;
  evidenceNote: string;
  privacyNote: string;
};

const PRIVATE_PATH_MARKER = "/save/";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function sanitizeSavePath(path: string): string {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  const saveIndex = lower.lastIndexOf(PRIVATE_PATH_MARKER);
  const saveRelative = saveIndex >= 0 ? normalized.slice(saveIndex + PRIVATE_PATH_MARKER.length) : normalized;

  return saveRelative
    .split("/")
    .filter((segment) => segment && !/^\d{5,}$/.test(segment))
    .join("/");
}

function attrValue(xml: string, name: string, attr: "_value" | "_select"): string | null {
  const tag = new RegExp(`<[^>]+Name="${name}"[^>]*${attr}="([^"]+)"[^>]*>`, "i").exec(xml);
  return tag?.[1] ?? null;
}

function boolWord(value: string | null): "on" | "off" | null {
  if (!value) return null;
  if (/^(true|on|1)$/i.test(value)) return "on";
  if (/^(false|off|0)$/i.test(value)) return "off";
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown date";
  return new Date(ms).toISOString().slice(0, 10);
}

function graphicsModeFromSettings(xml: string): string | null {
  const upscaleMode = attrValue(xml, "_upscaleModeSelect", "_value");
  const upscaleResolution = attrValue(xml, "_upscaleResolution", "_select");
  const frameGeneration = boolWord(attrValue(xml, "_enableFrameGeneration", "_value"));
  const vsync = boolWord(attrValue(xml, "_enableVsync", "_value"));
  const hdr = boolWord(attrValue(xml, "_enableHDR", "_value"));

  const parts = [
    upscaleMode,
    upscaleResolution,
    frameGeneration ? `Frame Generation ${frameGeneration}` : null,
    vsync ? `VSync ${vsync}` : null,
    hdr ? `HDR ${hdr}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : null;
}

export function analyzeSaveImport(files: SaveImportFile[]): SaveImportAnalysis {
  const settingsFile = files.find((file) => file.name.toLowerCase() === "user_engine_option_save.xml" && file.text);
  const graphicsMode = settingsFile ? graphicsModeFromSettings(settingsFile.text) : null;

  const saveFiles = files
    .filter((file) => /\.(save|xml|log|txt)$/i.test(file.name))
    .slice(0, 8)
    .map((file) => {
      const path = sanitizeSavePath(file.relativePath || file.name);
      return `${path} (${formatBytes(file.size)}, modified ${formatDate(file.lastModified)})`;
    });

  const evidenceParts = [
    settingsFile ? "settings XML parsed" : null,
    saveFiles.length > 0 ? `selected files: ${saveFiles.join("; ")}` : null,
  ].filter(Boolean);

  return {
    graphicsMode,
    evidenceNote:
      evidenceParts.length > 0
        ? `Local save helper: ${evidenceParts.join("; ")}. Raw files are not uploaded.`
        : "Local save helper: no recognized Crimson Desert settings or save files selected. Raw files are not uploaded.",
    privacyNote: "Raw files are not uploaded. Only this sanitized summary can be included with the report.",
  };
}
