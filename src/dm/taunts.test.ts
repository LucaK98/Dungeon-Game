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
