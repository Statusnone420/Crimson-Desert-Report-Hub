import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftDossierWithAi } from "@/lib/ai";

beforeEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_FREE_MODEL;
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_FREE_MODEL;
  vi.unstubAllGlobals();
});

describe("draftDossierWithAi", () => {
  it("never calls legacy Groq when only GROQ_API_KEY remains configured", async () => {
    process.env.GROQ_API_KEY = "legacy-groq-key";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(draftDossierWithAi("deterministic dossier")).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not call OpenRouter when the configured model is paid", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.OPENROUTER_FREE_MODEL = "deepseek/deepseek-v4-flash";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(draftDossierWithAi("deterministic dossier")).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the free OpenRouter route when no explicit model is configured", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "x".repeat(220) } }], usage: { cost: 0 } }),
    }));
    vi.stubGlobal("fetch", fetcher);

    await expect(draftDossierWithAi("deterministic dossier")).resolves.toMatchObject({ provider: "openrouter" });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      model: "openrouter/free",
      provider: {
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
        max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      },
    });
  });

  it("falls back to the deterministic dossier when OpenRouter reports a charge", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "x".repeat(220) } }],
        usage: { cost: 0.0002 },
      }),
    }));
    vi.stubGlobal("fetch", fetcher);

    await expect(draftDossierWithAi("deterministic dossier")).resolves.toBeNull();
  });
});
