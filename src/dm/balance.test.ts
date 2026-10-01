/**
 * Every fight of every story stays in its band (src/dm/balance.ts) for 2, 4 and 6 heroes – with a
 * little tolerance, because the bench plays only a few dice here. The fitted toughness comes from
 * src/dm/balance-table.json (made with balance-generate.test.ts).
 */
import { describe, expect, it } from "vitest";
import { BANDS, benchStory } from "./balance";
import { STORIES } from "./stories";

const SLACK = 0.12;

describe("balance bench", () => {
  for (const story of STORIES) {
    it(`${story.id}: every fight in its band`, () => {
      const off: string[] = [];
      for (const players of [2, 4, 6]) {
        for (const r of benchStory(story, players, "normal", 20)) {
          const band = BANDS[r.kind];
          const ok = r.win >= band.win[0] - SLACK && r.win <= band.win[1] + 0.06 && r.hpLoss <= band.hpLoss[1] + SLACK && r.hpLoss >= band.hpLoss[0] - SLACK;
          if (!ok) off.push(`${r.scene} p${players}: ${Math.round(r.win * 100)} % Siege, ${Math.round(r.hpLoss * 100)} % Leben`);
        }
      }
      expect(off).toEqual([]);
    }, 300_000);
  }
});
