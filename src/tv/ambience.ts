/**
 * Life on the board that has no rules: dust in the torch light, fireflies at night, drips in
 * caves, embers in the dragon's lair, and small animals that wander around and flee from the
 * heroes. Everything is decoration: it never touches the game state and uses its own dice
 * (Math.random), so the game stays reproducible.
 */
import Phaser from "phaser";
import type { Creature, GridPos } from "../shared/game";
import { cellIndex, type DungeonMap, type PlacedRoom, type Theme } from "../shared/map";
import type { GameSession } from "./session";

const TILE = 32;
/** Above figures, below the darkness. */
const DEPTH_AIR = 4500;
/** Above the darkness: things that glow by themselves (fireflies, witch fire). */
const DEPTH_GLOW = 5001;

type CritterKind = "rat" | "butterfly" | "bat" | "sheep" | "hog" | "dog" | "spider" | "frog" | "snake" | "moth";

interface CritterStyle {
  frames: string[];
  scale: number;
  /** Milliseconds per square. */
  pace: number;
  flies?: boolean;
  /** Runs away from heroes (distance in squares); calm animals only step aside. */
  shy: number;
  /** Follows the heroes around (dogs). */
  friendly?: boolean;
}

const CRITTERS: Record<CritterKind, CritterStyle> = {
  rat: { frames: ["critter.rat"], scale: 0.55, pace: 220, shy: 3 },
  butterfly: { frames: ["critter.butterfly.0", "critter.butterfly.1", "critter.butterfly.2"], scale: 0.38, pace: 700, flies: true, shy: 2 },
  bat: { frames: ["critter.bat"], scale: 0.5, pace: 260, flies: true, shy: 3 },
  sheep: { frames: ["critter.sheep"], scale: 0.75, pace: 900, shy: 1.5 },
  hog: { frames: ["critter.hog"], scale: 0.7, pace: 800, shy: 1.5 },
  dog: { frames: ["critter.dog"], scale: 0.65, pace: 350, shy: 0, friendly: true },
  spider: { frames: ["critter.spider"], scale: 0.45, pace: 400, shy: 2 },
  frog: { frames: ["critter.frog"], scale: 0.42, pace: 500, shy: 2 },
  snake: { frames: ["critter.snake"], scale: 0.5, pace: 600, shy: 2.5 },
  moth: { frames: ["critter.moth"], scale: 0.38, pace: 500, flies: true, shy: 1.5 },
};

/** Which animals live in which kind of place: [kind, how many] by day and by night. */
const HABITAT: Record<Theme, { day: [CritterKind, number][]; night: [CritterKind, number][] }> = {
  castle: { day: [["rat", 1]], night: [["rat", 1], ["bat", 1]] },
  throne: { day: [["dog", 1]], night: [["dog", 1]] },
  meadow: { day: [["butterfly", 3]], night: [["moth", 2]] },
  forest: { day: [["butterfly", 2], ["frog", 1], ["snake", 1]], night: [["bat", 2], ["moth", 1]] },
  village: { day: [["hog", 1], ["sheep", 2], ["dog", 1]], night: [["dog", 1], ["bat", 1]] },
  town: { day: [["rat", 1], ["dog", 1]], night: [["rat", 2]] },
  cave: { day: [["bat", 2], ["rat", 1], ["spider", 1]], night: [["bat", 2], ["rat", 1], ["spider", 1]] },
  mine: { day: [["rat", 2], ["bat", 1]], night: [["rat", 2], ["bat", 1]] },
  lair: { day: [["rat", 2], ["bat", 1]], night: [["rat", 2], ["bat", 1]] },
  crypt: { day: [["rat", 1], ["spider", 2], ["moth", 1]], night: [["rat", 1], ["spider", 2], ["moth", 1]] },
  stone: { day: [["rat", 1]], night: [["rat", 1]] },
  peak: { day: [["butterfly", 1]], night: [["bat", 2]] },
  church: { day: [["moth", 1], ["rat", 1]], night: [["moth", 1], ["bat", 1]] },
  tavern: { day: [["dog", 1], ["rat", 1]], night: [["dog", 1], ["rat", 1]] },
};

