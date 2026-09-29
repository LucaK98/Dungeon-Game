import { describe, expect, it } from "vitest";
import { bondLabel, bondOf, changeBond, emptyWorld, genderOf, greetingFor, meet, mindPrompt, personaFor, remember, MAX_FACTS } from "./npc-world";

describe("npc world", () => {
  it("gives every character one personality for good (same name, same person)", () => {
    const a = personaFor("Gräfin Irmgard", "noble");
    const b = personaFor("Gräfin Irmgard", "noble");
    expect(a).toEqual(b);
    expect(a.gender).toBe("female");
    expect(a.traits).toHaveLength(3);
    expect(new Set(a.traits).size).toBe(3);
    expect(personaFor("Wirt Bartholomäus", "commoner")).not.toEqual(a);
  });

  it("tells women and men apart by title and name", () => {
    expect(genderOf("Müllerin Gerda")).toBe("female");
    expect(genderOf("Förster Ruprecht")).toBe("male");
    expect(genderOf("Wirt Bartholomäus")).toBe("male");
    expect(genderOf("Merlin der Weise")).toBe("male");
    expect(genderOf("Frau Holle")).toBe("female");
  });

  it("makes some people open to romance – mostly for the other sex, some for their own, some not at all", () => {
    const names = Array.from({ length: 400 }, (_, i) => `Bürger ${i}`);
    const personas = names.map((n) => personaFor(n, "commoner"));
    const closed = personas.filter((p) => !p.romance.open).length;
    const same = personas.filter((p) => p.romance.likes.includes(p.gender)).length;
    const other = personas.filter((p) => p.romance.likes.some((g) => g !== p.gender)).length;
    expect(closed).toBeGreaterThan(40);
    expect(same).toBeGreaterThan(10);
    expect(same).toBeLessThan(other / 2);
    // Wolves and skeletons never.
    expect(personaFor("Grauer Wolf", "wolf").romance.open).toBe(false);
  });

  it("remembers heroes across adventures and greets them again", () => {
    const world = emptyWorld();
    const first = meet(world, "Gräfin Irmgard", "noble", "abenteuer-1", 1);
    expect(first.returning).toBe(false);
    changeBond(first.mind, "Brunhild", 4);
    remember(first.mind, "Brunhild hat den Wolf von meinem Hof gejagt.");
    // Same adventure again: not "returning".
    expect(meet(world, "gräfin  irmgard", "noble", "abenteuer-1", 2).returning).toBe(false);
    const again = meet(world, "Gräfin Irmgard", "noble", "abenteuer-2", 3);
    expect(again.returning).toBe(true);
    expect(again.mind).toBe(first.mind);
    const hello = greetingFor(again.mind, ["Pip", "Brunhild"]);
    expect(hello).toContain("Brunhild");
    expect(hello).toContain("Wolf");
    expect(mindPrompt(again.mind, ["Brunhild", "Pip"])).toMatch(/Brunhild \+4 \(freundlich\).*Pip \+0/);
  });

  it("keeps feelings within −10 … +10 and only the newest facts", () => {
    const { mind } = meet(emptyWorld(), "Wirt Bartholomäus", "commoner", "a", 0);
    changeBond(mind, "Pip", 30);
    expect(bondOf(mind, "Pip")).toBe(10);
    expect(bondLabel(10)).toBe("sehr vertraut");
    changeBond(mind, "Pip", -40);
    expect(bondOf(mind, "Pip")).toBe(-10);
    for (let i = 0; i < 15; i++) remember(mind, `Ereignis ${i}`);
    expect(mind.facts).toHaveLength(MAX_FACTS);
    expect(mind.facts[mind.facts.length - 1]).toBe("Ereignis 14");
    remember(mind, "Ereignis 14");
    expect(mind.facts.filter((f) => f === "Ereignis 14")).toHaveLength(1);
  });
});
