import { describe, expect, it } from "vitest";
import { rollNeed } from "./view";

describe("rollNeed", () => {
  it("is the target minus the bonus", () => {
    expect(rollNeed("RK", 15, 5).min).toBe(10);
    expect(rollNeed("SG", 12, -1).min).toBe(13);
  });
  it("stays on the die", () => {
    // An attack never hits on a 1, a check can be sure.
    expect(rollNeed("RK", 8, 9).min).toBe(2);
    expect(rollNeed("SG", 8, 9).min).toBe(1);
    expect(rollNeed("RK", 25, 2).min).toBe(20);
  });
});