interface Critter {
  kind: CritterKind;
  style: CritterStyle;
  img: Phaser.GameObjects.Image;
  room: PlacedRoom;
  cell: GridPos;
  busyUntil: number;
  gone?: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

export class Ambience {
  private active = new Set<number>();
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private critters: Critter[] = [];
  private lastCheck = 0;
  private lastCritters = 0;
  private combat = false;

  constructor(
    private scene: Phaser.Scene,
    private getSession: () => GameSession,
    private tile: (x: number, y: number, frame: string) => Phaser.GameObjects.Image,
  ) {}

  private get map(): DungeonMap {
    return this.getSession().map;
  }

  start(): void {
    this.makeTextures();
    this.active.clear();
    this.emitters = [];
    this.critters = [];
  }

  // ---------------------------------------------------------------- textures

  private makeTextures(): void {
    const tex = this.scene.textures;
    if (!tex.exists("amb-dot")) {
      const c = tex.createCanvas("amb-dot", 16, 16)!;
      const g = c.context.createRadialGradient(8, 8, 0, 8, 8, 8);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,0.8)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.context.fillStyle = g;
      c.context.fillRect(0, 0, 16, 16);
      c.refresh();
      c.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    if (!tex.exists("amb-drop")) {
      const c = tex.createCanvas("amb-drop", 4, 10)!;
      c.context.fillStyle = "#fff";
      c.context.fillRect(1, 0, 2, 10);
      c.refresh();
    }
    if (!tex.exists("amb-leaf")) {
      const c = tex.createCanvas("amb-leaf", 8, 6)!;
      c.context.fillStyle = "#fff";
      c.context.beginPath();
      c.context.ellipse(4, 3, 4, 2, 0.5, 0, Math.PI * 2);
      c.context.fill();
      c.refresh();
    }
    if (!tex.exists("amb-streak")) {
      const c = tex.createCanvas("amb-streak", 32, 2)!;
      const g = c.context.createLinearGradient(0, 0, 32, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.context.fillStyle = g;
      c.context.fillRect(0, 0, 32, 2);
      c.refresh();
      c.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
  }

  // ---------------------------------------------------------------- particles

  private emitter(x: number, y: number, key: string, config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const e = this.scene.add.particles(x, y, key, config).setDepth(depth);
    this.emitters.push(e);
    return e;
  }

  /** The inner floor area of a room in world pixels. */
  private area(room: PlacedRoom): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle((room.x + 1) * TILE, (room.y + 1) * TILE, Math.max(1, room.w - 2) * TILE, Math.max(1, room.h - 2) * TILE);
  }

  private roomParticles(room: PlacedRoom): void {
    const map = this.map;
    const night = !!map.dark;
    const zone = this.area(room);
    const squares = Math.max(4, (room.w - 2) * (room.h - 2));
    const every = (perSquare: number) => Math.max(40, Math.round(perSquare / squares));
    const random = { type: "random" as const, source: zone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource };
    const theme = room.theme;
    const dusty = ["castle", "throne", "stone", "church", "crypt", "tavern", "mine", "cave", "town"].includes(theme);

    if (dusty) {
      // Dust floating in the air (visible where the light falls).
      this.emitter(0, 0, "amb-dot", { emitZone: random, lifespan: 7000, frequency: every(40000), speedX: { min: -3, max: 3 }, speedY: { min: -4, max: 2 }, scale: { min: 0.06, max: 0.12 }, alpha: { start: 0, end: 0, ease: "Sine.easeInOut", onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.45 }, tint: 0xe8dcc0 }, DEPTH_AIR);
    }
    if (theme === "cave" || theme === "mine") {
      // Water dripping from the ceiling.
      this.emitter(0, 0, "amb-drop", { emitZone: random, lifespan: 600, frequency: every(160000), speedY: { min: 20, max: 30 }, gravityY: 120, scaleX: 0.5, scaleY: { start: 0.4, end: 0.8 }, alpha: { start: 0.8, end: 0 }, tint: 0x9fd0ff }, DEPTH_AIR);
    }
    if (theme === "lair") {
      // Embers rising from the hot floor.
      this.emitter(0, 0, "amb-dot", { emitZone: random, lifespan: 3200, frequency: every(12000), speedX: { min: -6, max: 6 }, speedY: { min: -26, max: -10 }, scale: { start: 0.14, end: 0.02 }, alpha: { start: 0.9, end: 0 }, tint: [0xff8a2a, 0xffc04a, 0xff5a1a], blendMode: Phaser.BlendModes.ADD }, DEPTH_AIR);
    }
    if (theme === "crypt") {
      // Pale wisps drifting over the graves.
      this.emitter(0, 0, "amb-dot", { emitZone: random, lifespan: 6000, frequency: every(180000), speedX: { min: -5, max: 5 }, speedY: { min: -6, max: -1 }, scale: { start: 0.5, end: 1.2 }, alpha: { start: 0, end: 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.18 }, tint: 0x9dffc8, blendMode: Phaser.BlendModes.ADD }, DEPTH_AIR);
    }
    if (room.moduleId === "hexentanzplatz") {
      // Green witch fire sparks: they glow in the dark.
      this.emitter(0, 0, "amb-dot", { emitZone: random, lifespan: 2600, frequency: every(10000), speedX: { min: -8, max: 8 }, speedY: { min: -40, max: -15 }, scale: { start: 0.2, end: 0.02 }, alpha: { start: 1, end: 0 }, tint: [0x6aff5a, 0xb8ff6a, 0x3fd9a0], blendMode: Phaser.BlendModes.ADD }, DEPTH_GLOW);
    }
    const green = theme === "forest" || theme === "meadow" || theme === "village" || theme === "peak";
    if (green && night) {
      // Fireflies: they blink in the dark.
      this.emitter(0, 0, "amb-dot", {
        emitZone: random,
        lifespan: 6000,
        frequency: every(30000),
        speedX: { min: -9, max: 9 },
        speedY: { min: -9, max: 9 },
        scale: { min: 0.1, max: 0.18 },
        alpha: { start: 0, end: 0, onUpdate: (p, _k, t) => Math.max(0, Math.sin(t * Math.PI)) * (0.55 + 0.45 * Math.sin(t * 40 + (p.x % 7))) },
        tint: [0xd8ff6a, 0xfff07a],
        blendMode: Phaser.BlendModes.ADD,
      }, DEPTH_GLOW);
    } else if (theme === "forest" || theme === "meadow") {
      // Pollen in the sun and a few falling leaves.
      this.emitter(0, 0, "amb-dot", { emitZone: random, lifespan: 8000, frequency: every(50000), speedX: { min: 4, max: 12 }, speedY: { min: -3, max: 3 }, scale: { min: 0.05, max: 0.09 }, alpha: { start: 0, end: 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.6 }, tint: 0xfff6c0 }, DEPTH_AIR);
      if (theme === "forest") {
        this.emitter(0, 0, "amb-leaf", { emitZone: random, lifespan: 5000, frequency: every(160000), speedX: { min: 8, max: 20 }, speedY: { min: 4, max: 12 }, rotate: { start: 0, end: 360 }, scale: { min: 0.6, max: 0.9 }, alpha: { start: 0.9, end: 0 }, tint: [0x7fa83a, 0xc98a2a, 0xa8b83a] }, DEPTH_AIR);
      }
    }
    if (theme === "peak") {
      // Wind over the bare summit.
      this.emitter(0, 0, "amb-streak", { emitZone: random, lifespan: 1400, frequency: every(60000), speedX: { min: 50, max: 90 }, speedY: { min: -4, max: 4 }, scaleX: { min: 0.8, max: 1.6 }, alpha: { start: 0, end: 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.22 }, tint: 0xdfe8ff }, DEPTH_AIR);
    }

    // Glints on water.
    const water: GridPos[] = [];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const c = map.cells[cellIndex(map, x, y)];
        if (c === "water" || c === "deep") water.push({ x, y });
      }
    }
    if (water.length) {
      const source = { getRandomPoint: (p: Phaser.Types.Math.Vector2Like) => {
        const w = pick(water);
        p.x = (w.x + Math.random()) * TILE;
        p.y = (w.y + Math.random()) * TILE;
        return p;
      } } as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource;
      this.emitter(0, 0, "amb-dot", { emitZone: { type: "random", source }, lifespan: 700, frequency: Math.max(60, Math.round(9000 / water.length)), scale: { start: 0.02, end: 0.14 }, alpha: { start: 0.9, end: 0 }, tint: 0xffffff, blendMode: Phaser.BlendModes.ADD }, DEPTH_AIR);
    }
  }

