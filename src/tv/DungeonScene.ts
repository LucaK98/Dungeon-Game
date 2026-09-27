/**
 * The game board on the TV: dungeon, figures, torches, fog of war and light.
 */
import Phaser from "phaser";
import { sizeInSquares } from "../engine/combat";
import { dollFrames } from "../shared/doll";
import type { Creature } from "../shared/game";
import { cellIndex, type DungeonMap, type MapObject } from "../shared/map";
import { THEMES } from "../map/modules";
import { propLight } from "../map/props";
import { assetUrl } from "../ui/atlas";
import { Ambience } from "./ambience";
import { CombatFx } from "./combat-fx";
import type { ActionFx } from "../shared/view";
import { crisp, prepareTiles, RES, TILES, UP } from "./render";
import type { GameSession } from "./session";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;
const TILE = 32;
/** Board zoom: small maps fill the screen, big ones scroll with the heroes. */
const MIN_ZOOM = 2.5;
const MAX_ZOOM = 3.4;
/** The right column of the TV belongs to the "Was ist passiert?" log. */
export const LOG_PANEL = 470;
/** In combat the initiative bar takes the left edge. */
export const ORDER_PANEL = 340;

/** Darkness per cell: unexplored = black, indoor = dim, outdoor (daylight) = almost clear. */
const DARK_INDOOR = 0.72;
const DARK_OUTDOOR = 0.1;
/** Night scenes: almost black outside the light. */
const DARK_NIGHT = 0.97;
/** Light circle (in squares) of a hero at night: torch, darkvision (dim), nothing. */
const NIGHT_TORCH = 6.5;
/** Darkvision: a wide but only half-cleared circle (grey sight). */
const NIGHT_DARKVISION = 7;
const NIGHT_NONE = 1.4;
const HERO_LIGHT = 5.5;
const TORCH_LIGHT = 3.5;

interface Figure {
  container: Phaser.GameObjects.Container;
  /** The sprites: breathes, turns around and hops, independent of the ring and HP bar. */
  body: Phaser.GameObjects.Container;
  hpBar?: Phaser.GameObjects.Graphics;
  /** 💤 or 👀 over enemies that have not noticed the heroes yet. */
  mood?: Phaser.GameObjects.Text;
  /** Look and magic weapon when drawn: a change rebuilds the figure. */
  lookKey?: string;
  glow?: Phaser.GameObjects.Image;
  /** 🛡️ while standing in cover (in fights). */
  shield?: Phaser.GameObjects.Text;
  /** Last square, to face the walking direction. */
  lastX?: number;
}

/** What a figure looks like (to notice new equipment). */
function lookKey(c: Creature): string {
  return JSON.stringify([c.appearance?.look ?? null, c.pc?.gear?.weapon ?? null, c.effects.some((e) => e.id === "wild-shape")]);
}

export class DungeonScene extends Phaser.Scene {
  private session!: GameSession;
  private figures = new Map<string, Figure>();
  private torches: { sprite: Phaser.GameObjects.Image; x: number; y: number; phase: number }[] = [];
  /** Camp fires and cauldrons: light without a torch sprite. */
  private fires: { x: number; y: number; phase: number }[] = [];
  private objectImages = new Map<string, Phaser.GameObjects.Image>();
  /** Floor decoration (moss, blood, scorch marks …) and puddles, oil, ice and fire, by cell. */
  private decalImages = new Map<number, Phaser.GameObjects.Image>();
  private surfaceImages = new Map<number, { img: Phaser.GameObjects.Image; kind: string }>();
  /** Coloured glows (torches, braziers, candles, mushrooms, fire), by key. */
  private glows = new Map<string, { img: Phaser.GameObjects.Image; x: number; y: number; radius: number; phase: number; strength: number }>();
  private bubbles = new Map<string, Phaser.GameObjects.Container>();
  private fogCanvas!: Phaser.Textures.CanvasTexture;
  private unexploredCanvas!: Phaser.Textures.CanvasTexture;
  private dark!: Phaser.GameObjects.RenderTexture;
  private fogImage!: Phaser.GameObjects.Image;
  private unexploredImage!: Phaser.GameObjects.Image;
  private lightBrush!: Phaser.GameObjects.Image;
  private camTarget = new Phaser.Math.Vector2();
  private lastLight = 0;
  private fogDirty = true;
  private ambience!: Ambience;
  private combatFx!: CombatFx;
  /** A boss entrance: the camera looks at it until then. */
  private spotlightUntil = 0;
  private lastLook = 0;

  constructor(private getSession: () => GameSession) {
    super("dungeon");
  }

  preload(): void {
    // Loaded once; the scene restarts for every new map.
    if (!this.textures.exists("tiles")) this.load.atlas("tiles", assetUrl("atlas.png"), assetUrl("atlas.json"));
  }

