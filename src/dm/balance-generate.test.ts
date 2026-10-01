/**
 * Writes src/dm/balance-table.json: for every fight of every story and 1–6 heroes, the toughness
 * that puts it into its band. Slow (minutes) – runs only on demand:
 *   GENERATE_BALANCE=1 npx vitest run src/dm/balance-generate.test.ts
 * Afterwards run balance.test.ts: the ogre and the werewolf against two heroes tip over so easily
 * that they were set two steps softer by hand ("2@1" and "2@3").
 */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { expectedLevels, fightList, solveFactor, storyFights } from "./balance";
import { fightKey } from "./encounter";
import { STORIES } from "./stories";

describe.skipIf(!process.env.GENERATE_BALANCE)("balance table", () => {
  it("finds the toughness of every story fight", () => {
    const table: Record<string, Record<string, number>> = {};
    // STORY=<id> limits it to one story (to run them side by side), OUT=<file> writes elsewhere.
    for (const story of STORIES.filter((x) => !process.env.STORY || x.id === process.env.STORY)) {
      const fights = storyFights(story);
      const only = process.env.PLAYERS?.split(",").map(Number);
      for (let players = 1; players <= 6; players++) {
        if (only && !only.includes(players)) continue;
        const levels = expectedLevels(fights, players, "normal");
        fights.forEach((f, i) => {
          const key = `${f.kind}:${fightKey(f.groups)}`;
          const at = `${players}@${levels[i]!}`;
          if (table[key]?.[at] !== undefined) return;
          (table[key] ??= {})[at] = solveFactor(fightList(f.groups, players, "normal"), players, levels[i]!, f.kind);
        });
      }
    }
    writeFileSync(process.env.OUT ?? new URL("./balance-table.json", import.meta.url), `${JSON.stringify(table, null, 1)}\n`);
  }, 3_600_000);
});
