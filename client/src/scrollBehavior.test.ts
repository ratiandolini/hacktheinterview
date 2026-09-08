import { describe, expect, it } from "vitest";
import { isNearBottom } from "./scrollBehavior.js";

describe("isNearBottom", () => {
  it("keeps auto-scroll enabled at or near the bottom", () => {
    expect(isNearBottom(1000, 552, 400)).toBe(true);
    expect(isNearBottom(1000, 600, 400)).toBe(true);
  });

  it("pauses auto-scroll after the user scrolls away", () => {
    expect(isNearBottom(1000, 500, 400)).toBe(false);
  });
});