  /** Sparks rising from wall torches and camp fires. */
  torchSparks(x: number, y: number): void {
    this.emitter(x * TILE, y * TILE, "amb-dot", { lifespan: 900, frequency: rand(500, 900), speedX: { min: -5, max: 5 }, speedY: { min: -30, max: -14 }, scale: { start: 0.1, end: 0.02 }, alpha: { start: 1, end: 0 }, tint: [0xffb040, 0xffe080], blendMode: Phaser.BlendModes.ADD }, DEPTH_AIR);
  }

  /** Smoke over a fire (camp fire, cauldron). */
  smoke(x: number, y: number, tint = 0x9a9590): void {
    this.emitter(x * TILE, y * TILE, "amb-dot", { lifespan: 3000, frequency: 350, speedX: { min: -3, max: 6 }, speedY: { min: -18, max: -10 }, scale: { start: 0.3, end: 1.3 }, alpha: { start: 0.35, end: 0 }, tint }, DEPTH_AIR);
  }

  /** A short puff of dust (a door opens, a barrel breaks, something falls). */
  puff(x: number, y: number, tint = 0xcfc3a8, count = 14): void {
    const e = this.scene.add.particles(x * TILE, y * TILE, "amb-dot", { lifespan: 900, speed: { min: 10, max: 45 }, scale: { start: 0.35, end: 0.9 }, alpha: { start: 0.55, end: 0 }, tint, emitting: false }).setDepth(DEPTH_AIR);
    e.explode(count);
    this.scene.time.delayedCall(1200, () => e.destroy());
  }

