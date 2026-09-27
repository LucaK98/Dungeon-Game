import { describe, expect, it } from "vitest";
import { addTotals, BADGES, newBadges, sanitizeBadges, sanitizeTotals, type BadgeContext } from "./achievements";
import { sanitizeLegacy } from "./herobook";
import { emptyStats } from "./recap";

const ctx = (over: Partial<BadgeContext> = {}): BadgeContext => ({
  stats: emptyStats(),
  totals: {},
  won: true,
  difficulty: "normal",
  stories: 1,
  level: 2,
  gold: 10,
  goalMet: false,
  finalBlow: false,
  slain: [],
  ...over,
});

describe("badges", () => {
  it("are earned once, from one adventure or the running totals", () => {
    const ids = (c: BadgeContext, had: string[] = []) => newBadges(had, c).map((b) => b.id);
    expect(ids(ctx({ slain: ["goblin", "red-dragon-wyrmling"], finalBlow: true }))).toEqual(expect.arrayContaining(["drachentoeter", "letzter_schlag", "unverwundbar"]));
    expect(ids(ctx({ slain: ["red-dragon-wyrmling"] }), ["drachentoeter"])).not.toContain("drachentoeter");
    const s = emptyStats();
    s.crits = 4;
    const totals = addTotals({ crits: 7 }, s);
    expect(totals.crits).toBe(11);
    expect(ids(ctx({ totals }))).toContain("volltreffer");
    expect(ids(ctx({ won: false }))).not.toContain("unverwundbar");
    expect(ids(ctx({ difficulty: "toedlich" }))).toEqual(expect.arrayContaining(["hartgesotten", "todesmutig"]));
  });

  it("the hero book keeps only real badges and sane numbers", () => {
    expect(sanitizeBadges(["drachentoeter", "erfunden", "drachentoeter", 3])).toEqual(["drachentoeter"]);
    expect(sanitizeTotals({ kills: 12.7, crits: -3, hax: 5, healing: 1e9 })).toEqual({ kills: 12, healing: 99999 });
    const l = sanitizeLegacy({ level: 2, gold: 5, potions: 1, gear: { owned: [] }, stories: [], badges: ["veteran", "fake"], totals: { kills: 3 } });
    expect(l?.badges).toEqual(["veteran"]);
    expect(l?.totals).toEqual({ kills: 3 });
  });

  it("have unique ids", () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
});
