import { describe, expect, it } from "vitest";
import { idleHero, spotlightLine } from "./spotlight";

describe("spotlight guard", () => {
  it("finds the hero who waited three rounds or more (the longest first)", () => {
    const did = new Map([["a", 4], ["b", 1], ["c", 2]]);
    expect(idleHero(["a", "b", "c"], did, 4)).toBe("b");
    expect(idleHero(["a", "b", "c"], did, 3)).toBeUndefined();
  });

  it("gives a person nearby first, otherwise something the class notices", () => {
    expect(spotlightLine("Ilmarin", "wizard", 0, "Greta")).toContain("Greta");
    expect(spotlightLine("Ilmarin", "wizard", 0)).toContain("Ilmarin");
    expect(spotlightLine("X", "unknown", 1)).toContain("X");
  });
});
