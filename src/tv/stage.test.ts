import { describe, expect, it } from "vitest";
import { Stage, type StageClock } from "./stage";

function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 0;
  const clock: StageClock = {
    now: () => now,
    after: (ms, fn) => {
      const id = ++next;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancel: (h) => {
      timers = timers.filter((t) => t.id !== h);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
    }
    now = end;
  };
  return { clock, advance };
}

describe("the TV's stage", () => {
  it("runs at once while nothing is shown", () => {
    const { clock } = fakeClock();
    const stage = new Stage(() => {}, clock);
    const seen: string[] = [];
    stage.run(() => seen.push("a"));
    expect(seen).toEqual(["a"]);
  });

  it("keeps rewards and words until the blow has landed, in order, and holds the game meanwhile", () => {
    const { clock, advance } = fakeClock();
    const holds: boolean[] = [];
    const stage = new Stage((on) => holds.push(on), clock);
    const seen: string[] = [];
    stage.hold(1500);
    stage.run(() => seen.push("EP"));
    stage.run(() => seen.push("Sieg"));
    expect(seen).toEqual([]);
    expect(holds).toEqual([true]);
    advance(1000);
    expect(seen).toEqual([]);
    advance(600);
    expect(seen).toEqual(["EP", "Sieg"]);
    expect(holds).toEqual([true, false]);
  });

  it("a second blow waits for the first, and what comes after waits for both", () => {
    const { clock, advance } = fakeClock();
    const stage = new Stage(() => {}, clock);
    const seen: string[] = [];
    stage.hold(1000);
    stage.run(() => {
      seen.push("blow 2");
      stage.hold(800);
    });
    stage.run(() => seen.push("reward"));
    advance(1000);
    expect(seen).toEqual(["blow 2"]);
    advance(700);
    expect(seen).toEqual(["blow 2"]);
    advance(200);
    expect(seen).toEqual(["blow 2", "reward"]);
  });

  it("soft items (the log) do not hold the game", () => {
    const { clock } = fakeClock();
    const holds: boolean[] = [];
    const stage = new Stage((on) => holds.push(on), clock);
    stage.hold(500);
    stage.run(() => {}, false);
    expect(holds).toEqual([]);
  });

  it("drain shows everything at once", () => {
    const { clock } = fakeClock();
    const stage = new Stage(() => {}, clock);
    const seen: string[] = [];
    stage.hold(5000);
    stage.run(() => seen.push("x"));
    stage.drain();
    expect(seen).toEqual(["x"]);
  });
});
