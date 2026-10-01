/**
 * The game board on the TV: dungeon, figures, torches, fog of war and light.
 */
import Phaser from "phaser";
import { armorClass, sizeInSquares } from "../engine/combat";
import { dollFrames } from "../shared/doll";
import type { Creature } from "../shared/game";
import { cellIndex, type DungeonMap, type MapObject } from "../shared/map";
import { THEMES } from "../map/modules";
import { propLight } from "../map/props";
import { assetUrl } from "../ui/atlas";
import { Ambience } from "./ambience";
import { CombatFx } from "./combat-fx";
import type { ActionFx } from "../shared/view";
import { crisp, loadLookMode, prepareTiles, RES, TILES, UP } from "./render";
import { DETAIL_PX, detailFrame, ensureDetailTexture } from "./textures";
import type { GameSession } from "./session";
import { gridPath } from "./walk-path";
import { MoodGrade } from "./mood-grade";

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
/** "Stimmungsvoll": darker rooms, light that walls block, a cool tint in the shadows. */
const MOOD_DARK_INDOOR = 0.8;
const MOOD_TORCH_LIGHT = 5;
/** Pixels per square of the pre-computed light shapes (walls cast shadows). */
const LIGHT_PX = 12;

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
  /** States (🔥💧🎯 …) and known weaknesses (💥❄️) over the figure. */
  tags?: Phaser.GameObjects.Text;
  /** Last square, to face the walking direction. */
  lastX?: number;
  /** Where the figure stands on the board (the walk starts here). */
  grid?: { x: number; y: number };
  /** Walking right now: step by step (a new move takes over from the current square). */
  walk?: Phaser.Tweens.TweenChain;
  walkUntil?: number;
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
  /** "Stimmungsvoll" look (setting): light and shadow, outlines, tinted shadows. */
  private mood = false;
  /** Light shapes with wall shadows, by light (torches, fires, glowing props). */
  private shaped = new Map<string, Phaser.GameObjects.Image>();

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
    this.shaped.clear();
    this.mood = loadLookMode() === "stimmung";
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
    // Stimmungsvoll: a soft vignette and a little more contrast and colour (WebGL only) – in one pass.
    if (this.mood && this.renderer.type === Phaser.WEBGL) {
      const pipes = (this.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines;
      if (!pipes.postPipelineClasses.has("MoodGrade")) pipes.addPostPipeline("MoodGrade", MoodGrade);
      cam.resetPostPipeline(true);
      cam.setPostPipeline("MoodGrade");
    }
    this.focusParty(true);
    // A new map comes up out of black (it went dark before, see fadeAway).
    cam.fadeIn(700, 0, 0, 0);

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
    // Stimmungsvoll: bricks and flagstones with finer, seamless textures (drawn first, under everything).
    const detail = new Map<string, Phaser.GameObjects.Blitter>();
    const detailBlitter = (key: string) => {
      let b = detail.get(key);
      if (!b) {
        b = this.add.blitter(0, 0, key);
        this.add.container(0, 0, [b]).setScale(TILE / DETAIL_PX).setDepth(-1);
        detail.set(key, b);
      }
      return b;
    };
    // A blitter draws thousands of static tiles cheaply; the container scales the upscaled art back to world units.
    const blitter = this.add.blitter(0, 0, TILES);
    this.add.container(0, 0, [blitter]).setScale(1 / UP).setDepth(0);
    const s = TILE * UP;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = cellIndex(map, x, y);
        const frame = map.frames[i];
        if (!frame) continue;
        const key = this.mood ? ensureDetailTexture(this, frame) : undefined;
        if (key) detailBlitter(key).create(x * DETAIL_PX, y * DETAIL_PX, detailFrame(x, y));
        // Forest "walls" are trees standing on grass.
        else blitter.create(x * s, y * s, frame);
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
      const frame = s.kind === "fire" ? "fire.0" : s.kind === "mud" ? "floor.mud.0" : s.kind === "warn" ? "danger" : s.kind;
      const img = this.tile(x, y, frame).setOrigin(0).setDepth(s.kind === "fire" ? 100 + Math.floor(i / map.width) * 10 + 6 : s.kind === "warn" ? 4300 : 0.9);
      img.setAlpha(0);
      this.tweens.add({ targets: img, alpha: s.kind === "fire" ? 0.95 : 0.85, duration: 500 });
      if (s.kind === "warn") this.tweens.add({ targets: img, scale: img.scale * 1.12, alpha: 0.55, duration: 350, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
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
    } else if (Math.abs(img.x - o.x * TILE) > 1 || Math.abs(img.y - o.y * TILE) > 1) {
      // Pushed or rolled: it slides over and lands with a little bump.
      const squares = Math.max(Math.abs(img.x - o.x * TILE), Math.abs(img.y - o.y * TILE)) / TILE;
      this.tweens.killTweensOf(img);
      const target = img;
      this.tweens.add({ targets: target, x: o.x * TILE, y: o.y * TILE, duration: Math.min(900, 140 * squares + 120), ease: "Quad.easeOut", onComplete: () => this.tweens.add({ targets: target, y: target.y - 3, duration: 80, yoyo: true }) });
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
    // Companions wear their hero's colour (dashed look: a thinner ring).
    const owner = c.companion ? this.session.battle.creatures[c.companion.ownerId] : undefined;
    const tint = c.appearance?.color ?? owner?.appearance?.color;
    const color = tint ? Phaser.Display.Color.HexStringToColor(tint).color : 0x000000;
    ring.fillStyle(0x000000, 0.35).fillEllipse(0, 11, 26, 9);
    if (tint) ring.lineStyle(c.appearance ? 2 : 1.2, color, 1).strokeEllipse(0, 11, 26, 9);
    container.add(ring);
    // The body's origin is at the feet, so breathing stretches it upwards.
    const body = this.add.container(0, 12);
    container.add(body);
    // No name labels: the coloured ring shows whose figure it is.
    const frames = c.effects.some((e) => e.id === "wild-shape") ? ["monster.wolf"] : c.appearance ? dollFrames(c.appearance.look) : c.monsterId ? [`monster.${c.monsterId}`] : [];
    // Stimmungsvoll: a thin dark outline makes figures stand out on busy floors and in the dark.
    if (this.mood) {
      for (const [dx, dy] of [[-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8]] as const) {
        for (const frame of frames) body.add(this.tile(dx, -12 + dy, frame).setTintFill(0x100a06).setAlpha(0.8).setData("outline", true));
      }
    }
    for (const frame of frames) body.add(this.tile(0, -12, frame));
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
    const from = f.grid;
    const movedSquare = !from || from.x !== c.pos.x || from.y !== c.pos.y;
    if (animate && movedSquare && from) this.walkTo(f, c, from, n);
    else if (!animate || !f.walk) {
      f.walk?.stop();
      f.walk = undefined;
      f.container.setPosition(x, y);
    }
    f.grid = { x: c.pos.x, y: c.pos.y };
    f.lastX = c.pos.x;
    this.showMood(f, c);
    this.showShield(f, c);
    this.showTags(f, c);
    if (f.hpBar) {
      f.hpBar.clear();
      if (c.hp < c.maxHp) {
        f.hpBar.fillStyle(0x000000, 0.7).fillRect(-12, -19, 24, 4);
        f.hpBar.fillStyle(c.hp / c.maxHp > 0.5 ? 0x5bd15b : c.hp / c.maxHp > 0.25 ? 0xe0c040 : 0xe04040, 1).fillRect(-11, -18, (22 * c.hp) / c.maxHp, 2);
      }
    }
  }

  /**
   * The figure walks there square by square – around walls and furniture, with a little step for
   * every square and facing the way it goes. Far or blocked ways (a jump, a push): one smooth move.
   */
  private walkTo(f: Figure, c: Creature, from: { x: number; y: number }, n: number): void {
    const to = c.pos!;
    // Already on the way: start from the square the figure is on right now.
    if (f.walk) {
      f.walk.stop();
      from = { x: Math.round(f.container.x / TILE - n / 2), y: Math.round(f.container.y / TILE - n / 2) };
    }
    const path = gridPath(this.session.map, from, to) ?? [];
    const center = (p: { x: number; y: number }) => ({ x: (p.x + n / 2) * TILE, y: (p.y + n / 2) * TILE });
    const steps = path.length && path.length <= 30 ? path : [to];
    const stepMs = steps.length === 1 && path.length !== 1 ? 260 : 150;
    let last = from;
    const tweens = steps.map((p) => {
      const prev = last;
      last = p;
      const at = center(p);
      return {
        targets: f.container,
        x: at.x,
        y: at.y,
        duration: stepMs,
        ease: "Linear",
        onStart: () => {
          if (p.x !== prev.x) this.face(f, p.x > prev.x ? 1 : -1, c);
          f.container.setDepth(100 + (Math.max(p.y, prev.y) + n - 1) * 10 + 5);
          // A little step: the body bobs up and tilts once per square.
          this.tweens.add({ targets: f.body, y: 9, angle: p.x >= prev.x ? 4 : -4, duration: stepMs / 2, yoyo: true, ease: "Sine.easeOut" });
        },
      };
    });
    f.walkUntil = this.time.now + steps.length * stepMs;
    f.walk = this.tweens.chain({
      tweens,
      onComplete: () => {
        f.walk = undefined;
        f.body.setAngle(0);
      },
    });
  }

  /** How long figures are still walking (ms) – attacks wait until they arrived. */
  walkRemaining(): number {
    let most = 0;
    for (const f of this.figures.values()) if (f.walk && f.walkUntil) most = Math.max(most, f.walkUntil - this.time.now);
    return Math.max(0, most);
  }

  /** Called by the host after the state changed. */
  /** While a blow is still on its way, the fallen keep standing (released by releaseDeaths). */
  holdDeaths = false;
  private pendingDeaths: Phaser.GameObjects.Container[] = [];

  /** The blow has landed: the fallen sink now. */
  releaseDeaths(delay = 250): void {
    this.holdDeaths = false;
    for (const f of this.pendingDeaths.splice(0)) this.fadeDeath(f, delay);
  }

  private fadeDeath(f: Phaser.GameObjects.Container, delay: number): void {
    this.tweens.add({ targets: f, alpha: 0, angle: 80, y: f.y + 8, duration: 900, delay, ease: "Sine.easeIn", onComplete: () => f.destroy() });
  }

  refresh(): void {
    // Creatures that left the game (fled, or an NPC that turned into an enemy) simply fade out.
    for (const [id, f] of this.figures) {
      if (this.session.battle.creatures[id]) continue;
      this.figures.delete(id);
      this.tweens.add({ targets: f.container, alpha: 0, duration: 600, onComplete: () => f.container.destroy() });
    }
    for (const c of Object.values(this.session.battle.creatures)) {
      const f = this.figures.get(c.id);
      // Who moved last? The camera follows them (heroes and their helpers; in a fight everyone).
      const at = c.pos && !c.dead ? `${c.pos.x},${c.pos.y}` : "";
      const was = this.lastPos.get(c.id);
      if (at && was !== undefined && was !== at && (c.side === "party" || this.combatLayout)) this.focusId = c.id;
      this.lastPos.set(c.id, at);
      if (c.dead && f) {
        // Defeated: sink and fade away – once the blow is seen landing (the board holds it until then).
        this.figures.delete(c.id);
        if (this.holdDeaths) this.pendingDeaths.push(f.container);
        else this.fadeDeath(f.container, 450);
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
        // The figure flashes red (outlines and the weapon glow keep their own colour).
        const images = f.body.list.filter((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image && !o.getData("outline") && o !== f.glow);
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

  /** What the heroes learned about a foe ("💥 Feuer ×2" …), set by the host. */
  typesOf: ((c: Creature) => string[]) | undefined;

  /** Small signs over a figure: its states, and for foes the weaknesses the heroes know. */
  private showTags(f: Figure, c: Creature): void {
    const states = stateIcons(c);
    const weak = c.side === "enemy" ? (this.typesOf?.(c) ?? []).filter((t) => t.includes("×2")).map((t) => firstSign(t)) : [];
    const text = [states.join(""), weak.length ? `×2${weak.join("")}` : ""].filter(Boolean).join(" ");
    if (!text || c.dead || c.hp <= 0) {
      f.tags?.destroy();
      f.tags = undefined;
      return;
    }
    if (!f.tags) {
      f.tags = this.add.text(0, c.kind === "monster" ? -22 : -19, "", crisp({ fontFamily: "system-ui, sans-serif", fontSize: "22px", stroke: "#000", strokeThickness: 4 })).setOrigin(0.5, 1).setScale(0.36);
      f.container.add(f.tags);
    }
    if (f.tags.text !== text) f.tags.setText(text);
  }

  /** The hero's chosen target: an arrow from the hero, a ring, and one card about the foe. */
  showAim(heroId: string, targetIds: string[]): void {
    this.clearAim();
    const hero = this.figures.get(heroId);
    const color = this.session.battle.creatures[heroId]?.appearance?.color;
    const tint = color ? Phaser.Display.Color.HexStringToColor(color).color : 0xffd75e;
    const g = this.add.graphics().setDepth(5150);
    const parts: Phaser.GameObjects.GameObject[] = [g];
    for (const id of targetIds.slice(0, 4)) {
      const t = this.figures.get(id);
      if (!t) continue;
      if (hero) {
        const [x1, y1, x2, y2] = [hero.container.x, hero.container.y, t.container.x, t.container.y];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len > 8) {
          const ux = (x2 - x1) / len;
          const uy = (y2 - y1) / len;
          const ex = x2 - ux * 13;
          const ey = y2 - uy * 13;
          // Dashed line with a head: whom the hero means.
          for (let d = 10; d < len - 18; d += 8) {
            const a = { x: x1 + ux * d, y: y1 + uy * d };
            g.lineStyle(4, 0x000000, 0.45).lineBetween(a.x, a.y, a.x + ux * 4, a.y + uy * 4);
            g.lineStyle(2, tint, 1).lineBetween(a.x, a.y, a.x + ux * 4, a.y + uy * 4);
          }
          g.fillStyle(tint, 1).fillTriangle(ex + ux * 6, ey + uy * 6, ex - uy * 5, ey + ux * 5, ex + uy * 5, ey - ux * 5);
        }
      }
      g.lineStyle(2.5, tint, 1).strokeCircle(t.container.x, t.container.y, 15);
    }
    this.tweens.add({ targets: g, alpha: 0.55, duration: 600, yoyo: true, repeat: -1 });
    // One detailed card: only the foe being attacked right now.
    const foe = targetIds.map((id) => this.session.battle.creatures[id]).find((c) => c?.side === "enemy");
    const ff = foe ? this.figures.get(foe.id) : undefined;
    if (foe && ff) {
      const known = this.typesOf?.(foe) ?? [];
      const states = stateIcons(foe);
      const lines = [
        `❤️ ${foe.hp}/${foe.maxHp}   🛡️ RK ${armorClass(foe)}`,
        known.length ? known.join("  ") : "Stärken/Schwächen: noch unbekannt",
        ...(states.length ? [states.join(" ")] : []),
      ];
      const name = this.add.text(0, 0, foe.name, crisp({ fontFamily: "system-ui, sans-serif", fontSize: "26px", fontStyle: "bold", color: "#ffd75e" })).setOrigin(0.5, 0);
      const body = this.add.text(0, name.height + 4, lines.join("\n"), crisp({ fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#f3e9d2", align: "center", lineSpacing: 4 })).setOrigin(0.5, 0);
      const w = Math.max(name.width, body.width) + 30;
      const hgt = name.height + body.height + 22;
      const bg = this.add.graphics();
      bg.fillStyle(0x14110f, 0.92).fillRoundedRect(-w / 2, -10, w, hgt, 12);
      bg.lineStyle(3, 0xe04040, 1).strokeRoundedRect(-w / 2, -10, w, hgt, 12);
      const card = this.add.container(ff.container.x, ff.container.y - 26, [bg, name, body]).setDepth(6150).setScale(0.36);
      // Above the foe; below it if there is no room at the top of the map.
      card.y -= hgt * 0.36;
      if (card.y < 4) card.y = ff.container.y + 22;
      parts.push(card);
    }
    this.aimParts = parts;
  }

  clearAim(): void {
    for (const p of this.aimParts) {
      this.tweens.killTweensOf(p);
      p.destroy();
    }
    this.aimParts = [];
  }

  private aimParts: Phaser.GameObjects.GameObject[] = [];

  /** The log column is open (key L): the map gets narrower. */
  setLogOpen(open: boolean): void {
    this.logOpen = open;
    this.layout();
    this.focusParty(false);
  }

  private logOpen = false;

  /** A speech bubble over a figure (a hero's idea, an NPC's words). */
  /** A player points at a square on the phone: a ring in the hero's colour, and the planned route as dots. */
  showPoint(heroId: string, at: { x: number; y: number }, path: { x: number; y: number }[]): void {
    const hero = this.session.battle.creatures[heroId];
    const color = hero?.appearance?.color ? Phaser.Display.Color.HexStringToColor(hero.appearance.color).color : 0xffd75e;
    this.pointMarks?.destroy();
    const g = this.add.graphics().setDepth(5200);
    this.pointMarks = g;
    for (const p of path.slice(0, -1)) {
      g.fillStyle(0x000000, 0.5).fillCircle((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, 4.5);
      g.fillStyle(color, 1).fillCircle((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, 3);
    }
    g.lineStyle(3.5, 0x000000, 0.55).strokeCircle((at.x + 0.5) * TILE, (at.y + 0.5) * TILE, TILE * 0.46);
    g.lineStyle(2.5, color, 1).strokeCircle((at.x + 0.5) * TILE, (at.y + 0.5) * TILE, TILE * 0.46);
    const ring = this.add.graphics().setDepth(5201);
    ring.lineStyle(2, color, 1).strokeCircle(0, 0, TILE * 0.46);
    ring.setPosition((at.x + 0.5) * TILE, (at.y + 0.5) * TILE);
    this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 700, repeat: 1, onComplete: () => ring.destroy() });
    this.tweens.add({ targets: g, alpha: 0, delay: path.length ? 3500 : 1600, duration: 500, onComplete: () => g === this.pointMarks && (this.pointMarks = undefined) });
  }

  private pointMarks: Phaser.GameObjects.Graphics | undefined;

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

  private turnMark: Phaser.GameObjects.Text | undefined;

  /** Whose turn it is (a foe, a person of the world): a small bobbing sign over the figure. */
  markTurn(id: string | undefined): void {
    if (this.turnMark) {
      this.tweens.killTweensOf(this.turnMark);
      this.turnMark.destroy();
      this.turnMark = undefined;
    }
    const f = id ? this.figures.get(id) : undefined;
    const c = id ? this.session.battle.creatures[id] : undefined;
    if (!f || !c?.pos || c.dead || !this.explored(c)) return;
    const icon = c.side === "enemy" ? "👹" : "💬";
    const n = sizeInSquares(c.size);
    const mark = this.add.text(0, -(n * TILE) / 2 - 10, `${icon} ist dran`, crisp({ fontFamily: "system-ui, sans-serif", fontSize: "26px", fontStyle: "bold", color: c.side === "enemy" ? "#ffb0a0" : "#cfe6ff", stroke: "#000", strokeThickness: 6 })).setOrigin(0.5, 1).setScale(0.34);
    f.container.add(mark);
    this.turnMark = mark;
    this.tweens.add({ targets: mark, y: mark.y - 3, duration: 450, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
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
    const mood = c.wild ? "❔" : c.effects.some((e) => e.id === "asleep") ? "💤" : c.effects.some((e) => e.id === "on-guard") ? "👀" : "";
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
    cam.pan(this.camTarget.x, this.camTarget.y, 700, "Sine.easeInOut", true);
    const base = this.zoomBase;
    this.tweens.add({ targets: cam, zoom: base * 1.3, duration: 900, ease: "Sine.easeInOut", yoyo: true, hold: 1000, onComplete: () => cam.setZoom(base) });
    if (f) this.tweens.add({ targets: f.body, scaleX: 1.25, scaleY: 1.25, duration: 300, yoyo: true, delay: 700, ease: "Back.easeOut" });
  }

  /** In combat the initiative bar takes the left edge; the map moves next to it. */
  setCombatLayout(on: boolean): void {
    this.ambience?.setCombat(on);
    this.combatLayout = on;
    this.layout(true);
    this.focusParty(false);
  }

  private combatLayout = false;
  private zoomBase = MIN_ZOOM * RES;

  /** The map's part of the screen (between the initiative bar and the log) and a zoom that fills it. */
  private layout(glide = false): void {
    const cam = this.cameras.main;
    const left = this.combatLayout ? ORDER_PANEL : 0;
    cam.setViewport(Math.round(left * RES), 0, Math.round((BOARD_WIDTH - left - (this.logOpen ? LOG_PANEL : 0)) * RES), Math.round(BOARD_HEIGHT * RES));
    const map = this.session.map;
    const fit = Math.min(cam.width / (map.width * TILE), cam.height / (map.height * TILE)) / RES;
    this.zoomBase = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)) * RES;
    this.tweens.killTweensOf(cam);
    // Into and out of a fight the camera glides to the new size instead of jumping.
    if (glide) cam.zoomTo(this.zoomBase, 650, "Sine.easeInOut", true, (_c: unknown, progress: number) => progress >= 1 && this.applyBounds());
    else cam.setZoom(this.zoomBase);
    this.zoomTarget = glide ? this.zoomBase : 0;
    this.applyBounds();
  }

  /** Leaving this map: the picture fades to black first (then the board is rebuilt). */
  fadeAway(then: () => void): void {
    const cam = this.cameras.main;
    if (cam.fadeEffect.isRunning) return;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, then);
    cam.fadeOut(450, 0, 0, 0);
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

  private lastPos = new Map<string, string>();
  private focusId: string | undefined;
  private zoomTarget = 0;

  /**
   * The camera follows whoever is acting (in a fight: whose turn it is; exploring: who moved last),
   * close up. It only zooms out – gently, never below the minimum – to keep the rest of the group in view.
   */
  focusParty(instant: boolean): void {
    const creatures = this.session.battle.creatures;
    const heroes = this.session.partyIds.map((id) => creatures[id]).filter((c): c is Creature => !!c?.pos && !c.dead);
    if (!heroes.length) return;
    const turnId = this.combatLayout ? this.session.battle.combat?.turn.creatureId : undefined;
    const pick = [turnId, this.focusId].map((id) => (id ? creatures[id] : undefined)).find((c) => c?.pos && !c.dead);
    const center = (c: Creature) => ({ x: (c.pos!.x + sizeInSquares(c.size) / 2) * TILE, y: (c.pos!.y + sizeInSquares(c.size) / 2) * TILE });
    const actor = pick ? center(pick) : { x: (heroes.reduce((s, c) => s + c.pos!.x, 0) / heroes.length + 0.5) * TILE, y: (heroes.reduce((s, c) => s + c.pos!.y, 0) / heroes.length + 0.5) * TILE };
    // How far out do we need to be to see the actor and every hero (with a margin)?
    const cam = this.cameras.main;
    const spots = [actor, ...heroes.map(center)];
    const halfW = Math.max(...spots.map((p) => Math.abs(p.x - actor.x))) + TILE * 2.5;
    const halfH = Math.max(...spots.map((p) => Math.abs(p.y - actor.y))) + TILE * 2.5;
    const need = Math.min(cam.width / (2 * halfW), cam.height / (2 * halfH));
    // Calm camera: it zooms out only in clear steps (never a little every moment) and glides to the actor
    // in one move – and not at all for small steps, so the picture stays still while someone walks.
    const zoom = Math.max(MIN_ZOOM * RES, Math.min(this.zoomBase, need));
    const zoomChange = Math.abs(zoom - this.zoomTarget) / Math.max(zoom, 0.01) > 0.15;
    if (instant || !this.zoomTarget || zoomChange) this.zoomTarget = zoom;
    const moved = Math.hypot(actor.x - this.camTarget.x, actor.y - this.camTarget.y) > TILE * 2;
    if (instant) {
      this.camTarget.set(actor.x, actor.y);
      cam.setZoom(this.zoomTarget);
      this.applyBounds();
      cam.centerOn(actor.x, actor.y);
      return;
    }
    if (zoomChange && this.time.now > this.spotlightUntil) {
      cam.zoomTo(this.zoomTarget, 700, "Sine.easeInOut", true, (_c: unknown, progress: number) => progress >= 1 && this.applyBounds());
    }
    if (moved || zoomChange) {
      this.camTarget.set(actor.x, actor.y);
      cam.pan(actor.x, actor.y, 900, "Sine.easeInOut", true);
    }
  }

  // ---------------------------------------------------------------- light

  private createLighting(map: DungeonMap): void {
    for (const key of ["fog", "unexplored", "light"]) if (this.textures.exists(key)) this.textures.remove(key);
    for (const key of this.textures.getTextureKeys()) if (key.startsWith("ol-")) this.textures.remove(key);
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

  /**
   * A light's shape with shadows: walls between the light and a square block it (soft edges).
   * Drawn once per light and map, then erased out of the darkness like the round brush.
   */
  private shapedLight(key: string, lx: number, ly: number, radius: number): Phaser.GameObjects.Image {
    const have = this.shaped.get(key);
    if (have) return have;
    const map = this.session.map;
    const tex = `ol-${key}`;
    if (this.textures.exists(tex)) this.textures.remove(tex);
    const size = Math.ceil(radius * 2 * LIGHT_PX) + 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const wall = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height || map.cells[cellIndex(map, x, y)] === "wall";
    const sx = Math.floor(lx), sy = Math.floor(ly);
    const seen = (tx: number, ty: number): boolean => {
      const ex = Math.floor(tx), ey = Math.floor(ty);
      const n = Math.ceil(Math.hypot(tx - lx, ty - ly) * 3);
      for (let k = 1; k < n; k++) {
        const cx = Math.floor(lx + ((tx - lx) * k) / n), cy = Math.floor(ly + ((ty - ly) * k) / n);
        if ((cx === sx && cy === sy) || (cx === ex && cy === ey)) continue;
        if (wall(cx, cy)) return false;
      }
      return true;
    };
    const half = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const wx = lx + (px - half) / LIGHT_PX, wy = ly + (py - half) / LIGHT_PX;
        const d = Math.hypot(wx - lx, wy - ly) / radius;
        if (d >= 1) continue;
        // Walls themselves catch the light on their face, so a lit wall square counts as seen.
        if (!seen(wx, wy)) continue;
        const a = d < 0.55 ? 1 - d * 0.27 : 0.85 * (1 - (d - 0.55) / 0.45);
        img.data[(py * size + px) * 4 + 3] = Math.round(255 * Math.max(0, a));
        img.data[(py * size + px) * 4] = img.data[(py * size + px) * 4 + 1] = img.data[(py * size + px) * 4 + 2] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Soft shadow edges.
    const soft = document.createElement("canvas");
    soft.width = size;
    soft.height = size;
    const sctx = soft.getContext("2d")!;
    sctx.filter = "blur(4px)";
    sctx.drawImage(canvas, 0, 0);
    this.textures.addCanvas(tex, soft);
    const image = this.make.image({ key: tex, add: false }).setOrigin(0.5).setScale(TILE / LIGHT_PX);
    this.shaped.set(key, image);
    return image;
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
        // The darkness itself is already black there (lights are kept out of it, see drawLight).
        fog.fillStyle = "#000";
        fog.fillRect(x, y, 1, 1);
      } else {
        const indoor = this.indoorCell(map, i);
        const a = map.dark ? DARK_NIGHT : indoor ? (this.mood ? MOOD_DARK_INDOOR : DARK_INDOOR) : DARK_OUTDOOR;
        // Stimmungsvoll: shadows are a deep blue-violet instead of plain black (warm light against cool shade).
        // (Empty space around the rooms stays plain black.)
        fog.fillStyle = this.mood && !map.dark && map.frames[i] ? `rgba(10,8,26,${a})` : `rgba(0,0,0,${a})`;
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
    // WebGL: all lights go into one batch that is erased in a single pass (each erase on its own
    // would copy the whole darkness once per light). The result is the same: every light takes
    // away its share of the darkness, (1 − a₁)(1 − a₂)…
    const batched = this.renderer.type === Phaser.WEBGL;
    if (batched) dark.beginDraw();
    const cut = (img: Phaser.GameObjects.Image, x: number, y: number) => {
      if (batched) dark.batchDraw(img, x, y);
      else dark.erase(img, x, y);
    };
    const erase = (cx: number, cy: number, radius: number, strength = 1) => {
      this.lightBrush.setScale((radius * 2 * TILE) / 256).setAlpha(strength);
      cut(this.lightBrush, cx * TILE, cy * TILE);
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
    const map = this.session.map;
    // Stimmungsvoll: the light's own shape with wall shadows, flickering a little.
    const shaped = (key: string, x: number, y: number, radius: number, flicker: number, strength = 1) => {
      const img = this.shapedLight(key, x, y, radius);
      img.setScale((TILE / LIGHT_PX) * (1 + flicker * 0.04)).setAlpha(strength);
      cut(img, x * TILE, y * TILE);
    };
    [...this.torches, ...this.fires].forEach((t, k) => {
      const flicker = Math.sin(time / 90 + t.phase) * 0.15 + Math.sin(time / 37 + t.phase * 3) * 0.1;
      if (this.mood && !map.dark) shaped(`t${k}`, t.x, t.y, MOOD_TORCH_LIGHT, flicker);
      else erase(t.x, t.y, TORCH_LIGHT + flicker);
    });
    for (const o of map.objects) {
      const light = propLight(o);
      if (!light) continue;
      if (this.mood && !map.dark) shaped(o.id, o.x + 0.5, o.y + 0.5, light.radius + 1.6, Math.sin(time / 110 + o.x), 0.95);
      else erase(o.x + 0.5, o.y + 0.5, light.radius + 0.8 + Math.sin(time / 110 + o.x) * 0.1, 0.9);
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
      g.img.setAlpha(seen ? g.strength * flicker * (this.mood ? 1.4 : 1) : 0);
    }
    if (batched) {
      // No light reaches into unexplored places: the mask takes the light away there, in the same batch
      // (the same as drawing the black of the unexplored on top afterwards, one full pass less).
      this.unexploredImage.setBlendMode(Phaser.BlendModes.ERASE);
      dark.batchDraw(this.unexploredImage, 0, 0);
      this.unexploredImage.setBlendMode(Phaser.BlendModes.NORMAL);
      dark.endDraw(true);
    } else dark.draw(this.unexploredImage, 0, 0);
  }

  override update(time: number): void {
    this.ambience.update(time);
    if (time > this.spotlightUntil && this.spotlightUntil > 0) {
      this.spotlightUntil = 0;
      this.focusParty(false);
    }
    // Torch animation and light at ~15 fps is plenty and cheap.
    if (time - this.lastLight > 66) {
      this.lastLight = time;
      for (const t of this.torches) t.sprite.setFrame(`torch.${1 + (Math.floor(time / 120 + t.phase) % 4)}`);
      for (const [i, s] of this.surfaceImages) if (s.kind === "fire") s.img.setFrame(`fire.${Math.floor(time / 110 + i) % 3}`);
      this.drawLight(time);
    }
  }
}

const STATE_ICON: Record<string, string> = {
  burning: "🔥", chilled: "❄️", shocked: "⚡", wet: "💧", weakspot: "🎯", distracted: "💫", feud: "😤", disguised: "🥸", bless: "🙏", "shield-of-faith": "🛡️",
  prone: "🛌", poisoned: "🤢", incapacitated: "💫", stunned: "😵", unconscious: "💤", restrained: "⛓️", frightened: "😱", paralyzed: "🥶", charmed: "💘", blinded: "🙈", grappled: "🤼",
};

/** The signs of what is going on with a creature (each once, at most five). */
export function stateIcons(c: Pick<Creature, "effects" | "conditions">): string[] {
  const out: string[] = [];
  for (const id of [...c.conditions.map((x) => x.id), ...c.effects.map((e) => e.id)]) {
    const icon = STATE_ICON[id];
    if (icon && !out.includes(icon)) out.push(icon);
  }
  return out.slice(0, 5);
}

function firstSign(text: string): string {
  return [...new Intl.Segmenter().segment(text)][0]?.segment ?? "";
}
