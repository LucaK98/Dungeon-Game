import { describe, expect, it } from "vitest";
import { retell, thirdPerson } from "./retell";

describe("the game master retells a free action", () => {
  it("turns verbs to the third person", () => {
    expect(thirdPerson("streichle")).toBe("streichelt");
    expect(thirdPerson("rede")).toBe("redet");
    expect(thirdPerson("öffne")).toBe("öffnet");
    expect(thirdPerson("werfe")).toBe("wirft");
    expect(thirdPerson("klettere")).toBe("klettert");
    expect(thirdPerson("versuche")).toBe("versucht");
    expect(thirdPerson("schleiche")).toBe("schleicht");
  });

  it("retells what the player wrote, about the hero", () => {
    expect(retell("Ich streichle den Hund", "Brunhild")).toBe("Brunhild streichelt den Hund.");
    expect(retell("ich werfe meinen Dolch auf den Goblin!", "Pip")).toBe("Pip wirft seinen Dolch auf den Goblin.");
    expect(retell("Dann schleiche ich mich an der Wache vorbei", "Pip")).toBe("Pip schleicht sich an der Wache vorbei.");
    expect(retell("Jetzt greife ich mir die Fackel und zünde das Heu an", "Brunhild")).toBe("Brunhild greift sich die Fackel und zündet das Heu an.");
    expect(retell("Ich klettere auf den Tisch und springe auf den Kronleuchter", "Ilmarin")).toBe("Ilmarin klettert auf den Tisch und springt auf den Kronleuchter.");
    expect(retell("Okay, ich rede mit dem Wirt", "Siegfried")).toBe("Siegfried redet mit dem Wirt.");
  });

  it("quotes the player when there is no 'ich'", () => {
    expect(retell("Feuerball auf den Ork!", "Ilmarin")).toBe("Ilmarin: „Feuerball auf den Ork“");
  });

  it("keeps it short", () => {
    const long = `Ich ${"renne sehr schnell ".repeat(20)}`;
    expect(retell(long, "Pip").length).toBeLessThan(160);
  });
});
