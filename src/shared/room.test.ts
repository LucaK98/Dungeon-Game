import { describe, expect, it } from "vitest";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "./room";

describe("room codes", () => {
  it("never contains 0, O, 1 or I", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it("normalizes user input", () => {
    expect(normalizeRoomCode(" ab-cd ")).toBe("ABCD");
    expect(isValidRoomCode("AB0D")).toBe(false);
  });
});
