import { describe, expect, it } from "vitest";
import { pratfall, pratfallEffect, triumph } from "./pratfalls";

describe("critical fumbles (natural 1)", () => {
  it("petting a dog becomes a slap", () => {
    const f = pratfall("Ich streichle den Hund", "Brunhild", "Hund", 0);
    expect(f.line).toContain("Ohrfeige");
    expect(f.line).toContain("Brunhild");
    expect(f.effect).toBe("enrage");
  });

  it("finds the comic opposite for many plans", () => {
    expect(pratfall("Ich schleiche mich leise vorbei", "Pip", undefined, 0).line).toMatch(/Eimer/);
    expect(pratfall("Ich heile Siegfried", "Ilmarin", "Siegfried", 0).line).toMatch(/Lampenöl/);
    expect(pratfall("Ich klettere die Mauer hoch", "Pip", undefined, 0).line).toMatch(/kopfüber/);
    expect(pratfall("Ich überrede die Wache", "Pip", "Wache", 0).line).toContain("Wache");
  });

  it("never talks about a 'who' when nobody is there, and has something for any idea", () => {
    const f = pratfall("Ich streichle den Hund", "Brunhild", undefined, 0);
    expect(f.line).not.toContain("jemand");
    expect(f.line).toContain("Brunhild");
    expect(pratfall("Ich mache etwas völlig anderes", "Pip", undefined, 1).line).toContain("Pip");
  });

  it("keeps the consequences small", () => {
    expect(pratfallEffect("hurt", undefined)).toEqual({ kind: "hurt", severity: "leicht" });
    expect(pratfallEffect("enrage", undefined)).toBeUndefined();
    expect(pratfallEffect("enrage", "m1")).toEqual({ kind: "enrage", target: "m1" });
  });
});

describe("triumphs (natural 20)", () => {
  it("celebrates the hero", () => {
    expect(triumph("Pip", 0)).toContain("NATÜRLICHE 20");
    expect(triumph("Pip", 2)).toContain("Pip");
  });
});
