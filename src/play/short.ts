/** Short labels for the phone (kept apart from the DOM code, so they can be tested). */

/** A target in a few signs: "80 % · 💥 Feuer ×2 · ✨" (the full line with RK and distance on a long press). */
export function targetShort(t: { detail: string; chance?: number }): string {
  const bits = t.detail.split(" · ");
  const pct = t.chance !== undefined ? `${Math.round(t.chance * 100)} %` : bits.find((b) => /^\d+ %$/.test(b));
  const special = bits.filter((b) => /^(💥|🛡️|🚫)/u.test(b));
  const icons = bits.filter((b) => /^(✨|⚠️|\+\d)/u.test(b)).map((b) => (b.startsWith("+") ? "🎯" : [...new Intl.Segmenter().segment(b)][0]?.segment ?? ""));
  return [pct, ...special, icons.join("")].filter(Boolean).join(" · ");
}
