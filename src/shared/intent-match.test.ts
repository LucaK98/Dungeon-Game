import { describe, expect, it } from "vitest";
import { matchFreeText, matchUtility } from "./intent-match";
import type { ActionChoice } from "./view";

const goblins = [
  { id: "g1", name: "Goblin 1", detail: "RK 15", chance: 0.55 },
  { id: "g2", name: "Goblin 2", detail: "RK 15", chance: 0.6 },
];
const choice = (id: string, label: string, detail: string, extra: Partial<ActionChoice> = {}): ActionChoice => ({
  id,
  group: id.startsWith("spell") ? "spell" : "attack",
  label,
  detail,
  glossarKey: id,
  cost: "action",
  enabled: true,
  action: id.startsWith("spell") ? { kind: "cast", spellId: id.slice(6), targetIds: [] } : { kind: "attack", targetId: "", optionId: id.slice(7) },
  targets: goblins,
  ...extra,
});
const rapier = choice("attack:rapier", "Rapier", "+5 zum Treffen · 1W8 + 3 Schaden", { avg: 7.5 });
const bow = choice("attack:shortbow", "Kurzbogen", "+5 zum Treffen · 1W6 + 3 Schaden · Fernkampf", { avg: 6.5 });
const dagger = choice("attack:dagger", "Dolch", "+5 zum Treffen · 1W4 + 3 Schaden · auch werfen", { avg: 5.5 });
const firebolt = choice("spell:fire-bolt", "Feuerpfeil", "Zaubertrick · Aktion", { avg: 5.5, pick: { min: 1, max: 1, repeat: false } });
const cure = choice("spell:cure-wounds", "Heilende Hand", "Grad 1 · Aktion", {
  avgKind: "heal",
  avg: 7,
  targets: [
    { id: "me", name: "Pip (du)", detail: "TP 9/10" },
    { id: "ole", name: "Ole", detail: "TP 2/12" },
  ],
  pick: { min: 1, max: 1, repeat: false },
});
const all = [rapier, bow, dagger, firebolt, cure];
const hit = (text: string, list = all) => {
  const r = matchFreeText(text, list, "me");
  return r && "match" in r ? r.match : undefined;
};

describe("free text → own buttons", () => {
  it("picks the named weapon and the named target", () => {
    const m = hit("Ich ramme Goblin 1 mein Rapier in den Bauch")!;
    expect(m.choice.id).toBe("attack:rapier");
    expect(m.action).toEqual({ kind: "attack", targetId: "g1", optionId: "rapier" });
  });
  it("shooting means the bow, stabbing a melee weapon", () => {
    expect(hit("Ich schieße auf Goblin 1")!.choice.id).toBe("attack:shortbow");
    expect(hit("Ich steche Goblin 2 nieder")!.choice.id).toBe("attack:rapier");
    expect(hit("Ich werfe meinen Dolch nach Goblin 2")!.action).toMatchObject({ targetId: "g2", optionId: "dagger" });
  });
  it("spells by name or element; healing goes to the most hurt friend", () => {
    expect(hit("Ich schleudere Feuer auf Goblin 1")!.choice.id).toBe("spell:fire-bolt");
    expect(hit("Ich heile meinen Freund")!.action).toEqual({ kind: "cast", spellId: "cure-wounds", targetIds: ["ole"] });
    expect(hit("Ich heile mich")!.action).toMatchObject({ targetIds: ["me"] });
  });
  it("tricks and talk stay free actions", () => {
    expect(matchFreeText("Ich werfe ihm Sand in die Augen", all, "me", true)).toBeUndefined();
    expect(matchFreeText("Ich frage den Wirt nach dem Weg", all, "me")).toBeUndefined();
    expect(matchFreeText("Ich schaue mich im Haus um", all, "me")).toBeUndefined();
  });
  it("asks when it is not clear whom or what is meant", () => {
    const r = matchFreeText("Ich schieße auf den Goblin", all, "me");
    expect(r && "ask" in r && r.ask.map((m) => m.targetNames[0])).toEqual(["Goblin 1", "Goblin 2"]);
    const one = [{ ...rapier, targets: [goblins[0]!] }, { ...bow, targets: [goblins[0]!] }];
    expect(hit("Ich schieße", one)!.choice.id).toBe("attack:shortbow");
  });

  it("says why when the fitting attack is not possible", () => {
    const far = { ...rapier, enabled: false, reason: "Kein Gegner in Reichweite. Geh näher heran.", targets: [] };
    const r = matchFreeText("Ich greife mit dem Rapier an", [far], "me");
    expect(r && "blocked" in r && r.blocked).toContain("Reichweite");
  });
});

describe("free text: things and running away stay free actions", () => {
  it("does not attack when a thing is meant or the hero runs off", () => {
    expect(matchFreeText("Ich haue ab", all, "me")).toBeUndefined();
    expect(matchFreeText("Ich trete die Tür ein", all, "me")).toBeUndefined();
    expect(matchFreeText("Ich werfe das Fass um", all, "me")).toBeUndefined();
    // …but a named enemy is still attacked.
    expect(matchFreeText("Ich trete Goblin 1 gegen das Fass", all, "me")).toBeDefined();
  });
});

describe("free text: things, furniture, abilities", () => {
  const ch = (id: string, group: ActionChoice["group"], label: string, action: ActionChoice["action"], extra: Partial<ActionChoice> = {}): ActionChoice => ({ id, group, label, detail: "", glossarKey: id, cost: "action", enabled: true, action, ...extra });
  const potion = ch("item:potion", "item", "Heiltrank (2)", { kind: "use_item", itemId: "potion-of-healing" }, { targets: [{ id: "ole", name: "Ole", detail: "TP 2/12" }, { id: "me", name: "Pip (du)", detail: "TP 9/10" }], pick: { min: 1, max: 1, repeat: false } });
  const stool = ch("throw:o1", "look", "🪑 Hocker werfen", { kind: "interact", objectId: "o1", use: "throw" }, { targets: goblins });
  const table = ch("flip:o2", "look", "💪 Tisch umwerfen", { kind: "interact", objectId: "o2", use: "flip" });
  const hide = ch("hide", "ability", "Verstecken (Bonusaktion)", { kind: "feature", feature: "hide", bonus: true });
  const wind = ch("second-wind", "ability", "Durchatmen", { kind: "feature", feature: "second-wind" });
  const list = [potion, stool, table, hide, wind, rapier, bow];
  const m = (text: string) => {
    const r = matchUtility(text, list, "me");
    return r && "match" in r ? r.match : undefined;
  };
  it("drinking a potion is for yourself, handing it over for the one named", () => {
    expect(m("Ich trinke schnell einen Heiltrank")!.action).toEqual({ kind: "use_item", itemId: "potion-of-healing", targetId: "me" });
  });
  it("furniture: throw the stool at a goblin, flip the table", () => {
    expect(m("Ich werfe den Hocker nach Goblin 2")!.action).toMatchObject({ kind: "interact", objectId: "o1", use: "throw" });
    expect(m("Ich kippe den Tisch um")!.choice.id).toBe("flip:o2");
  });
  it("class abilities by everyday words", () => {
    expect(m("Ich verstecke mich hinter der Kiste")!.choice.id).toBe("hide");
    expect(m("Ich atme kurz durch")!.choice.id).toBe("second-wind");
  });
  it("plain attacks are not taken for things", () => {
    expect(matchUtility("Ich steche Goblin 1 nieder", list, "me")).toBeUndefined();
    expect(matchUtility("Ich frage den Wirt nach dem Weg", list, "me")).toBeUndefined();
  });
});
