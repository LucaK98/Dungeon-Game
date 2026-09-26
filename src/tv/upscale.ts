/** Pure helpers for the sharp graphics (see render.ts), kept free of Phaser for the tests. */

export function measureRes(width: number, height: number, dpr: number): number {
  const r = Math.min((width * dpr) / 1920, (height * dpr) / 1080);
  return Math.max(0.5, Math.min(2, Math.round(r * 100) / 100));
}

/** Scale2x (AdvMAME2x): doubles pixel art and rounds off stair-step edges. */
export function scale2x(src: Uint32Array, w: number, h: number): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(w * h * 4);
  const W = w * 2;
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const row = y * w;
    const down = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const left = x > 0 ? x - 1 : x;
      const right = x < w - 1 ? x + 1 : x;
      const E = src[row + x]!;
      const B = src[up + x]!;
      const H = src[down + x]!;
      const D = src[row + left]!;
      const F = src[row + right]!;
      let e0 = E;
      let e1 = E;
      let e2 = E;
      let e3 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const i = y * 2 * W + x * 2;
      out[i] = e0;
      out[i + 1] = e1;
      out[i + W] = e2;
      out[i + W + 1] = e3;
    }
  }
  return out;
}

/** Upscale factor for the atlas: how big a 32 px tile is on screen (board zoom 2). */
export function upscaleFor(res: number): number {
  return 2 * res >= 3 ? 4 : 2;
}

