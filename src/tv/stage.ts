/**
 * The TV's stage: things are shown one after another, never ahead of what can be seen.
 *
 * A blow takes a while on the board (the die tumbles, the hero walks up, the arrow flies). Until it
 * has landed, everything that follows waits in line: the words of the storyteller, rewards and
 * experience, the end of the fight, the next turn, a new map. "Hard" waiting items also hold the
 * game (like the storyteller speaking) so the next foe does not strike in the middle of it.
 */
export interface StageClock {
  now(): number;
  after(ms: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
}

const realClock: StageClock = {
  now: () => Date.now(),
  after: (ms, fn) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Stage {
  private until = 0;
  private queue: { fn: () => void; hard: boolean }[] = [];
  private timer: unknown;
  private holding = false;

  /** onHold(true) while something important waits (the game pauses like for the storyteller). */
  constructor(
    private readonly onHold: (on: boolean) => void = () => {},
    private readonly clock: StageClock = realClock,
  ) {}

  /** Something is being shown for this long from now (extends, never shortens). */
  hold(ms: number): void {
    this.until = Math.max(this.until, this.clock.now() + Math.max(0, ms));
    if (this.queue.length) this.schedule();
  }

  /** Milliseconds until the stage is free. */
  remaining(): number {
    return Math.max(0, this.until - this.clock.now());
  }

  /** Runs now if the stage is free and nobody waits, otherwise in line. */
  run(fn: () => void, hard = true): void {
    if (!this.queue.length && this.remaining() <= 0) {
      fn();
      return;
    }
    this.queue.push({ fn, hard });
    this.syncHold();
    this.schedule();
  }

  /** Everything still waiting, at once (the board is closed or rebuilt). */
  drain(): void {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = undefined;
    this.until = 0;
    const waiting = this.queue.splice(0);
    for (const w of waiting) w.fn();
    this.syncHold();
  }

  private schedule(): void {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = this.clock.after(this.remaining(), () => this.flush());
  }

  private flush(): void {
    this.timer = undefined;
    while (this.queue.length) {
      if (this.remaining() > 0) {
        this.schedule();
        this.syncHold();
        return;
      }
      this.queue.shift()!.fn();
    }
    this.syncHold();
  }

  private syncHold(): void {
    const on = this.queue.some((w) => w.hard);
    if (on === this.holding) return;
    this.holding = on;
    this.onHold(on);
  }
}
