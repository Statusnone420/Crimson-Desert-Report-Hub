import { describe, expect, it, vi } from "vitest";
import { isEditorialVisible, whereEditorialVisible } from "@/lib/editorials/visibility";
import { NOW, publicRow } from "./editorialFixtures";

describe("the shared editorial visibility rule", () => {
  it("shows a held edition only once its publish time has passed", () => {
    expect(isEditorialVisible(publicRow({ publish_at: "2026-10-26T15:30:00Z" }), NOW)).toBe(false);
    expect(isEditorialVisible(publicRow({ publish_at: "2026-10-26T15:00:00Z" }), NOW)).toBe(true);
    expect(isEditorialVisible(publicRow({ publish_at: "2026-10-26T14:59:59Z" }), NOW)).toBe(true);
  });

  it("shows an approved (published) edition", () => {
    expect(isEditorialVisible(publicRow({ status: "published" }), NOW)).toBe(true);
  });

  it("hides an edition waiting for approval, which has no publish time", () => {
    expect(isEditorialVisible(publicRow({ publish_at: null }), NOW)).toBe(false);
  });

  it("hides vetoed, skipped and test rows whatever their publish time", () => {
    expect(isEditorialVisible(publicRow({ status: "vetoed", vetoed_at: "2026-10-26T14:30:00Z" }), NOW)).toBe(false);
    expect(isEditorialVisible(publicRow({ status: "published", vetoed_at: "2026-10-26T14:30:00Z" }), NOW)).toBe(false);
    expect(isEditorialVisible(publicRow({ status: "skipped" }), NOW)).toBe(false);
    expect(isEditorialVisible(publicRow({ is_test: true }), NOW)).toBe(false);
  });

  it("hides a row with an unreadable publish time", () => {
    expect(isEditorialVisible(publicRow({ publish_at: "not a date" }), NOW)).toBe(false);
  });

  it("asks the database for exactly the same rule", () => {
    const query = { in: vi.fn(), lte: vi.fn(), is: vi.fn(), eq: vi.fn() };
    for (const method of Object.values(query)) method.mockReturnValue(query);
    expect(whereEditorialVisible(query, NOW)).toBe(query);
    expect(query.in).toHaveBeenCalledWith("status", ["held", "published"]);
    expect(query.lte).toHaveBeenCalledWith("publish_at", NOW.toISOString());
    expect(query.is).toHaveBeenCalledWith("vetoed_at", null);
    expect(query.eq).toHaveBeenCalledWith("is_test", false);
  });
});
