import { describe, expect, it } from "vitest";
import { canTalk, tauntFor } from "./taunts";

describe("trash talk", () => {
  it("lets talking enemies mock the hero by name, crude or cheeky", () => {
    const crude = tauntFor("hero_missed", "goblin", "Brunhild", true, 0, 0)!;
    expect(crude).toBeTruthy();
    expect(crude).not.toContain("{hero}");
    const all = Array.from({ length: 40 }, (_, i) => tauntFor("hit_hero", "bandit", "Pip", true, 0, i / 40)).join(" ");
    expect(all).toMatch(/Hurensohn|Wichser|Arsch/);
    const mild = Array.from({ length: 40 }, (_, i) => tauntFor("hit_hero", "bandit", "Pip", false, 0, i / 40)).join(" ");
    expect(mild).not.toMatch(/Hurensohn|Wichser|Arsch|Scheiße|Fick/);
    expect(mild).toContain("Pip");
  });

  it("animals only growl, and not every blow gets a line", () => {
    expect(canTalk("wolf")).toBe(false);
    expect(tauntFor("hit_hero", "wolf", "Pip", true, 0, 0)).toMatch(/Grr|knurrt/);
    expect(tauntFor("hurt", "wolf", "Pip", true, 0, 0)).toBeUndefined();
    expect(tauntFor("hit_hero", "goblin", "Pip", true, 0.99, 0)).toBeUndefined();
  });
});

describe("youth slang", () => {
  it("young foes and young people talk like young people", async () => {
    const { personaFor, greetingFor, meet, emptyWorld, changeBond } = await import("./npc-world");
    const lines = Array.from({ length: 30 }, (_, i) => tauntFor("hero_missed", "goblin", "Pip", false, 0, i / 30, true)).join(" ");
    expect(lines).toMatch(/digga|cringe|mid|Skill-Issue|lost/i);
    expect(personaFor("Stallbursche Jonas", "commoner").young).toBe(true);
    expect(personaFor("Stallbursche Jonas", "commoner").speech).toContain("Jugendsprache");
    const share = Array.from({ length: 400 }, (_, i) => personaFor(`Bürger ${i}`, "commoner")).filter((p) => p.young).length;
    expect(share).toBeGreaterThan(20);
    expect(share).toBeLessThan(90);
    const { mind } = meet(emptyWorld(), "Lehrling Mia", "commoner", "a", 0);
    changeBond(mind, "Pip", 6);
    expect(greetingFor(mind, ["Pip"])).toMatch(/digga|bro|No cap|sheesh/i);
  });
});
