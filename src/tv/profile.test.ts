import { describe, expect, it } from "vitest";
import { sanitizeProfile } from "./profile";

describe("profile validation", () => {
  it("accepts a valid profile", () => {
    const p = sanitizeProfile({ name: "  Brunhild  ", classId: "fighter", raceId: "human", color: "#e6194b", look: { base: "human_2", body: "chainmail", weapon: "longsword" } }, []);
    expect(p).toMatchObject({ name: "Brunhild", color: "#e6194b" });
    expect(p!.look).toMatchObject({ base: "human_2", body: "chainmail", legs: "black", boots: "gray" });
  });

  it("rejects unknown classes and empty names", () => {
    expect(sanitizeProfile({ name: "X", classId: "sorcerer", raceId: "human" }, [])).toBeUndefined();
    expect(sanitizeProfile({ name: " ", classId: "fighter", raceId: "human" }, [])).toBeUndefined();
  });

  it("drops invented look parts and fixes the base to the people", () => {
    const p = sanitizeProfile({ name: "Pip", classId: "rogue", raceId: "halfling", look: { base: "human_1", hair: "rainbow", weapon: "rapier" } }, []);
    expect(p!.look.base).toBe("halfling_1");
    expect(p!.look.hair).toBeUndefined();
    expect(p!.look.weapon).toBe("rapier");
  });

  it("replaces a colour that someone else already has", () => {
    const p = sanitizeProfile({ name: "Pip", classId: "rogue", raceId: "halfling", color: "#e6194b" }, ["#e6194b"]);
    expect(p!.color).not.toBe("#e6194b");
  });
});
