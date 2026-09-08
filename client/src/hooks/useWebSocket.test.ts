import { describe, expect, it } from "vitest";
import { getReconnectDelay } from "./useWebSocket.js";

describe("getReconnectDelay", () => {
  it("retries quickly and caps the wait at five seconds", () => {
    expect([0, 1, 2, 3, 4].map((attempt) => getReconnectDelay(attempt))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
});