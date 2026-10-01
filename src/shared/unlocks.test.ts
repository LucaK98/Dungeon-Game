import { describe, expect, it } from "vitest";
import { lockedFeatures, newUnlocks } from "./unlocks";

describe("features unlock step by step", () => {
  it("keeps the first adventure simple", () => {
    expect([...lockedFeatures(0)].sort()).toEqual(["brewing", "elements", "romance", "travel", "village"]);
    expect([...lockedFeatures(1)].sort()).toEqual(["elements", "romance"]);
    expect(lockedFeatures(2).size).toBe(0);
  });

  it("can switch everything on from the start", () => {
    expect(lockedFeatures(0, true).size).toBe(0);
    expect(newUnlocks(1, true)).toEqual([]);
  });

  it("names what an adventure has just unlocked", () => {
    expect(newUnlocks(1).map((u) => u.feature)).toEqual(["village", "travel", "brewing"]);
    expect(newUnlocks(2).map((u) => u.feature)).toEqual(["romance", "elements"]);
    expect(newUnlocks(3)).toEqual([]);
  });
});
