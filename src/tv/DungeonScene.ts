/**
 * The game board on the TV: dungeon, figures, torches, fog of war and light.
 */
import Phaser from "phaser";
import { sizeInSquares } from "../engine/combat";
import { dollFrames } from "../shared/doll";
import type { Creature } from "../shared/game";
import { cellIndex, type DungeonMap, type MapObject } from "../shared/map";
import { THEMES } from "../map/modules";
import { assetUrl } from "../ui/atlas";
import { Ambience } from "./ambience";
import { crisp, prepareTiles, RES, TILES, UP } from "./render";
import type { GameSession } from "./session";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;
const TILE = 32;
const ZOOM = 2;

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
  /** Last square, to face the walking direction. */
  lastX?: number;
}

export class DungeonScene extends Phaser.Scene {
  private session!: GameSession;
  private figures = new Map<string, Figure>();
  private torches: { sprite: Phaser.GameObjects.Image; x: number; y: number; phase: number }[] = [];
  /** Camp fires and cauldrons: light without a torch sprite. */
  private fires: { x: number; y: number; phase: number }[] = [];
  private objectImages = new Map<string, Phaser.GameObjects.Image>();
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
    prepareTiles(this);

    this.ambience = new Ambience(this, () => this.session, (x, y, frame) => this.tile(x, y, frame));
    this.ambience.start();
    this.bakeMap(map);
    this.drawObjects(map);
    for (const t of this.torches) this.ambience.torchSparks(t.x, t.y - 0.6);
    for (const c of Object.values(this.session.battle.creatures)) this.addFigure(c);
    this.createLighting(map);

    const cam = this.cameras.main;
    cam.setZoom(ZOOM * RES);
    // Rounding each tile to whole pixels leaves a thin seam through the middle of the screen at odd zooms.
    cam.roundPixels = false;
    this.applyBounds();
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

    for (const [key, overlay] of Object.entries(map.overlays)) {
      if (!overlay.startsWith("torch")) continue;
      const i = Number(key);
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      const sprite = this.tile(x * TILE, y * TILE, "torch.1").setOrigin(0).setDepth(1);
      this.torches.push({ sprite, x: x + 0.5, y: y + 0.9, phase: Math.random() * 10 });
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
    img.setDepth(hanging ? 4400 : o.blocking ? 100 + o.y * 10 : 2);
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
    if (c.appearance) {
      // No name labels: the coloured ring shows whose figure it is.
      for (const frame of dollFrames(c.appearance.look)) body.add(this.tile(0, -12, frame));
    } else if (c.monsterId) {
      body.add(this.tile(0, -12, `monster.${c.monsterId}`));
    }
    container.setScale(n);
    // Idle: everyone breathes, each at their own pace.
    this.tweens.add({ targets: body, scaleY: 1.035, scaleX: 0.99, duration: Phaser.Math.Between(1100, 1600), yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: Phaser.Math.Between(0, 1200) });
    const figure: Figure = { container, body, lastX: c.pos.x };
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
        this.tweens.add({ targets: f.container, alpha: 0, angle: 80, y: f.container.y + 8, duration: 700, delay: 300, onComplete: () => f.container.destroy() });
      } else if (!f && !c.dead) this.addFigure(c);
      else if (f) {
        this.placeFigure(c, true);
        // Unconscious heroes lie on the ground.
        f.container.setAngle(c.hp === 0 && c.kind === "pc" ? 90 : 0).setAlpha(c.hp === 0 ? 0.7 : 1);
      }
    }
    for (const o of this.session.map.objects) this.syncObject(o);
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
    const base = ZOOM * RES;
    this.tweens.add({ targets: cam, zoom: base * 1.3, duration: 900, ease: "Sine.easeInOut", yoyo: true, hold: 1000, onComplete: () => cam.setZoom(base) });
    if (f) this.tweens.add({ targets: f.body, scaleX: 1.25, scaleY: 1.25, duration: 300, yoyo: true, delay: 700, ease: "Back.easeOut" });
  }

  /** In combat the initiative bar takes the left edge; the map moves next to it. */
  setCombatLayout(on: boolean): void {
    this.ambience?.setCombat(on);
    const left = on ? 340 : 0;
    this.cameras.main.setViewport(Math.round(left * RES), 0, Math.round((BOARD_WIDTH - left) * RES), Math.round(BOARD_HEIGHT * RES));
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
      this.drawLight(time);
    }
    const cam = this.cameras.main;
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    cam.centerOn(cx + (this.camTarget.x - cx) * 0.08, cy + (this.camTarget.y - cy) * 0.08);
  }
}
