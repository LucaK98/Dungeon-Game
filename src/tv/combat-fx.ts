/**
 * Fight animations on the board: sword swings, claws, arrows and bolts, thrown axes, fire bolts,
 * frost rays, magic darts, holy flames, dragon breath, healing light. Simple shapes and particles,
 * no extra graphics needed. Returns how long until the blow lands, so the damage numbers
 * appear at the right moment.
 */
import Phaser from "phaser";
import type { ActionFx } from "../shared/view";

const TILE = 32;
const DEPTH = 4600;

const COLORS: Record<NonNullable<ActionFx["element"]>, number[]> = {
  fire: [0xff6a1a, 0xffb030, 0xffe070],
  cold: [0x8fd8ff, 0xd8f4ff, 0x5fb0ff],
  radiant: [0xfff2a0, 0xffd84a, 0xffffff],
  force: [0xc88cff, 0x9a5cff, 0xf0d8ff],
  necrotic: [0x6a3a8a, 0x3a1a4a, 0xa070c0],
  poison: [0x7fdc4a, 0xb8f070, 0x4a9a2a],
};

type Pos = { x: number; y: number };

export class CombatFx {
  constructor(
    private scene: Phaser.Scene,
    /** Where a creature stands now (world pixels) and its figure's body to move. */
    private figure: (id: string) => { pos: Pos; body?: Phaser.GameObjects.Container } | undefined,
  ) {}

  /** Plays the animations; resolves the delay (ms) until the hits should show. */
  play(list: ActionFx[]): number {
    let impact = 0;
    list.forEach((fx, i) => {
      const delay = i * 180;
      impact = Math.max(impact, delay + this.one(fx, delay));
    });
    return impact;
  }

  private one(fx: ActionFx, delay: number): number {
    const from = this.figure(fx.from);
    const targets = fx.to.map((id) => this.figure(id)).filter((t): t is NonNullable<typeof t> => !!t);
    if (!from) return 0;
    const at = (ms: number, fn: () => void) => this.scene.time.delayedCall(delay + ms, fn);
    switch (fx.kind) {
      case "melee":
      case "claw": {
        const t = targets[0];
        if (!t) return 0;
        at(0, () => this.lunge(from, t.pos));
        at(130, () => (fx.miss ? this.dodge(t) : fx.kind === "claw" ? this.claw(t.pos, !!fx.crit) : this.slash(from.pos, t.pos, !!fx.crit)));
        return 150;
      }
      case "arrow":
      case "bolt":
      case "stone":
      case "thrown": {
        const t = targets[0];
        if (!t) return 0;
        const flight = this.flightTime(from.pos, t.pos, fx.kind === "thrown" ? 0.45 : 0.35);
        at(0, () => this.projectile(fx.kind, from.pos, fx.miss ? this.missPoint(from.pos, t.pos) : t.pos, flight));
        at(flight, () => (fx.miss ? this.dodge(t) : this.impact(t.pos, 0xffffff, !!fx.crit)));
        return flight;
      }
      case "spell": {
        const colors = COLORS[fx.element ?? "force"];
        if (fx.spellId === "sacred-flame") {
          targets.forEach((t) => at(0, () => this.pillar(t.pos, colors)));
          at(0, () => this.glow(from.pos, colors[0]!));
          return 380;
        }
        if (fx.spellId === "ray-of-frost" || fx.spellId === "scorching-ray") {
          targets.forEach((t, k) => at(k * 120, () => this.beam(from.pos, fx.miss ? this.missPoint(from.pos, t.pos) : t.pos, colors)));
          targets.forEach((t, k) => at(k * 120 + 160, () => !fx.miss && this.burst(t.pos, colors, 14)));
          return 180 + (targets.length - 1) * 120;
        }
        if (fx.spellId === "magic-missile") {
          // Three darts (they never miss), spread over the targets.
          const flight = 520;
          for (let k = 0; k < 3; k++) {
            const t = targets[k % Math.max(1, targets.length)];
            if (t) at(k * 90, () => this.orb(from.pos, t.pos, colors, flight, 0.12, (k - 1) * 22));
          }
          targets.forEach((t) => at(flight + 90, () => this.burst(t.pos, colors, 10)));
          return flight + 90;
        }
        // Fire bolt, guiding bolt and the rest: a glowing ball.
        const t = targets[0];
        if (!t) return 0;
        const flight = this.flightTime(from.pos, t.pos, 0.45);
        at(0, () => this.glow(from.pos, colors[0]!));
        at(0, () => this.orb(from.pos, fx.miss ? this.missPoint(from.pos, t.pos) : t.pos, colors, flight, 0.2, 0));
        at(flight, () => (fx.miss ? this.dodge(t) : this.burst(t.pos, colors, 22)));
        return flight;
      }
      case "breath": {
        const colors = COLORS[fx.element ?? "fire"];
        const aim = targets[0]?.pos ?? { x: from.pos.x + TILE * 3, y: from.pos.y };
        at(0, () => this.cone(from.pos, aim, colors));
        targets.forEach((t) => at(380, () => this.burst(t.pos, colors, 12)));
        return 380;
      }
      case "heal":
        targets.forEach((t) => at(0, () => this.healing(t.pos)));
        if (fx.from !== fx.to[0]) at(0, () => this.glow(from.pos, 0x8dff8d));
        return 250;
      case "buff":
        targets.forEach((t) => at(0, () => this.ring(t.pos, COLORS.radiant)));
        return 200;
      case "sleep":
        targets.forEach((t) => at(0, () => this.sleepDust(t.pos)));
        return 300;
      case "turn":
        at(0, () => this.shockwave(from.pos, COLORS.radiant));
        return 300;
    }
  }