  create(): void {
    this.session = this.getSession();
    const map = this.session.map;
    this.figures.clear();
    this.torches = [];
    this.fires = [];
    this.objectImages.clear();
    this.decalImages.clear();
    this.surfaceImages.clear();
    this.glows.clear();
    this.bubbles.clear();
    prepareTiles(this);

    this.ambience = new Ambience(this, () => this.session, (x, y, frame) => this.tile(x, y, frame));
    this.ambience.start();
    this.combatFx = new CombatFx(this, (id) => {
      const f = this.figures.get(id);
      const c = this.session.battle.creatures[id];
      if (f) return { pos: { x: f.container.x, y: f.container.y }, body: f.body };
      return c?.pos ? { pos: { x: (c.pos.x + 0.5) * TILE, y: (c.pos.y + 0.5) * TILE } } : undefined;
    });
    this.bakeMap(map);
    this.drawObjects(map);
    for (const t of this.torches) this.ambience.torchSparks(t.x, t.y - 0.6);
    for (const c of Object.values(this.session.battle.creatures)) this.addFigure(c);
    this.createLighting(map);
    // Needs the light texture from createLighting.
    this.syncGround();

    const cam = this.cameras.main;
    // Rounding each tile to whole pixels leaves a thin seam through the middle of the screen at odd zooms.
    cam.roundPixels = false;
    this.layout();
    cam.setBackgroundColor("#000000");
    this.focusParty(true);

    this.showRoomName(map.rooms[0]!.name);
  }

  showRoomName(name: string): void {
    this.game.events.emit("room-name", name);
  }

  // ---------------------------------------------------------------- map

  /** Tile image in world units (the texture may be upscaled). */
  private tile(x: number, y: number, frame: string): Phaser.GameObjects.Image {
    return this.add.image(x, y, TILES, frame).setScale(1 / UP);
  }

