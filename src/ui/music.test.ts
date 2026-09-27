import { describe, expect, it } from "vitest";
import { composeMotifs } from "./music";

describe("music", () => {
  it("composes short motifs that stay in a singable range", () => {
    const style = { bpm: 84, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], chords: [0, 6, 3, 4], lead: "flute" as const, bass: "drone" as const, drums: "none" as const, density: 0.45, volume: 0.5 };
    const motifs = composeMotifs(style, 7);
    expect(motifs.length).toBe(3);
    for (const m of motifs) {
      expect(m.length).toBe(16);
      const notes = m.filter((n): n is number => n !== null);
      expect(notes.length).toBeGreaterThan(0);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(-2);
      expect(Math.max(...notes)).toBeLessThanOrEqual(9);
    }
    // Same seed, same tune.
    expect(composeMotifs(style, 7)).toEqual(motifs);
    expect(composeMotifs(style, 8)).not.toEqual(motifs);
  });
});