  // ---------------------------------------------------------------- building blocks

  private flightTime(a: Pos, b: Pos, perTileSec: number): number {
    // Slow enough to follow from the sofa, quick enough not to hold up the fight.
    return Math.max(300, Math.min(900, (Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) / TILE) * perTileSec * 250));
  }

  /** Where a missed shot flies: a bit past and beside the target. */
  private missPoint(a: Pos, b: Pos): Pos {
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + 0.35;
    const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) + TILE;
    return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
  }

  /** The attacker leans into the blow. */
  private lunge(from: { pos: Pos; body?: Phaser.GameObjects.Container }, to: Pos): void {
    if (!from.body) return;
    const ang = Math.atan2(to.y - from.pos.y, to.x - from.pos.x);
    const body = from.body;
    const bx = body.x;
    const by = body.y;
    this.scene.tweens.add({ targets: body, x: bx + Math.cos(ang) * 9, y: by + Math.sin(ang) * 9, duration: 110, yoyo: true, ease: "Quad.easeOut", onComplete: () => body.setPosition(bx, by) });
  }

  /** The target steps aside. */
  private dodge(t: { pos: Pos; body?: Phaser.GameObjects.Container }): void {
    if (!t.body) return;
    const body = t.body;
    const bx = body.x;
    this.scene.tweens.add({ targets: body, x: bx + (Math.random() < 0.5 ? -7 : 7), duration: 90, yoyo: true, ease: "Quad.easeOut", onComplete: () => body.setX(bx) });
  }

  /** A curved white (gold for crits) cut across the target. */
  private slash(from: Pos, to: Pos, crit: boolean): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setPosition(to.x, to.y - 4);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const r = crit ? 16 : 12;
    const color = crit ? 0xffd84a : 0xffffff;
    g.lineStyle(crit ? 4 : 3, color, 1);
    g.beginPath();
    g.arc(0, 0, r, ang - 1.2, ang + 1.2);
    g.strokePath();
    g.lineStyle(1.5, 0xffffff, 0.8);
    g.beginPath();
    g.arc(0, 0, r - 3, ang - 0.9, ang + 0.9);
    g.strokePath();
    g.setRotation(-0.6).setScale(0.6);
    this.scene.tweens.add({ targets: g, rotation: 0.5, scale: 1.1, alpha: 0, duration: 260, ease: "Cubic.easeOut", onComplete: () => g.destroy() });
    this.impact(to, color, crit);
  }

  /** Three scratches. */
  private claw(to: Pos, crit: boolean): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setPosition(to.x, to.y - 4);
    g.lineStyle(crit ? 3 : 2, crit ? 0xffd84a : 0xff5a4a, 1);
    for (let k = -1; k <= 1; k++) g.lineBetween(-7 + k * 5, -9, 5 + k * 5, 9);
    g.setScale(0.5);
    this.scene.tweens.add({ targets: g, scale: 1.1, alpha: 0, duration: 280, ease: "Cubic.easeOut", onComplete: () => g.destroy() });
    this.impact(to, 0xff5a4a, crit);
  }

  /** A short flash and a few sparks where a blow lands. */
  private impact(at: Pos, color: number, crit: boolean): void {
    const flash = this.scene.add.image(at.x, at.y - 4, "amb-dot").setDepth(DEPTH).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(crit ? 2.2 : 1.4).setAlpha(0.9);
    this.scene.tweens.add({ targets: flash, scale: crit ? 3.4 : 2.2, alpha: 0, duration: 220, onComplete: () => flash.destroy() });
    const e = this.scene.add.particles(at.x, at.y - 4, "amb-dot", { lifespan: 380, speed: { min: 30, max: crit ? 120 : 80 }, scale: { start: 0.18, end: 0 }, tint: [color, 0xffffff], blendMode: Phaser.BlendModes.ADD, emitting: false }).setDepth(DEPTH);
    e.explode(crit ? 18 : 9);
    this.scene.time.delayedCall(500, () => e.destroy());
  }

  /** Arrow, crossbow bolt, sling stone or a spinning thrown weapon. */
  private projectile(kind: ActionFx["kind"], from: Pos, to: Pos, ms: number): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setPosition(from.x, from.y - 6);
    if (kind === "stone") {
      g.fillStyle(0x9a948a, 1).fillCircle(0, 0, 2.5);
    } else if (kind === "thrown") {
      // A small axe/dagger shape that spins.
      g.fillStyle(0x6b4a2a, 1).fillRect(-5, -1, 10, 2);
      g.fillStyle(0xd8dce0, 1).fillTriangle(5, -4, 9, 0, 5, 4);
    } else {
      const len = kind === "bolt" ? 8 : 12;
      g.lineStyle(1.5, 0x8a6a3a, 1).lineBetween(-len / 2, 0, len / 2, 0);
      g.fillStyle(0xd8dce0, 1).fillTriangle(len / 2, -2, len / 2 + 4, 0, len / 2, 2);
      g.fillStyle(0xe8e0d0, 1).fillTriangle(-len / 2, 0, -len / 2 - 3, -2.5, -len / 2 - 1, 0).fillTriangle(-len / 2, 0, -len / 2 - 3, 2.5, -len / 2 - 1, 0);
    }
    g.setRotation(Math.atan2(to.y - from.y, to.x - from.x));
    // A slight arc for thrown things and arrows over distance.
    const lift = kind === "bolt" ? 0 : Math.min(18, Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y) / 8);
    const start = { x: from.x, y: from.y - 6 };
    const end = { x: to.x, y: to.y - 6 };
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ms,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        g.setPosition(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t - Math.sin(t * Math.PI) * lift);
        if (kind === "thrown") g.rotation += 0.45;
      },
      onComplete: () => g.destroy(),
    });
  }

  /** A glowing ball of magic with a trail. */
  private orb(from: Pos, to: Pos, colors: number[], ms: number, size: number, curve: number): void {
    const ball = this.scene.add.image(from.x, from.y - 8, "amb-dot").setDepth(DEPTH).setTint(colors[0]!).setBlendMode(Phaser.BlendModes.ADD).setScale(size * 7);
    const trail = this.scene.add.particles(0, 0, "amb-dot", { follow: ball, lifespan: 300, frequency: 20, speed: { min: 2, max: 12 }, scale: { start: size * 2.5, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: colors, blendMode: Phaser.BlendModes.ADD }).setDepth(DEPTH);
    const start = { x: from.x, y: from.y - 8 };
    const end = { x: to.x, y: to.y - 6 };
    const nx = -(end.y - start.y);
    const ny = end.x - start.x;
    const nl = Math.hypot(nx, ny) || 1;
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ms,
      ease: "Sine.easeIn",
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const bend = Math.sin(t * Math.PI) * curve;
        ball.setPosition(start.x + (end.x - start.x) * t + (nx / nl) * bend, start.y + (end.y - start.y) * t + (ny / nl) * bend);
      },
      onComplete: () => {
        ball.destroy();
        trail.stop();
        this.scene.time.delayedCall(350, () => trail.destroy());
      },
    });
  }

  /** A straight ray (frost, fire). */
  private beam(from: Pos, to: Pos, colors: number[]): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(6, colors[0]!, 0.5).lineBetween(from.x, from.y - 8, to.x, to.y - 6);
    g.lineStyle(2, colors[1] ?? 0xffffff, 1).lineBetween(from.x, from.y - 8, to.x, to.y - 6);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 380, ease: "Quad.easeIn", onComplete: () => g.destroy() });
  }

  /** A column of holy light falling on the target. */
  private pillar(at: Pos, colors: number[]): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setBlendMode(Phaser.BlendModes.ADD).setPosition(at.x, at.y);
    g.fillStyle(colors[0]!, 0.35).fillRect(-9, -70, 18, 72);
    g.fillStyle(colors[2] ?? 0xffffff, 0.7).fillRect(-3, -70, 6, 72);
    g.setScale(0.2, 1);
    this.scene.tweens.add({ targets: g, scaleX: 1, duration: 140, yoyo: true, hold: 160, onComplete: () => g.destroy() });
    this.scene.time.delayedCall(200, () => this.burst(at, colors, 16));
  }

  /** Sparks bursting outwards. */
  private burst(at: Pos, colors: number[], n: number): void {
    const e = this.scene.add.particles(at.x, at.y - 4, "amb-dot", { lifespan: 500, speed: { min: 20, max: 90 }, scale: { start: 0.3, end: 0 }, alpha: { start: 1, end: 0 }, tint: colors, blendMode: Phaser.BlendModes.ADD, emitting: false }).setDepth(DEPTH);
    e.explode(n);
    this.scene.time.delayedCall(600, () => e.destroy());
    const flash = this.scene.add.image(at.x, at.y - 4, "amb-dot").setDepth(DEPTH).setTint(colors[0]!).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5);
    this.scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
  }

  /** The caster's hands light up. */
  private glow(at: Pos, color: number): void {
    const g = this.scene.add.image(at.x, at.y - 6, "amb-dot").setDepth(DEPTH).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0.9);
    this.scene.tweens.add({ targets: g, scale: 2.2, alpha: 0, duration: 420, onComplete: () => g.destroy() });
  }

  /** Breath or burning hands: a cone of particles towards the target. */
  private cone(from: Pos, to: Pos, colors: number[]): void {
    const ang = Phaser.Math.RadToDeg(Math.atan2(to.y - from.y, to.x - from.x));
    const dist = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y) + TILE;
    const e = this.scene.add.particles(from.x, from.y - 6, "amb-dot", {
      lifespan: (dist / 180) * 1000,
      speed: { min: 150, max: 210 },
      angle: { min: ang - 22, max: ang + 22 },
      scale: { start: 0.25, end: 0.9 },
      alpha: { start: 0.9, end: 0 },
      tint: colors,
      blendMode: Phaser.BlendModes.ADD,
      frequency: 12,
      quantity: 3,
    }).setDepth(DEPTH);
    this.scene.time.delayedCall(420, () => e.stop());
    this.scene.time.delayedCall(1400, () => e.destroy());
  }

  /** Green light and little plus signs rising. */
  private healing(at: Pos): void {
    const e = this.scene.add.particles(at.x, at.y + 6, "amb-dot", { lifespan: 800, speedY: { min: -40, max: -20 }, speedX: { min: -10, max: 10 }, scale: { start: 0.25, end: 0 }, tint: [0x8dff8d, 0xd8ffd8], blendMode: Phaser.BlendModes.ADD, emitting: false, x: { min: -10, max: 10 } }).setDepth(DEPTH);
    e.explode(16);
    this.scene.time.delayedCall(900, () => e.destroy());
    for (let k = 0; k < 3; k++) {
      const plus = this.scene.add.text(at.x + (k - 1) * 8, at.y - 4, "+", { fontFamily: "system-ui", fontSize: "28px", fontStyle: "bold", color: "#8dff8d", stroke: "#0a3a0a", strokeThickness: 5 }).setOrigin(0.5).setScale(0.35).setDepth(DEPTH).setAlpha(0);
      this.scene.tweens.add({ targets: plus, y: at.y - 26, alpha: { from: 1, to: 0 }, delay: k * 110, duration: 650, onComplete: () => plus.destroy() });
    }
  }

  /** A golden ring (blessings, shields). */
  private ring(at: Pos, colors: number[]): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setBlendMode(Phaser.BlendModes.ADD).setPosition(at.x, at.y + 8);
    g.lineStyle(2, colors[1] ?? 0xffd84a, 1).strokeEllipse(0, 0, 26, 10);
    g.setScale(0.4);
    this.scene.tweens.add({ targets: g, scale: 1.3, alpha: 0, duration: 600, ease: "Cubic.easeOut", onComplete: () => g.destroy() });
    this.burst({ x: at.x, y: at.y - 6 }, colors, 6);
  }

  /** Pink dust drifting down on sleepers. */
  private sleepDust(at: Pos): void {
    const e = this.scene.add.particles(at.x, at.y - 22, "amb-dot", { lifespan: 900, speedY: { min: 10, max: 25 }, speedX: { min: -12, max: 12 }, scale: { start: 0.2, end: 0.05 }, tint: [0xffb8e8, 0xe0c8ff], blendMode: Phaser.BlendModes.ADD, emitting: false }).setDepth(DEPTH);
    e.explode(18);
    this.scene.time.delayedCall(1000, () => e.destroy());
  }

  /** A ring of light spreading from the caster (turn undead). */
  private shockwave(at: Pos, colors: number[]): void {
    const g = this.scene.add.graphics().setDepth(DEPTH).setBlendMode(Phaser.BlendModes.ADD).setPosition(at.x, at.y);
    g.lineStyle(3, colors[0]!, 1).strokeCircle(0, 0, 12);
    g.setScale(0.3);
    this.scene.tweens.add({ targets: g, scale: 6, alpha: 0, duration: 700, ease: "Cubic.easeOut", onComplete: () => g.destroy() });
  }
}
