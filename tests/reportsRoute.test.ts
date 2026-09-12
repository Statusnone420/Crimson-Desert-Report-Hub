import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/reports/route";

describe("POST /api/reports", () => {
  it("returns 410 without reading an obsolete report payload", async () => {
    const request = new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const handler: (request: Request) => Response = POST;
    const response = await handler(request);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "reports_retired" });
  });
});