  /** Golden glitter (a find, a blessing). */
  sparkle(x: number, y: number): void {
    const e = this.scene.add.particles(x * TILE, y * TILE, "amb-dot", { lifespan: 1100, speed: { min: 8, max: 40 }, gravityY: -10, scale: { start: 0.25, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffe070, 0xfff6c0, 0xffb830], blendMode: Phaser.BlendModes.ADD, emitting: false }).setDepth(DEPTH_GLOW);
    e.explode(24);
    this.scene.time.delayedCall(1400, () => e.destroy());
  }

  /** Water splashing up. */
  splash(x: number, y: number): void {
    const e = this.scene.add.particles(x * TILE, y * TILE, "amb-drop", { lifespan: 700, speed: { min: 20, max: 60 }, angle: { min: 200, max: 340 }, gravityY: 160, scaleX: 0.6, scaleY: 0.6, alpha: { start: 0.9, end: 0 }, tint: 0xbfe6ff, emitting: false }).setDepth(DEPTH_AIR);
    e.explode(18);
    this.scene.time.delayedCall(900, () => e.destroy());
  }

  // ---------------------------------------------------------------- critters

  private walkable(p: GridPos): boolean {
    const map = this.map;
    if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return false;
    if (map.cells[cellIndex(map, p.x, p.y)] !== "floor") return false;
    return !map.objects.some((o) => o.blocking && o.x === p.x && o.y === p.y && o.state !== "open");
  }

