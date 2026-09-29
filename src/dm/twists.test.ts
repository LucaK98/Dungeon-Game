import { describe, expect, it } from "vitest";
import { WORLD_EVENTS } from "./world-events";

describe("twist events", () => {
  const ids = ["hilflose_oma", "froschkoenig", "schatzkarte", "falscher_alarm", "wirtshausgeist", "kobold_zoll", "zauberspiegel", "gefesselter_ritter", "drache_im_stall", "zwilling"];

  it("are all there, with unique ids and at least two choices each", () => {
    const all = WORLD_EVENTS.map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    for (const id of ids) {
      const ev = WORLD_EVENTS.find((e) => e.id === id)!;
      expect(ev, id).toBeTruthy();
      expect(ev.choices!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("each fit somewhere and never hurt more than a little", () => {
    const places = ["castle", "forest", "village", "cave", "tavern", "crypt", "meadow", "town"].flatMap((theme) => [false, true].map((night) => ({ theme: theme as never, outdoor: false, night, water: true, gold: 50, health: 1 })));
    for (const id of ids) {
      const ev = WORLD_EVENTS.find((e) => e.id === id)!;
      expect(places.some((p) => ev.where(p)), id).toBe(true);
      for (const c of ev.choices!) for (const o of [c.outcome, c.check?.success, c.check?.failure]) if (o?.hurt) expect(o.hurt).toMatch(/^1d[2-6]$/);
    }
  });
});
