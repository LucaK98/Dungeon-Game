import { describe, expect, it } from "vitest";
import { nameFits, walkIntent } from "./walk-text";

describe("walking by text", () => {
  it("finds where to go and what comes after", () => {
    expect(walkIntent("Ich gehe zur Theke")).toEqual({ target: "theke", rest: "" });
    expect(walkIntent("Ich renne zum Goblin 2 und schlage zu!")).toEqual({ target: "goblin 2", rest: "schlage zu!" });
    expect(walkIntent("Ich laufe zu Brunhild, dann heile ich sie")).toEqual({ target: "brunhild", rest: "heile ich sie" });
    expect(walkIntent("Ich frage den Wirt nach dem Weg")).toBeUndefined();
    expect(walkIntent("Ich schieße auf den Goblin")).toBeUndefined();
  });
  it("matches names loosely", () => {
    expect(nameFits("den wirt", "Wirt Bartholomäus")).toBe(true);
    expect(nameFits("das regal", "Bücherregal")).toBe(true);
    expect(nameFits("goblin 2", "Goblin 2")).toBe(true);
    expect(nameFits("die truhe", "Tür")).toBe(false);
  });
});