  private occupied(p: GridPos): boolean {
    return Object.values(this.getSession().battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y) || this.critters.some((k) => !k.gone && k.cell.x === p.x && k.cell.y === p.y);
  }

  private floorCells(room: PlacedRoom): GridPos[] {
    const out: GridPos[] = [];
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) for (let x = room.x + 1; x < room.x + room.w - 1; x++) if (this.walkable({ x, y })) out.push({ x, y });
    return out;
  }

  private spawnCritters(room: PlacedRoom): void {
    const list = HABITAT[room.theme][this.map.dark ? "night" : "day"];
    const cells = this.floorCells(room);
    const water = cells.some((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ["water", "deep"].includes(this.map.cells[cellIndex(this.map, c.x + dx!, c.y + dy!)] ?? "")));
    for (const [kind, max] of list) {
      if (kind === "frog" && !water) continue;
      // Not every room is full of animals: a random share of the maximum.
      const count = Math.round(rand(0.3, 1) * max);
      for (let i = 0; i < count; i++) {
        const free = cells.filter((c) => !this.occupied(c) && !this.heroNear(c, 3));
        if (!free.length) return;
        this.addCritter(kind, room, pick(free));
      }
    }
  }

  private addCritter(kind: CritterKind, room: PlacedRoom, cell: GridPos): void {
    const style = CRITTERS[kind];
    const img = this.tile((cell.x + 0.5) * TILE, (cell.y + 0.6) * TILE, pick(style.frames));
    img.setScale(img.scaleX * style.scale).setAlpha(0);
    img.setDepth(style.flies ? DEPTH_AIR : 100 + cell.y * 10 + 3);
    this.scene.tweens.add({ targets: img, alpha: 1, duration: 800 });
    const c: Critter = { kind, style, img, room, cell, busyUntil: this.scene.time.now + rand(500, 3000) };
    this.critters.push(c);
    if (style.flies) this.flutter(c);
  }

  /** Flying animals flap their wings all the time. */
  private flutter(c: Critter): void {
    this.scene.tweens.add({ targets: c.img, scaleY: c.img.scaleY * 0.7, duration: rand(110, 200), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  private heroes(): Creature[] {
    const s = this.getSession();
    return s.partyIds.map((id) => s.battle.creatures[id]).filter((c): c is Creature => !!c?.pos && !c.dead);
  }

  private heroNear(p: GridPos, radius: number): Creature | undefined {
    return this.heroes().find((h) => Math.hypot(h.pos!.x - p.x, h.pos!.y - p.y) <= radius);
  }

  private moveTo(c: Critter, to: GridPos, fast = false): void {
    const dx = to.x - c.cell.x;
    const steps = Math.max(1, Math.hypot(dx, to.y - c.cell.y));
    const duration = steps * c.style.pace * (fast ? 0.55 : 1);
    // The DCSS animals look to the left.
    if (dx !== 0) c.img.setFlipX(dx > 0);
    c.cell = to;
    this.scene.tweens.add({ targets: c.img, x: (to.x + 0.5) * TILE, duration, ease: c.style.flies ? "Sine.easeInOut" : "Linear" });
    this.scene.tweens.add({
      targets: c.img,
      y: (to.y + (c.style.flies ? 0.3 : 0.6)) * TILE,
      duration,
      ease: c.style.flies ? "Sine.easeInOut" : "Linear",
      onUpdate: () => {
        if (!c.style.flies) c.img.setDepth(100 + Math.floor(c.img.y / TILE) * 10 + 3);
      },
    });
    c.busyUntil = this.scene.time.now + duration + (fast ? 100 : rand(800, 3500));
  }

  /** Leaves the room and disappears (fled or flew off); another one may come later. */
  private vanish(c: Critter): void {
    c.gone = true;
    this.scene.tweens.add({ targets: c.img, alpha: 0, duration: 600, onComplete: () => c.img.destroy() });
  }

  private stepCritter(c: Critter, now: number): void {
    if (c.gone || now < c.busyUntil) return;
    const cells = c.style.flies ? this.floorCells(c.room).concat(this.floorCells(c.room)) : this.floorCells(c.room);
    const threat = c.style.shy > 0 ? this.heroNear(c.cell, c.style.shy) : undefined;
    if (this.combat && c.style.shy > 0) {
      // Fights scare every animal away.
      const far = cells.filter((p) => !this.occupied(p)).sort((a, b) => Math.hypot(b.x - c.cell.x, b.y - c.cell.y) - Math.hypot(a.x - c.cell.x, a.y - c.cell.y))[0];
      if (far) this.moveTo(c, far, true);
      this.scene.time.delayedCall(700, () => this.vanish(c));
      return;
    }
    if (threat) {
      // Run to the free spot farthest away from that hero.
      const far = cells
        .filter((p) => !this.occupied(p) && Math.hypot(p.x - c.cell.x, p.y - c.cell.y) <= 6)
        .sort((a, b) => Math.hypot(b.x - threat.pos!.x, b.y - threat.pos!.y) - Math.hypot(a.x - threat.pos!.x, a.y - threat.pos!.y))[0];
      if (far && Math.hypot(far.x - threat.pos!.x, far.y - threat.pos!.y) > c.style.shy) this.moveTo(c, far, true);
      else if (c.style.flies || c.kind === "rat") this.vanish(c);
      return;
    }
    if (c.style.friendly) {
      // Dogs trot after the nearest hero, but not too close.
      const h = this.heroes().sort((a, b) => Math.hypot(a.pos!.x - c.cell.x, a.pos!.y - c.cell.y) - Math.hypot(b.pos!.x - c.cell.x, b.pos!.y - c.cell.y))[0];
      if (h && Math.hypot(h.pos!.x - c.cell.x, h.pos!.y - c.cell.y) > 2.5 && Math.hypot(h.pos!.x - c.cell.x, h.pos!.y - c.cell.y) < 9) {
        const near = cells.filter((p) => !this.occupied(p)).sort((a, b) => Math.abs(Math.hypot(a.x - h.pos!.x, a.y - h.pos!.y) - 1.8) - Math.abs(Math.hypot(b.x - h.pos!.x, b.y - h.pos!.y) - 1.8))[0];
        if (near) {
          this.moveTo(c, near);
          return;
        }
      }
    }
    // Wander a little.
    const range = c.style.flies ? 3 : 2;
    const options = cells.filter((p) => !this.occupied(p) && Math.abs(p.x - c.cell.x) <= range && Math.abs(p.y - c.cell.y) <= range && (p.x !== c.cell.x || p.y !== c.cell.y));
    if (options.length && Math.random() < 0.7) this.moveTo(c, pick(options));
    else c.busyUntil = now + rand(1000, 3000);
  }

  setCombat(on: boolean): void {
    this.combat = on;
  }

  // ---------------------------------------------------------------- loop

  update(time: number): void {
    const map = this.map;
    if (time - this.lastCheck > 600) {
      this.lastCheck = time;
      map.rooms.forEach((room, i) => {
        if (this.active.has(i)) return;
        // A room comes alive once the heroes have seen its middle.
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        if (!map.explored[cellIndex(map, cx, cy)]) return;
        this.active.add(i);
        this.roomParticles(room);
        if (!this.combat) this.spawnCritters(room);
      });
      this.critters = this.critters.filter((c) => !c.gone || c.img.active);
    }
    if (time - this.lastCritters > 250) {
      this.lastCritters = time;
      for (const c of this.critters) this.stepCritter(c, time);
    }
  }
}
