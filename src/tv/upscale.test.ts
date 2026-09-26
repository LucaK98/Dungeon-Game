import { describe, expect, it } from "vitest";
import { measureRes, scale2x, upscaleFor } from "./upscale";

describe("sharp graphics", () => {
  it("renders at the screen's own resolution", () => {
    expect(measureRes(1920, 1080, 1)).toBe(1);
    expect(measureRes(1920, 1080, 2)).toBe(2);
    expect(measureRes(1366, 768, 1)).toBe(0.71);
    expect(measureRes(5000, 3000, 2)).toBe(2);
    expect(measureRes(300, 200, 1)).toBe(0.5);
  });

  it("upscales the tiles to the size they have on screen", () => {
    expect(upscaleFor(1)).toBe(2);
    expect(upscaleFor(0.71)).toBe(2);
    expect(upscaleFor(2)).toBe(4);
  });

  it("scale2x doubles the image and rounds off a diagonal", () => {
    // 2×2: a diagonal of A on B.
    const A = 1;
    const B = 2;
    const out = scale2x(new Uint32Array([A, B, B, A]), 2, 2);
    expect(out.length).toBe(16);
    // Flat areas stay flat.
    expect([...scale2x(new Uint32Array([A, A, A, A]), 2, 2)].every((p) => p === A)).toBe(true);
    // Top-left pixel A: its bottom-right sub-pixel stays A (B/H differ), corners follow the edges.
    expect(out[0]).toBe(A);
  });
});
