import { describe, expect, it } from "vitest";
import { shorten } from "./director";

describe("short game master lines", () => {
  it("keeps at most the given number of sentences", () => {
    expect(shorten("Der Wind heult. Ein Wolf ruft! Wer ist da? Stille.", 2)).toBe("Der Wind heult. Ein Wolf ruft!");
    expect(shorten("Nur ein Satz ohne Punkt", 2)).toBe("Nur ein Satz ohne Punkt");
  });
  it("cuts very long sentences at a word", () => {
    const long = `${"sehr ".repeat(100)}lang.`;
    const out = shorten(long, 2);
    expect(out.length).toBeLessThanOrEqual(320);
    expect(out.endsWith(" …")).toBe(true);
  });
});
