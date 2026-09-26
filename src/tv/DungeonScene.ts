/**
 * The game board on the TV: dungeon, figures, torches, fog of war and light.
 */
import Phaser from "phaser";
import { sizeInSquares } from "../engine/combat";
import { dollFrames } from "../shared/doll";
import type { Creature } from "../shared/game";
import { cellIndex, type DungeonMap } from "../shared/map";
import { THEMES } from "../map/modules";
import { assetUrl } from "../ui/atlas";
import type { GameSession } from "./session";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;
const TILE = 32;
const ZOOM = 2;

/** Darkness per cell: unexplored = black, indoor = dim, outdoor (daylight) = almost clear. */
const DARK_INDOOR = 0.72;
const DARK_OUTDOOR = 0.1;
/** Night scenes: almost black outside the light. */
const DARK_NIGHT = 0.9;
/** Light circle (in squares) of a hero at night: torch, darkvision (dim), nothing. */
const NIGHT_TORCH = 6.5;
const NIGHT_DARKVISION = 3.5;
const NIGHT_NONE = 1.8;
const HERO_LIGHT = 5.5;
const TORCH_LIGHT = 3.5;

interface Figure {
  container: Phaser.GameObjects.Container;
  hpBar?: Phaser.GameObjects.Graphics;
}

export class DungeonScene extends Phaser.Scene {
  private session!: GameSession;
  private figures = new Map<string, Figure>();
  private torches: { sprite: Phaser.GameObjects.Image; x: number; y: number; phase: number }[] = [];
  private fogCanvas!: Phaser.Textures.CanvasTexture;
  private unexploredCanvas!: Phaser.Textures.CanvasTexture;
  private dark!: Phaser.GameObjects.RenderTexture;
  private fogImage!: Phaser.GameObjects.Image;
  private unexploredImage!: Phaser.GameObjects.Image;
  private lightBrush!: Phaser.GameObjects.Image;
  private camTarget = new Phaser.Math.Vector2();
  private lastLight = 0;
  private fogDirty = true;

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

    this.bakeMap(map);
    this.drawObjects(map);
    for (const c of Object.values(this.session.battle.creatures)) this.addFigure(c);
    this.createLighting(map);

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, map.width * TILE, map.height * TILE);
    cam.setBackgroundColor("#000000");
    this.focusParty(true);

    this.showRoomName(map.rooms[0]!.name);
  }

  showRoomName(name: string): void {
    this.game.events.emit("room-name", name);
  }

  // ---------------------------------------------------------------- map

  private bakeMap(map: DungeonMap): void {
    const rt = this.add.renderTexture(0, 0, map.width * TILE, map.height * TILE).setOrigin(0).setDepth(0);
    rt.beginDraw();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = cellIndex(map, x, y);
        const frame = map.frames[i];
        if (!frame) continue;
        // Forest "walls" are trees standing on grass.
        rt.batchDrawFrame("tiles", frame, x * TILE, y * TILE);
        const overlay = map.overlays[i];
        if (overlay && !overlay.startsWith("torch")) rt.batchDrawFrame("tiles", overlay, x * TILE, y * TILE);
      }
    }
    rt.endDraw();

    for (const [key, overlay] of Object.entries(map.overlays)) {
      if (!overlay.startsWith("torch")) continue;
      const i = Number(key);
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      const sprite = this.add.image(x * TILE, y * TILE, "tiles", "torch.1").setOrigin(0).setDepth(1);
      this.torches.push({ sprite, x: x + 0.5, y: y + 0.9, phase: Math.random() * 10 });
    }
  }

  private drawObjects(map: DungeonMap): void {
    for (const o of map.objects) {
      if (o.state === "hidden") continue;
      // Tall objects (trees, statues) are sorted with the figures.
      const depth = o.blocking ? 100 + o.y * 10 : 2;
      this.add.image(o.x * TILE, o.y * TILE, "tiles", o.frame).setOrigin(0).setDepth(depth);
    }
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
    if (c.appearance) {
      // No name labels: the coloured ring shows whose figure it is.
      for (const frame of dollFrames(c.appearance.look)) container.add(this.add.image(0, 0, "tiles", frame));
    } else if (c.monsterId) {
      container.add(this.add.image(0, 0, "tiles", `monster.${c.monsterId}`));
    }
    container.setScale(n);
    const figure: Figure = { container };
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
    if (animate) this.tweens.add({ targets: f.container, x, y, duration: 220, ease: "Sine.easeInOut" });
    else f.container.setPosition(x, y);
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
    this.fogDirty = true;
    this.focusParty(false);
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
        .text(pos.x, pos.y - 18, text, { fontFamily: "system-ui, sans-serif", fontSize: hit.crit ? "44px" : "32px", fontStyle: "bold", color, stroke: "#000", strokeThickness: 6 })
        .setOrigin(0.5)
        .setScale(0.5)
        .setDepth(6000);
      this.tweens.add({ targets: label, y: pos.y - 52, alpha: 0, delay: 250 + i * 120, duration: 1300, ease: "Cubic.easeOut", onComplete: () => label.destroy() });
      if (f && !hit.miss && !hit.heal) {
        const images = f.container.list.filter((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image);
        images.forEach((img) => img.setTintFill(0xff3030));
        this.tweens.add({ targets: f.container, x: pos.x + 3, duration: 50, yoyo: true, repeat: 2 });
        this.time.delayedCall(160, () => images.forEach((img) => img.clearTint()));
      }
    });
  }

  /** In combat the initiative bar takes the left edge; the map moves next to it. */
  setCombatLayout(on: boolean): void {
    const left = on ? 340 : 0;
    this.cameras.main.setViewport(left, 0, BOARD_WIDTH - left, BOARD_HEIGHT);
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
    const erase = (cx: number, cy: number, radius: number) => {
      this.lightBrush.setScale((radius * 2 * TILE) / 256);
      dark.erase(this.lightBrush, cx * TILE, cy * TILE);
    };
    for (const id of this.session.partyIds) {
      const c = this.session.battle.creatures[id];
      if (!c?.pos || c.dead) continue;
      const f = this.figures.get(id);
      const x = f ? f.container.x / TILE : c.pos.x + 0.5;
      const y = f ? f.container.y / TILE : c.pos.y + 0.5;
      const radius = !this.session.map.dark
        ? HERO_LIGHT
        : c.effects.some((e) => e.id === "torch")
          ? NIGHT_TORCH
          : c.darkvisionFt > 0
            ? NIGHT_DARKVISION
            : NIGHT_NONE;
      erase(x, y, radius + Math.sin(time / 180 + x) * 0.12);
    }
    for (const t of this.torches) {
      const flicker = Math.sin(time / 90 + t.phase) * 0.15 + Math.sin(time / 37 + t.phase * 3) * 0.1;
      erase(t.x, t.y, TORCH_LIGHT + flicker);
    }
    dark.draw(this.unexploredImage, 0, 0);
  }

  override update(time: number): void {
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
