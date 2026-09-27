import { describe, expect, it } from "vitest";
import { browserStyle, kindOf, MODELS, neuralVoice, sentences, speakable, voiceIsFemale, voiceScore } from "./cast";
import { STORIES } from "../../dm/stories";

describe("voices per character", () => {
  it("guesses who is speaking", () => {
    expect(kindOf(undefined)).toBe("narrator");
    expect(kindOf("Wirtin Hilde")).toBe("female");
    expect(kindOf("Die Grüne Vettel")).toBe("female");
    expect(kindOf("Schmied Hagen")).toBe("male");
    expect(kindOf("Oger")).toBe("monster");
    expect(kindOf("Geist der Wilden Jagd")).toBe("ghost");
    expect(kindOf("Kleine Lina")).toBe("child");
  });

  it("gives every story character a voice that exists, always the same one", () => {
    for (const story of STORIES) {
      for (const npc of story.npcs) {
        const v = neuralVoice(npc.name);
        expect(MODELS[v.model], npc.name).toBeDefined();
        expect(neuralVoice(npc.name)).toEqual(v);
        expect(v.lengthScale).toBeGreaterThan(0.85);
        expect(v.lengthScale).toBeLessThan(1.3);
      }
    }
    // Characters don't all sound alike.
    const names = STORIES.flatMap((s) => s.npcs.map((n) => n.name));
    const distinct = new Set(names.map((n) => JSON.stringify(neuralVoice(n))));
    expect(distinct.size).toBeGreaterThan(names.length / 3);
    expect(neuralVoice(undefined).model).toBe("de_DE-thorsten-medium");
  });

  it("prefers natural browser voices and knows their gender", () => {
    const voices = [
      { name: "eSpeak German", lang: "de" },
      { name: "Google Deutsch", lang: "de-DE" },
      { name: "Microsoft Katja Online (Natural) - German (Germany)", lang: "de-DE" },
      { name: "Samantha", lang: "en-US" },
    ];
    const best = [...voices].sort((a, b) => voiceScore(b) - voiceScore(a));
    expect(best[0]!.name).toContain("Katja");
    expect(voiceScore(voices[3]!)).toBeLessThan(0);
    expect(voiceIsFemale("Microsoft Katja Online (Natural)")).toBe(true);
    expect(voiceIsFemale("Microsoft Conrad Online (Natural)")).toBe(false);
    expect(browserStyle("Oger").pitch).toBeLessThan(0.7);
    expect(browserStyle(undefined)).toMatchObject({ pitch: 1, rate: 1 });
  });

  it("speaks text without emoji, sentence by sentence", () => {
    expect(speakable("💾 Speicherpunkt erreicht. „Hallo!“")).toBe("Speicherpunkt erreicht. Hallo!");
    expect(sentences("Erster Satz. Zweiter Satz! Ja. Dritter?")).toEqual(["Erster Satz.", "Zweiter Satz! Ja. Dritter?"]);
    expect(sentences("Ohne Punkt")).toEqual(["Ohne Punkt"]);
  });
});
