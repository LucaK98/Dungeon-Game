import { describe, expect, it } from "vitest";
import { reportLines } from "./report";

describe("evening report", () => {
  it("sums up fights, waiting and who was quiet", () => {
    const lines = reportLines({
      fights: [
        { rounds: 4, hpLost: 0.3, won: true, boss: false },
        { rounds: 6, hpLost: 0.6, won: true, boss: true },
      ],
      waits: [10, 20, 50],
      spotlights: 2,
      acts: { Brunhild: 12, Ilmarin: 11, Ole: 1 },
      tricks: 5,
    }).map((l) => l.text);
    expect(lines[0]).toBe("2 Kämpfe, im Schnitt 5,0 Runden und 45 % Leben verloren – 1× wurde es richtig knapp.");
    expect(lines.some((l) => l.includes("27 Sekunden") && l.includes("1× länger"))).toBe(true);
    expect(lines.some((l) => l.includes("Eher still: Ole"))).toBe(true);
    expect(lines.some((l) => l.includes("2× hat der Spielleiter"))).toBe(true);
  });

  it("works for a game without fights", () => {
    expect(reportLines({ fights: [], waits: [], spotlights: 0, acts: {}, tricks: 0 }).length).toBe(1);
  });
});
