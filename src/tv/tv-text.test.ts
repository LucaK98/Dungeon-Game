import { describe, expect, it } from "vitest";
import { targetShort } from "../play/short";
import { mergeSummary, rollVerdict, summaryOf, TONE } from "./tv-text";

describe("less on the screen", () => {
  it("small things wait for the round summary, the rest shows at once", () => {
    expect(summaryOf("✨ +10 EP für alle – 💡 geniale Idee von Brunhild")).toBe("+10 EP");
    expect(summaryOf("💰 Brunhild findet 12 Goldmünzen.")).toBe("+12 Gold");
    expect(summaryOf("💰 Ole sammelt 5 Münzen ein.")).toBe("+5 Gold");
    expect(summaryOf("🔥 Goblin 2 fängt Feuer! (brennt nächste Runde: 1W4)")).toBe("Goblin 2 brennt");
    expect(summaryOf("💰 Die Banditen nehmen 20 Gold und kämpfen nicht mehr.")).toBeUndefined();
    expect(summaryOf("⚔️ Kampf!")).toBeUndefined();
  });

  it("adds up EP and gold, lists the rest once", () => {
    expect(mergeSummary(["+10 EP", "+5 Gold", "Goblin 2 brennt", "+10 EP", "Goblin 2 brennt", "+7 Gold"])).toBe("+20 EP · +12 Gold · Goblin 2 brennt");
  });

  it("the roll card says it in one word, in the colour of the outcome", () => {
    expect(rollVerdict({ title: "Angriff auf Goblin 1", lines: [], success: true, playerId: "p1" })).toEqual({ text: "🎯 Treffer!", color: TONE.good });
    expect(rollVerdict({ title: "Angriff auf Goblin 1", lines: [], success: false, playerId: "p1" })).toEqual({ text: "💨 Daneben!", color: TONE.danger });
    expect(rollVerdict({ title: "Probe auf Athletik", lines: [], success: true, playerId: "p1" }).text).toBe("✅ Geschafft!");
    expect(rollVerdict({ title: "Angriff", lines: [], success: true, crit: true, playerId: "p1" }).color).toBe(TONE.reward);
    // The foes' rolls: their hit is danger (red), their miss is good for you (green).
    expect(rollVerdict({ title: "Goblin 1 greift an", lines: [], success: true })).toEqual({ text: "🎯 Treffer!", color: TONE.danger });
    expect(rollVerdict({ title: "Goblin 1 greift an", lines: [], success: false }).color).toBe(TONE.good);
  });

  it("targets in a few signs; armour class and distance only on a long press", () => {
    expect(targetShort({ detail: "RK 15 · 1 Felder · 80 % · ✨ Schwachstelle erkannt · 💥 Donner ×2", chance: 0.8 })).toBe("80 % · 💥 Donner ×2 · ✨");
    expect(targetShort({ detail: "RK 12 · 3 Felder · 45 % · +2 Nahschuss", chance: 0.45 })).toBe("45 % · 🎯");
    expect(targetShort({ detail: "RK 12" })).toBe("");
  });
});

describe("tricks and attacks in one sentence", () => {
  it("splits off the trick, a vivid attack stays one attack", async () => {
    const { splitCombo } = await import("./game");
    expect(splitCombo("Ich beleidige den Goblin und greife ihn an")).toBe("Ich beleidige den Goblin");
    expect(splitCombo("Ich stelle ihm ein Bein und schlage dann zu")).toBe("Ich stelle ihm ein Bein");
    expect(splitCombo("Ich springe mit Anlauf vor und greife Goblin 1 mit aller Kraft an")).toBeUndefined();
    expect(splitCombo("Ich greife den Goblin an")).toBeUndefined();
  });
});