  private bakeMap(map: DungeonMap): void {
    // A blitter draws thousands of static tiles cheaply; the container scales the upscaled art back to world units.
    const blitter = this.add.blitter(0, 0, TILES);
    this.add.container(0, 0, [blitter]).setScale(1 / UP).setDepth(0);
    const s = TILE * UP;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = cellIndex(map, x, y);
        const frame = map.frames[i];
        if (!frame) continue;
        // Forest "walls" are trees standing on grass.
        blitter.create(x * s, y * s, frame);
        const overlay = map.overlays[i];
        if (overlay && !overlay.startsWith("torch")) blitter.create(x * s, y * s, overlay);
      }
    }

    this.wallShadows(map);

    for (const [key, overlay] of Object.entries(map.overlays)) {
      if (!overlay.startsWith("torch")) continue;
      const i = Number(key);
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      const sprite = this.tile(x * TILE, y * TILE, "torch.1").setOrigin(0).setDepth(1);
      this.torches.push({ sprite, x: x + 0.5, y: y + 0.9, phase: Math.random() * 10 });
    }
  }

  /** Soft shadows on the floor under walls (from above) and beside them (from the left): the rooms get depth. */
  private wallShadows(map: DungeonMap): void {
    const g = this.add.graphics().setDepth(0.5);
    const wallAt = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.cells[cellIndex(map, x, y)] === "wall";
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const c = map.cells[cellIndex(map, x, y)];
        if (c !== "floor" && c !== "water") continue;
        if (wallAt(x, y - 1)) {
          [0.32, 0.2, 0.11, 0.05].forEach((a, k) => g.fillStyle(0x000000, a).fillRect(x * TILE, y * TILE + k * 3, TILE, 3));
        }
        if (wallAt(x - 1, y)) {
          [0.2, 0.1, 0.04].forEach((a, k) => g.fillStyle(0x000000, a).fillRect(x * TILE + k * 2, y * TILE, 2, TILE));
        }
      }
    }
  }

  /** Decals and surfaces (puddles, oil, ice, fire): drawn on the floor, updated after every change. */
  private syncGround(): void {
    const map = this.session.map;
    const decals = map.decals ?? {};
    for (const [i, img] of this.decalImages) {
      if (decals[i] === img.frame.name) continue;
      img.destroy();
      this.decalImages.delete(i);
    }
    for (const [key, frame] of Object.entries(decals)) {
      const i = Number(key);
      if (this.decalImages.has(i) || !this.textures.get(TILES).has(frame)) continue;
      const img = this.tile((i % map.width) * TILE, Math.floor(i / map.width) * TILE, frame).setOrigin(0).setDepth(frame === "rug" ? 0.4 : 0.8);
      // Blood and scorch marks appear with a little fade.
      if (frame.startsWith("blood") || frame === "scorch" || frame === "debris") {
        img.setAlpha(0);
        this.tweens.add({ targets: img, alpha: frame === "scorch" ? 0.9 : 0.8, duration: 900 });
      } else if (frame.startsWith("moss") || frame.startsWith("crack")) img.setAlpha(0.75);
      this.decalImages.set(i, img);
    }
    const surface = map.surface ?? {};
    for (const [i, s] of this.surfaceImages) {
      if (surface[i]?.kind === s.kind) continue;
      const img = s.img;
      this.surfaceImages.delete(i);
      this.tweens.add({ targets: img, alpha: 0, duration: 600, onComplete: () => img.destroy() });
    }
    for (const [key, s] of Object.entries(surface)) {
      const i = Number(key);
      if (this.surfaceImages.has(i)) continue;
      const x = (i % map.width) * TILE;
      const y = Math.floor(i / map.width) * TILE;
      const frame = s.kind === "fire" ? "fire.0" : s.kind;
      const img = this.tile(x, y, frame).setOrigin(0).setDepth(s.kind === "fire" ? 100 + Math.floor(i / map.width) * 10 + 6 : 0.9);
      img.setAlpha(0);
      this.tweens.add({ targets: img, alpha: s.kind === "fire" ? 0.95 : 0.85, duration: 500 });
      if (s.kind === "puddle" || s.kind === "ice") this.tweens.add({ targets: img, alpha: 0.65, duration: 1800 + Math.random() * 800, yoyo: true, repeat: -1, delay: 600, ease: "Sine.easeInOut" });
      if (s.kind === "fire") {
        this.ambience.puff(x / TILE + 0.5, y / TILE + 0.5, 0x3a3430, 8);
        this.shake(false);
      }
      this.surfaceImages.set(i, { img, kind: s.kind });
    }
    this.syncGlows();
  }

  /** Coloured light: warm torches and braziers, flickering candles, green mushrooms, burning floors. */
  private syncGlows(): void {
    const map = this.session.map;
    const want = new Map<string, { x: number; y: number; color: number; radius: number; strength: number }>();
    this.torches.forEach((t, k) => want.set(`t${k}`, { x: t.x, y: t.y - 0.3, color: 0xff9a3a, radius: 1.9, strength: 0.26 }));
    for (const o of map.objects) {
      if (o.kind === "campfire") want.set(o.id, { x: o.x + 0.5, y: o.y + 0.5, color: 0xff8a2a, radius: 3.2, strength: 0.4 });
      else if (o.kind === "cauldron") want.set(o.id, { x: o.x + 0.5, y: o.y + 0.5, color: 0x7fff6a, radius: 2.2, strength: 0.3 });
      const light = propLight(o);
      if (light) want.set(o.id, { x: o.x + 0.5, y: o.y + 0.4, color: light.color, radius: light.radius, strength: 0.34 });
    }
    for (const [key, s] of Object.entries(map.surface ?? {})) {
      if (s.kind !== "fire") continue;
      const i = Number(key);
      want.set(`f${i}`, { x: (i % map.width) + 0.5, y: Math.floor(i / map.width) + 0.5, color: 0xff7a1a, radius: 2, strength: 0.45 });
    }
    for (const [key, g] of this.glows) {
      if (want.has(key)) continue;
      this.glows.delete(key);
      this.tweens.add({ targets: g.img, alpha: 0, duration: 500, onComplete: () => g.img.destroy() });
    }
    for (const [key, w] of want) {
      if (this.glows.has(key)) continue;
      const img = this.add.image(w.x * TILE, w.y * TILE, "light").setTint(w.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(5002);
      img.setScale((w.radius * 2 * TILE) / 256).setAlpha(0);
      this.glows.set(key, { img, x: w.x, y: w.y, radius: w.radius, phase: Math.random() * 10, strength: w.strength });
    }
  }

  private drawObjects(map: DungeonMap): void {
    for (const o of map.objects) {
      if (o.kind === "campfire" || o.kind === "cauldron") {
        this.fires.push({ x: o.x + 0.5, y: o.y + 0.5, phase: Math.random() * 10 });
        if (o.kind === "campfire") this.ambience.torchSparks(o.x + 0.5, o.y + 0.4);
        this.ambience.smoke(o.x + 0.5, o.y + 0.2, o.kind === "cauldron" ? 0x7fd06a : 0x9a9590);
      }
      this.syncObject(o);
    }
  }

  /** Draws an object or updates it after it changed (opened, used, found). */
  private syncObject(o: MapObject): void {
    let img = this.objectImages.get(o.id);
    // Hidden traps stay invisible; secrets show only as a faint hint.
    const visible = !!o.frame && !(o.kind === "trap" && o.state === "hidden");
    if (!visible) {
      if (img) {
        this.objectImages.delete(o.id);
        img.destroy();
      }
      return;
    }
    if (!img) {
      img = this.tile(o.x * TILE, o.y * TILE, o.frame).setOrigin(0);
      this.objectImages.set(o.id, img);
    } else if (img.frame.name !== o.frame) {
      img.setFrame(o.frame);
      this.tweens.add({ targets: img, scaleX: img.scaleX * 1.15, scaleY: img.scaleY * 1.15, duration: 120, yoyo: true });
    }
    // Tall objects (trees, statues) are sorted with the figures; the chandelier hangs above everyone.
    const hanging = o.kind === "chandelier" && o.state !== "used";
    // Plants and ledges are sorted with the figures too (a hero stands in the bush, on the rock).
    const upright = o.blocking || (o.kind === "prop" && ["bush", "thorns", "herbs", "stump", "stool", "hay", "mushrooms", "mushrooms-glow"].includes(o.prop ?? ""));
    img.setDepth(hanging ? 4400 : o.kind === "prop" && (o.prop === "stage" || o.prop === "rock-ledge" || o.prop === "web" || o.prop === "rubble") ? 3 : upright ? 100 + o.y * 10 + (o.blocking ? 0 : 1) : 2);
    img.setAlpha(o.kind === "secret" ? (o.state === "hidden" ? 0.5 : 1) : 1);
  }

  // ---------------------------------------------------------------- figures

  private addFigure(c: Creature): void {
    if (!c.pos || c.dead) return;
    const n = sizeInSquares(c.size);
    const container = this.add.container(0, 0);
    const ring = this.add.graphics();
    const color = c.appearance ? Phaser.Display.Color.HexStringToColor(c.appearance.color).color : 0x000000;
    ring.fillStyle(0x000000, 0.35).fillEllipse(0, 11, 26, 9);
    if (c.appearance) ring.lineStyle(2, color, 1).strokeEllipse(0, 11, 26, 9);
    container.add(ring);
    // The body's origin is at the feet, so breathing stretches it upwards.
    const body = this.add.container(0, 12);
    container.add(body);
    if (c.effects.some((e) => e.id === "wild-shape")) {
      // A druid in wolf shape.
      body.add(this.tile(0, -12, "monster.wolf"));
    } else if (c.appearance) {
      // No name labels: the coloured ring shows whose figure it is.
      for (const frame of dollFrames(c.appearance.look)) body.add(this.tile(0, -12, frame));
    } else if (c.monsterId) {
      body.add(this.tile(0, -12, `monster.${c.monsterId}`));
    }
    container.setScale(n);
    // Idle: everyone breathes, each at their own pace.
    this.tweens.add({ targets: body, scaleY: 1.035, scaleX: 0.99, duration: Phaser.Math.Between(1100, 1600), yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: Phaser.Math.Between(0, 1200) });
    const figure: Figure = { container, body, lastX: c.pos.x, lookKey: lookKey(c) };
    // A magic weapon shimmers.
    if (c.pc?.gear?.weapon) {
      const glow = this.add.image(7, -2, "amb-dot").setTint(0x8fd8ff).setBlendMode(Phaser.BlendModes.ADD).setScale(0.9).setAlpha(0.5);
      body.add(glow);
      this.tweens.add({ targets: glow, alpha: 0.15, scale: 1.3, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      figure.glow = glow;
    }
    if (c.kind === "monster") {
      figure.hpBar = this.add.graphics();
      container.add(figure.hpBar);
    }
    this.figures.set(c.id, figure);
    this.placeFigure(c);
  }

  placeFigure(c: Creature, animate = false): void {
    const f = this.figures.get(c.id);
    if (!f || !c.pos) return;
    const n = sizeInSquares(c.size);
    const x = (c.pos.x + n / 2) * TILE;
    const y = (c.pos.y + n / 2) * TILE;
    f.container.setDepth(100 + (c.pos.y + n - 1) * 10 + 5);
    const moved = Math.abs(f.container.x - x) > 1 || Math.abs(f.container.y - y) > 1;
    if (animate && moved) {
      this.tweens.add({ targets: f.container, x, y, duration: 220, ease: "Sine.easeInOut" });
      // A little hop per step, facing the way it walks.
      this.tweens.add({ targets: f.body, y: 9, duration: 110, yoyo: true, ease: "Quad.easeOut" });
      if (f.lastX !== undefined && c.pos.x !== f.lastX) this.face(f, c.pos.x > f.lastX ? 1 : -1, c);
    } else if (!animate) f.container.setPosition(x, y);
    f.lastX = c.pos.x;
    this.showMood(f, c);
    this.showShield(f, c);
    if (f.hpBar) {
      f.hpBar.clear();
      if (c.hp < c.maxHp) {
        f.hpBar.fillStyle(0x000000, 0.7).fillRect(-12, -19, 24, 4);
        f.hpBar.fillStyle(c.hp / c.maxHp > 0.5 ? 0x5bd15b : c.hp / c.maxHp > 0.25 ? 0xe0c040 : 0xe04040, 1).fillRect(-11, -18, (22 * c.hp) / c.maxHp, 2);
      }
    }
  }

  /** Called by the host after the state changed. */
  refresh(): void {
    // Creatures that left the game (fled, or an NPC that turned into an enemy) simply fade out.
    for (const [id, f] of this.figures) {
      if (this.session.battle.creatures[id]) continue;
      this.figures.delete(id);
      this.tweens.add({ targets: f.container, alpha: 0, duration: 600, onComplete: () => f.container.destroy() });
    }
    for (const c of Object.values(this.session.battle.creatures)) {
      const f = this.figures.get(c.id);
      if (c.dead && f) {
        // Defeated: sink and fade away.
        this.figures.delete(c.id);
        this.tweens.add({ targets: f.container, alpha: 0, angle: 80, y: f.container.y + 8, duration: 700, delay: 700, onComplete: () => f.container.destroy() });
      } else if (!f && !c.dead) this.addFigure(c);
      else if (f && f.lookKey !== lookKey(c)) {
        // New equipment: rebuild the figure where it stands.
        f.container.destroy();
        this.figures.delete(c.id);
        this.addFigure(c);
        this.ambience.sparkle((c.pos?.x ?? 0) + 0.5, (c.pos?.y ?? 0) + 0.5);
      } else if (f) {
        this.placeFigure(c, true);
        // Unconscious heroes lie on the ground.
        f.container.setAngle(c.hp === 0 && c.kind === "pc" ? 90 : 0).setAlpha(c.hp === 0 ? 0.7 : 1);
      }
    }
    for (const o of this.session.map.objects) this.syncObject(o);
    this.syncGround();
    this.fogDirty = true;
    if (this.time.now > this.spotlightUntil) this.focusParty(false);
  }

  /** Floating damage/heal numbers and a red flash on hit targets. */
  showHits(hits: { targetId: string; amount: number; heal?: boolean; crit?: boolean; miss?: boolean }[]): void {
    hits.forEach((hit, i) => {
      const c = this.session.battle.creatures[hit.targetId];
      const f = this.figures.get(hit.targetId);
      const pos = f ? { x: f.container.x, y: f.container.y } : c?.pos ? { x: (c.pos.x + 0.5) * TILE, y: (c.pos.y + 0.5) * TILE } : undefined;
      if (!pos) return;
      const text = hit.miss ? "Daneben" : hit.heal ? `+${hit.amount}` : hit.crit ? `${hit.amount}!` : String(hit.amount);
      const color = hit.miss ? "#cfcfcf" : hit.heal ? "#6dff7a" : hit.crit ? "#ffd700" : "#ff5a4a";
      const label = this.add
        .text(pos.x, pos.y - 18, text, crisp({ fontFamily: "system-ui, sans-serif", fontSize: hit.crit ? "44px" : "32px", fontStyle: "bold", color, stroke: "#000", strokeThickness: 6 }))
        .setOrigin(0.5)
        .setScale(0.5)
        .setDepth(6000);
      this.tweens.add({ targets: label, y: pos.y - 52, alpha: 0, delay: 250 + i * 120, duration: 1300, ease: "Cubic.easeOut", onComplete: () => label.destroy() });
      if (f && !hit.miss && !hit.heal) {
        const images = f.body.list.filter((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image);
        images.forEach((img) => img.setTintFill(0xff3030));
        this.tweens.add({ targets: f.container, x: pos.x + 3, duration: 50, yoyo: true, repeat: 2 });
        this.time.delayedCall(160, () => images.forEach((img) => img.clearTint()));
      }
    });
  }

  /** "+25 💰" or "+1 🧪" rises from a hero (a coin chime from the board goes with it). */
  showGain(id: string, text: string, color = "#ffd75e"): void {
    const c = this.session.battle.creatures[id];
    const f = this.figures.get(id);
    const pos = f ? { x: f.container.x, y: f.container.y } : c?.pos ? { x: (c.pos.x + 0.5) * TILE, y: (c.pos.y + 0.5) * TILE } : undefined;
    if (!pos) return;
    const label = this.add
      .text(pos.x, pos.y - 20, text, crisp({ fontFamily: "system-ui, sans-serif", fontSize: "30px", fontStyle: "bold", color, stroke: "#2a1a00", strokeThickness: 6 }))
      .setOrigin(0.5)
      .setScale(0.2)
      .setDepth(6000);
    this.tweens.add({ targets: label, scale: 0.55, duration: 260, ease: "Back.easeOut" });
    this.tweens.add({ targets: label, y: pos.y - 62, alpha: 0, delay: 900, duration: 1400, ease: "Cubic.easeIn", onComplete: () => label.destroy() });
    this.ambience?.sparkle(pos.x, pos.y - 8);
  }

  /** A small shield next to figures that stand in cover (during fights). */
  private showShield(f: Figure, c: Creature): void {
    const cover = this.session.battle.terrain?.cover ?? {};
    let best = 0;
    if (this.combatLayout && c.pos && !c.dead) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) best = Math.max(best, cover[`${c.pos.x + dx},${c.pos.y + dy}`] ?? 0);
    }
    if (!best) {
      f.shield?.destroy();
      f.shield = undefined;
      return;
    }
    if (f.shield) return;
    f.shield = this.add.text(-11, -14, "🛡️", crisp({ fontSize: "20px" })).setOrigin(0.5).setScale(0.42).setAlpha(0.95);
    f.container.add(f.shield);
    this.tweens.add({ targets: f.shield, scale: 0.5, duration: 200, yoyo: true, ease: "Back.easeOut" });
  }

  /** A speech bubble over a figure (a hero's idea, an NPC's words). */
  showSpeech(creatureId: string, text: string): void {
    const f = this.figures.get(creatureId);
    if (!f) return;
    this.bubbles.get(creatureId)?.destroy();
    const short = text.length > 60 ? `${text.slice(0, 57).trimEnd()} …` : text;
    const label = this.add.text(0, 0, short, crisp({ fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#1b1208", wordWrap: { width: 300 }, align: "center", lineSpacing: 2 })).setOrigin(0.5, 1);
    const w = label.width + 24;
    const h = label.height + 14;
    const bg = this.add.graphics();
    bg.fillStyle(0xfff8e6, 0.96).fillRoundedRect(-w / 2, -h - 12, w, h, 12);
    bg.lineStyle(3, 0x3a2a18, 1).strokeRoundedRect(-w / 2, -h - 12, w, h, 12);
    bg.fillStyle(0xfff8e6, 0.96).fillTriangle(-8, -13, 8, -13, 0, 0);
    bg.lineStyle(3, 0x3a2a18, 1).lineBetween(-8, -12, 0, 0).lineBetween(8, -12, 0, 0);
    label.setY(-19);
    const bubble = this.add.container(f.container.x, f.container.y - 20, [bg, label]).setDepth(6200).setScale(0);
    this.bubbles.set(creatureId, bubble);
    this.tweens.add({ targets: bubble, scale: 0.36, duration: 260, ease: "Back.easeOut" });
    const hold = Math.min(9000, 2500 + short.length * 70);
    this.tweens.add({ targets: bubble, alpha: 0, delay: hold, duration: 500, onComplete: () => {
      bubble.destroy();
      if (this.bubbles.get(creatureId) === bubble) this.bubbles.delete(creatureId);
    } });
  }

  /** Bubble over the figure with this name (NPC lines in the narration). */
  showSpeechByName(name: string, text: string): void {
    const c = Object.values(this.session.battle.creatures).find((x) => x.name === name && !x.dead && x.pos);
    if (c && this.explored(c)) this.showSpeech(c.id, text);
  }

  private explored(c: Creature): boolean {
    const map = this.session.map;
    return !!c.pos && !!map.explored[cellIndex(map, c.pos.x, c.pos.y)];
  }

  /** Sleeping enemies get a floating 💤, watching ones a 👀. */
  private showMood(f: Figure, c: Creature): void {
    const mood = c.effects.some((e) => e.id === "asleep") ? "💤" : c.effects.some((e) => e.id === "on-guard") ? "👀" : "";
    if (!mood) {
      if (f.mood) {
        this.tweens.killTweensOf(f.mood);
        f.mood.destroy();
        f.mood = undefined;
      }
      return;
    }
    if (f.mood?.text === mood) return;
    f.mood?.destroy();
    f.mood = this.add.text(8, -22, mood, crisp({ fontSize: "22px" })).setOrigin(0.5).setScale(0.5);
    f.container.add(f.mood);
    this.tweens.add({ targets: f.mood, y: -27, alpha: 0.55, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  /** A player's reaction rises over their hero. */
  showEmote(creatureId: string, emoji: string): void {
    const f = this.figures.get(creatureId);
    const c = this.session.battle.creatures[creatureId];
    const x = f ? f.container.x : c?.pos ? (c.pos.x + 0.5) * TILE : undefined;
    const y = f ? f.container.y : c?.pos ? (c.pos.y + 0.5) * TILE : undefined;
    if (x === undefined || y === undefined) return;
    const t = this.add.text(x + (Math.random() * 10 - 5), y - 18, emoji, crisp({ fontSize: "40px" })).setOrigin(0.5).setScale(0.1).setDepth(6100);
    this.tweens.add({ targets: t, scale: 0.55, duration: 260, ease: "Back.easeOut" });
    this.tweens.add({ targets: t, y: y - 58, alpha: { from: 1, to: 0 }, delay: 700, duration: 1300, ease: "Sine.easeIn", onComplete: () => t.destroy() });
    if (f) this.tweens.add({ targets: f.body, y: 8, duration: 110, yoyo: true, repeat: 1, ease: "Quad.easeOut" });
  }

  /** A little show at a square (from events and free actions). */
  fx(kind: "puff" | "shake" | "sparkle" | "splash", pos?: { x: number; y: number }): void {
    const x = (pos?.x ?? 0) + 0.5;
    const y = (pos?.y ?? 0) + 0.5;
    if (kind === "shake") {
      this.shake(true);
      if (pos) this.ambience.puff(x, y, 0xa89f8f, 30);
    } else if (!pos) return;
    else if (kind === "puff") this.ambience.puff(x, y);
    else if (kind === "sparkle") this.ambience.sparkle(x, y);
    else this.ambience.splash(x, y);
  }

  /** Attack and spell animations; returns the ms until the blow lands. */
  playFx(list: ActionFx[] | undefined): number {
    if (!list?.length) return 0;
    // Everyone turns towards whom they attack.
    for (const fx of list) {
      const f = this.figures.get(fx.from);
      const c = this.session.battle.creatures[fx.from];
      const t = fx.to[0] ? this.session.battle.creatures[fx.to[0]] : undefined;
      if (f && c && t?.pos && c.pos && t.pos.x !== c.pos.x && fx.from !== fx.to[0]) this.face(f, t.pos.x > c.pos.x ? 1 : -1, c);
    }
    return this.combatFx.play(list);
  }

  /** Heroes look right by default, the DCSS monsters to the left. */
  private face(f: Figure, dir: 1 | -1, c: Creature): void {
    const natural = c.kind === "pc" ? 1 : -1;
    f.body.list.forEach((o) => (o as Phaser.GameObjects.Image).setFlipX(dir !== natural));
  }

  /** Big hits shake the screen. */
  shake(strong: boolean): void {
    this.cameras.main.shake(strong ? 320 : 180, strong ? 0.008 : 0.004);
  }

  /** A boss appears: the camera glides over to it and zooms in a little, then back to the heroes. */
  spotlight(id: string): void {
    const f = this.figures.get(id);
    const c = this.session.battle.creatures[id];
    if (!c?.pos) return;
    const n = sizeInSquares(c.size);
    this.camTarget.set(f ? f.container.x : (c.pos.x + n / 2) * TILE, f ? f.container.y : (c.pos.y + n / 2) * TILE);
    this.spotlightUntil = this.time.now + 2600;
    const cam = this.cameras.main;
    const base = this.zoomBase;
    this.tweens.add({ targets: cam, zoom: base * 1.3, duration: 900, ease: "Sine.easeInOut", yoyo: true, hold: 1000, onComplete: () => cam.setZoom(base) });
    if (f) this.tweens.add({ targets: f.body, scaleX: 1.25, scaleY: 1.25, duration: 300, yoyo: true, delay: 700, ease: "Back.easeOut" });
  }

  /** In combat the initiative bar takes the left edge; the map moves next to it. */
  setCombatLayout(on: boolean): void {
    this.ambience?.setCombat(on);
    this.combatLayout = on;
    this.layout();
  }

  private combatLayout = false;
  private zoomBase = MIN_ZOOM * RES;

  /** The map's part of the screen (between the initiative bar and the log) and a zoom that fills it. */
  private layout(): void {
    const cam = this.cameras.main;
    const left = this.combatLayout ? ORDER_PANEL : 0;
    cam.setViewport(Math.round(left * RES), 0, Math.round((BOARD_WIDTH - left - LOG_PANEL) * RES), Math.round(BOARD_HEIGHT * RES));
    const map = this.session.map;
    const fit = Math.min(cam.width / (map.width * TILE), cam.height / (map.height * TILE)) / RES;
    this.zoomBase = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)) * RES;
    this.tweens.killTweensOf(cam);
    cam.setZoom(this.zoomBase);
    this.applyBounds();
  }

  /** Camera limits: the map edges, but a map smaller than the screen sits in the middle. */
  private applyBounds(): void {
    const cam = this.cameras.main;
    const map = this.session.map;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const w = map.width * TILE;
    const h = map.height * TILE;
    const bw = Math.max(w, viewW);
    const bh = Math.max(h, viewH);
    cam.setBounds((w - bw) / 2, (h - bh) / 2, bw, bh);
  }

  focusParty(instant: boolean): void {
    const heroes = this.session.partyIds.map((id) => this.session.battle.creatures[id]).filter((c): c is Creature => !!c?.pos);
    if (!heroes.length) return;
    const x = (heroes.reduce((s, c) => s + c.pos!.x, 0) / heroes.length + 0.5) * TILE;
    const y = (heroes.reduce((s, c) => s + c.pos!.y, 0) / heroes.length + 0.5) * TILE;
    this.camTarget.set(x, y);
    if (instant) this.cameras.main.centerOn(x, y);
  }

  // ---------------------------------------------------------------- light

  private createLighting(map: DungeonMap): void {
    for (const key of ["fog", "unexplored", "light"]) if (this.textures.exists(key)) this.textures.remove(key);
    this.fogCanvas = this.textures.createCanvas("fog", map.width, map.height)!;
    this.unexploredCanvas = this.textures.createCanvas("unexplored", map.width, map.height)!;
    // Soft round light brush.
    const size = 256;
    const light = this.textures.createCanvas("light", size, size)!;
    const ctx = light.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    light.refresh();
    // Fog and unexplored masks are 1 px per cell, scaled up with smoothing off (hard cell edges).
    this.fogImage = this.make.image({ key: "fog", add: false }).setOrigin(0).setScale(TILE);
    this.unexploredImage = this.make.image({ key: "unexplored", add: false }).setOrigin(0).setScale(TILE);
    this.lightBrush = this.make.image({ key: "light", add: false }).setOrigin(0.5);
    this.dark = this.add.renderTexture(0, 0, map.width * TILE, map.height * TILE).setOrigin(0).setDepth(5000);
    // Soft light edges when the board is zoomed in on big screens.
    this.dark.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  private indoorCell(map: DungeonMap, i: number): boolean {
    const room = map.roomOf[i]!;
    if (room >= 0) return !THEMES[map.rooms[room]!.theme].outdoor;
    // Corridors: dark unless they are paths between outdoor places.
    const frame = map.frames[i] ?? "";
    return !(frame.startsWith("floor.path") || frame.startsWith("floor.grass") || frame.startsWith("floor.dirt") || frame.startsWith("wall.hedge"));
  }

  private redrawFog(): void {
    const map = this.session.map;
    const fog = this.fogCanvas.getContext();
    const unexplored = this.unexploredCanvas.getContext();
    fog.clearRect(0, 0, map.width, map.height);
    unexplored.clearRect(0, 0, map.width, map.height);
    for (let i = 0; i < map.cells.length; i++) {
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      if (!map.explored[i]) {
        unexplored.fillStyle = "#000";
        unexplored.fillRect(x, y, 1, 1);
      } else {
        fog.fillStyle = `rgba(0,0,0,${map.dark ? DARK_NIGHT : this.indoorCell(map, i) ? DARK_INDOOR : DARK_OUTDOOR})`;
        fog.fillRect(x, y, 1, 1);
      }
    }
    this.fogCanvas.refresh();
    this.unexploredCanvas.refresh();
    this.fogDirty = false;
  }

  private drawLight(time: number): void {
    if (this.fogDirty) this.redrawFog();
    const dark = this.dark;
    dark.clear();
    dark.draw(this.fogImage, 0, 0);
    const erase = (cx: number, cy: number, radius: number, strength = 1) => {
      this.lightBrush.setScale((radius * 2 * TILE) / 256).setAlpha(strength);
      dark.erase(this.lightBrush, cx * TILE, cy * TILE);
    };
    for (const id of this.session.partyIds) {
      const c = this.session.battle.creatures[id];
      if (!c?.pos || c.dead) continue;
      const f = this.figures.get(id);
      const x = f ? f.container.x / TILE : c.pos.x + 0.5;
      const y = f ? f.container.y / TILE : c.pos.y + 0.5;
      const wobble = Math.sin(time / 180 + x) * 0.12;
      if (!this.session.map.dark) erase(x, y, HERO_LIGHT + wobble);
      else if (c.effects.some((e) => e.id === "torch")) erase(x, y, NIGHT_TORCH + wobble);
      else {
        // Without a torch: a tiny circle; darkvision adds a wide, dim grey view.
        if (c.darkvisionFt > 0) erase(x, y, NIGHT_DARKVISION, 0.45);
        erase(x, y, NIGHT_NONE + wobble);
      }
    }
    for (const t of [...this.torches, ...this.fires]) {
      const flicker = Math.sin(time / 90 + t.phase) * 0.15 + Math.sin(time / 37 + t.phase * 3) * 0.1;
      erase(t.x, t.y, TORCH_LIGHT + flicker);
    }
    const map = this.session.map;
    for (const o of map.objects) {
      const light = propLight(o);
      if (light) erase(o.x + 0.5, o.y + 0.5, light.radius + 0.8 + Math.sin(time / 110 + o.x) * 0.1, 0.9);
    }
    for (const [key, s] of Object.entries(map.surface ?? {})) {
      if (s.kind !== "fire") continue;
      const i = Number(key);
      erase((i % map.width) + 0.5, Math.floor(i / map.width) + 0.5, 2.6 + Math.sin(time / 70 + i) * 0.2);
    }
    // Coloured glows flicker and only show where the heroes have been.
    for (const g of this.glows.values()) {
      const seen = map.explored[cellIndex(map, Math.floor(g.x), Math.floor(g.y))];
      const flicker = 0.85 + Math.sin(time / 95 + g.phase) * 0.1 + Math.sin(time / 41 + g.phase * 2) * 0.05;
      g.img.setAlpha(seen ? g.strength * flicker : 0);
    }
    dark.draw(this.unexploredImage, 0, 0);
  }

  override update(time: number): void {
    this.ambience.update(time);
    if (time > this.spotlightUntil && this.spotlightUntil > 0) {
      this.spotlightUntil = 0;
      this.focusParty(false);
    }
    // Monsters look around now and then.
    if (time - this.lastLook > 1400) {
      this.lastLook = time;
      const monsters = Object.values(this.session.battle.creatures).filter((c) => c.kind === "monster" && !c.dead && this.figures.has(c.id));
      const c = monsters[Math.floor(Math.random() * monsters.length)];
      if (c && Math.random() < 0.6) this.face(this.figures.get(c.id)!, Math.random() < 0.5 ? 1 : -1, c);
    }
    // Torch animation and light at ~15 fps is plenty and cheap.
    if (time - this.lastLight > 66) {
      this.lastLight = time;
      for (const t of this.torches) t.sprite.setFrame(`torch.${1 + (Math.floor(time / 120 + t.phase) % 4)}`);
      for (const [i, s] of this.surfaceImages) if (s.kind === "fire") s.img.setFrame(`fire.${Math.floor(time / 110 + i) % 3}`);
      this.drawLight(time);
    }
    const cam = this.cameras.main;
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    cam.centerOn(cx + (this.camTarget.x - cx) * 0.08, cy + (this.camTarget.y - cy) * 0.08);
  }
}
