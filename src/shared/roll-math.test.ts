import { describe, expect, it } from "vitest";
import { needText, rollMath, sumText } from "./roll-math";

describe("roll numbers for the sofa", () => {
  it("reads what was needed and what came", () => {
    const m = rollMath({ dice: [9], kept: 9, lines: [{ text: "🎲 9 + 3 (Stärke) = 12 gegen RK 13 → Daneben", glossarKeys: [] }] })!;
    expect(m).toMatchObject({ die: 9, bonus: 3, total: 12, label: "RK", target: 13, need: 10 });
    expect(needText(m.need)).toBe("Nötig: 10+");
    expect(sumText(m)).toBe("9 + 3 Bonus = 12 gegen RK 13");
  });

  it("knows checks and penalties", () => {
    const m = rollMath({ dice: [15, 4], kept: 4, lines: [{ text: "x", glossarKeys: [] }, { text: "4 − 1 = 3 gegen SG 12 → Nicht geschafft.", glossarKeys: [] }] })!;
    expect(m).toMatchObject({ bonus: -1, label: "SG", need: 13 });
    expect(sumText(m)).toBe("4 − 1 Malus = 3 gegen SG 12");
  });

  it("has nothing to say without a die or a target", () => {
    expect(rollMath({ dice: [], kept: 0, lines: [] })).toBeUndefined();
    expect(rollMath({ dice: [6], kept: 6, lines: [{ text: "Schaden 6", glossarKeys: [] }] })).toBeUndefined();
    expect(needText(1)).toBe("Klappt immer");
    expect(needText(21)).toBe("Nötig: eine 20");
  });
});
