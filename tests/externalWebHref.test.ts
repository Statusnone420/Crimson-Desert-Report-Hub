import { expect, it } from "vitest";
import { externalWebHref } from "@/lib/externalWebHref";

it.each(["javascript:alert(1)", "data:text/html,hello", "file:///private.txt", "https://user:pass@example.com", "/relative", "bad link"])("does not make %s clickable", (value) => {
  expect(externalWebHref(value)).toBeUndefined();
});

it("preserves the submitted web source including query and fragment", () => {
  expect(externalWebHref("https://example.com/report?a=1#evidence")).toBe("https://example.com/report?a=1#evidence");
});
