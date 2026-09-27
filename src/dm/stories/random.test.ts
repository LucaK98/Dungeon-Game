import { describe, expect, it } from "vitest";
import { hasMonster } from "../../engine/data";
import { MODULES } from "../../map/modules";
import { planScenes } from "../planner";
import { getStory } from "./index";
import { generateStory, isRandomStoryId } from "./random";

describe("random adventures", () => {
  it("are valid for many seeds: rooms, monsters, three clues per truth, endings", () => {
    const titles = new Set<string>();
    const bosses = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const s = generateStory(seed);
      titles.add(s.title);
      expect(s.truths).toHaveLength(2);
      for (const act of s.acts) {
        for (const scene of act.scenes) {
          for (const r of scene.rooms) expect(MODULES.some((m) => m.id === r), `${seed}: ${r}`).toBe(true);
          for (const st of scene.steps) {
            for (const g of [...(st.fight ?? []), ...(st.choices ?? []).flatMap((c) => [...(c.outcome?.fight ?? []), ...(c.check?.success.fight ?? []), ...(c.check?.failure.fight ?? [])])]) {
              expect(hasMonster(g.monster), `${seed}: ${g.monster}`).toBe(true);
              if (g.boss) bosses.add(g.monster);
            }
          }
        }
      }
      for (const t of s.truths) expect(s.clues.filter((c) => c.truth === t.id)).toHaveLength(3);
      expect(s.endings.some((e) => !e.requires && !e.truths)).toBe(true);
      expect(planScenes(s, "kurz").length).toBeLessThan(planScenes(s, "lang").length);
      // No leftover placeholders or broken grammar markers.
      expect(JSON.stringify(s)).not.toMatch(/undefined|\$\{|von dem |von der Oger\b/);
    }
    expect(titles.size).toBeGreaterThan(20);
    expect(bosses.size).toBe(6);
  });

  it("is rebuilt exactly from its id (saved games keep working)", () => {
    const s = generateStory(4711);
    expect(isRandomStoryId(s.id)).toBe(true);
    expect(getStory(s.id)).toEqual(s);
  });
});
