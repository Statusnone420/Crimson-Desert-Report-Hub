import { describe, expect, it } from "vitest";
import { analyzeSaveImport, sanitizeSavePath } from "@/lib/saveImport";

const settingsXml = `
<EngineOptionSave>
  <EngineOptionResolution Name="_resolutionOption">
    <OptionStringVector Name="_upscaleModeSelect" _value="NVIDIA DLSS 4.0"/>
    <EnumSelectResolutionScale Name="_upscaleResolution" _select="AA"/>
  </EngineOptionResolution>
  <EngineOptionVideo Name="_videoOption">
    <OptionBool Name="_enableFrameGeneration" _value="True"/>
    <OptionStringVector Name="_enableVsync" _value="Off"/>
    <OptionBool Name="_enableHDR" _value="True"/>
  </EngineOptionVideo>
  <EngineOptionGraphics Name="_graphicsOption">
    <EnumSelectQualityLevel Name="_lightingQualityLevelSelect" _select="Ultra"/>
    <EnumSelectQualityLevel Name="_waterQualityLevelSelect" _select="Ultra"/>
  </EngineOptionGraphics>
</EngineOptionSave>`;

describe("save import helper", () => {
  it("sanitizes local save paths before they can be inserted into reports", () => {
    expect(sanitizeSavePath("87637437/slot100/save.save")).toBe("slot100/save.save");
    expect(sanitizeSavePath("C:/Users/Antho/AppData/Local/Pearl Abyss/CD/save/87637437/slot2/lobby.save")).toBe(
      "slot2/lobby.save",
    );
  });

  it("extracts graphics settings and save evidence without raw save content", () => {
    const result = analyzeSaveImport([
      {
        name: "user_engine_option_save.xml",
        relativePath: "user_engine_option_save.xml",
        size: 5032,
        lastModified: Date.UTC(2026, 6, 4, 12, 0, 0),
        text: settingsXml,
      },
      {
        name: "save.save",
        relativePath: "87637437/slot100/save.save",
        size: 2184200,
        lastModified: Date.UTC(2026, 6, 4, 12, 11, 10),
        text: "",
      },
    ]);

    expect(result.graphicsMode).toBe("NVIDIA DLSS 4.0 / AA / Frame Generation on / VSync off / HDR on");
    expect(result.evidenceNote).toContain("settings XML parsed");
    expect(result.evidenceNote).toContain("slot100/save.save");
    expect(result.evidenceNote).not.toContain("87637437");
    expect(result.privacyNote).toContain("Raw files are not uploaded");
  });
});
