import { describe, expect, it } from "vitest";
import { resolveAttack } from "./attack";
import { createMonster, pregenCharacter } from "./creatures";
import { explainAttack, formatParts, metres } from "./explain";
import { scriptedRng } from "./rng";
import { battleOf } from "./testing";

describe("explanations", () => {
  it("formats breakdowns like the design says", () => {
    expect(
      formatParts([
        { label: "Würfel", value: 14, glossarKey: "w20" },
        { label: "Stärke", value: 3 },
        { label: "Übung", value: 2 },
      ]),
    ).toBe("🎲 14 + 3 (Stärke) + 2 (Übung)");
    expect(formatParts([{ label: "Würfel", value: 9, glossarKey: "w20" }, { label: "Stärke", value: -1 }])).toBe("🎲 9 − 1 (Stärke)");
  });

  it("explains an attack roll in one line", () => {
    const f = pregenCharacter("fighter");
    const g = createMonster("goblin", "g");
    const battle = battleOf([f, 0, 0], [g, 1, 0]);
    const r = resolveAttack(scriptedRng([14, 5]), battle, f, g, f.attacks.find((a) => a.id === "longsword")!);
    const lines = explainAttack(battle, r).map((l) => l.text);
    expect(lines).toContain("🎲 14 + 3 (Stärke) + 2 (Übung) = 19 gegen RK 15 → Treffer!");
    expect(lines).toContain("💥 5 (W8) + 3 (Stärke) = 8 Hiebschaden");
    expect(lines).toContain("☠️ Goblin ist besiegt!");
  });

  it("converts feet to metres", () => {
    expect(metres(30)).toBe("9 m");
    expect(metres(15)).toBe("4,5 m");
  });
});
