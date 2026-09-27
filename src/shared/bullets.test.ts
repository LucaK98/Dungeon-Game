import { describe, expect, it } from "vitest";
import { bulletsFor } from "./bullets";

const who = (id: string) => ({ g1: { name: "Goblin 1", hp: 0, enemy: true }, g2: { name: "Goblin 2", hp: 5, enemy: true }, b: { name: "Brunhild", hp: 9, enemy: false } })[id];

describe("result bullets", () => {
  it("damage, defeat, healing and misses", () => {
    const b = bulletsFor({ hits: [{ targetId: "g1", amount: 7, crit: true }, { targetId: "b", amount: 5, heal: true }, { targetId: "g2", amount: 0, miss: true }], lines: [] }, who);
    expect(b).toEqual([
      { tone: "damage", text: "−7 Schaden an Goblin 1 (kritisch!)" },
      { tone: "down", text: "Goblin 1 ist besiegt" },
      { tone: "heal", text: "+5 Heilung für Brunhild" },
      { tone: "miss", text: "Verfehlt: Goblin 2" },
    ]);
  });
  it("conditions from the explanation lines", () => {
    const b = bulletsFor({ lines: [{ text: "🤸 Goblin 2 liegt am Boden: Nahkampfangriffe auf Goblin 2 haben Vorteil.", glossarKeys: [] }, { text: "Goblin 1 schläft tief und fest.", glossarKeys: [] }] }, who);
    expect(b.map((x) => x.text)).toEqual(["Goblin 2 liegt am Boden", "Goblin 1 schläft"]);
  });
  it("a plain check says whether it worked", () => {
    expect(bulletsFor({ lines: [], success: false }, who)).toEqual([{ tone: "miss", text: "Nicht geschafft" }]);
  });
});
