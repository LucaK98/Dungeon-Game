import { describe, expect, it } from "vitest";
import { build, markCarried, sagaCarry, sanitizeSaga, sanitizeVillage, villageIncome, type Saga } from "./homeland";
import { pickRoutes } from "./travel";

describe("home village", () => {
  it("builds with the village's gold, once each", () => {
    const v = sanitizeVillage({ gold: 100, built: ["quatsch"] });
    expect(v.built).toEqual([]);
    expect(build(v, "kraeuterhuette")).toBeUndefined();
    expect(v.gold).toBe(60);
    expect(build(v, "kraeuterhuette")).toBe("Das steht schon.");
    expect(build(v, "tempel")).toContain("fehlen");
    expect(villageIncome(true, 4)).toBeGreaterThan(villageIncome(false, 4));
  });
});

describe("the saga", () => {
  it("brings back an old friend and a foe that got away – once", () => {
    const saga: Saga = sanitizeSaga({
      entries: [
        { storyId: "a", title: "Drachenfels", endingTitle: "Der Drache fliegt davon", kind: "bittersuess", heroes: ["Pip"], at: 1, nemesis: { monster: "ogre", name: "Grummelbauch" } },
        { storyId: "b", title: "Rattenfänger", endingTitle: "Sieg", kind: "sieg", heroes: ["Pip"], at: 2, ally: { monster: "noble", name: "Gräfin Irmgard" } },
      ],
    });
    const carry = sagaCarry(saga);
    expect(carry.recap).toContain("Rattenfänger");
    expect(carry.ally?.name).toBe("Gräfin Irmgard");
    expect(carry.nemesis?.name).toBe("Grummelbauch");
    markCarried(saga, carry);
    const next = sagaCarry(saga);
    expect(next.ally).toBeUndefined();
    expect(next.nemesis).toBeUndefined();
  });
});

describe("travel map", () => {
  it("offers three different routes through real Harz places", () => {
    let k = 0;
    const routes = pickRoutes((n) => k++ % n);
    expect(routes).toHaveLength(3);
    expect(new Set(routes.map((r) => r.event)).size).toBe(3);
    expect(new Set(routes.map((r) => r.name)).size).toBe(3);
  });
});
