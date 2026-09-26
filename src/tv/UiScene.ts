import Phaser from "phaser";
import { dollFrames } from "../shared/doll";
import type { OrderEntry, RollOutcome } from "../shared/view";
import { assetUrl } from "../ui/atlas";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./DungeonScene";

const FONT = "system-ui, sans-serif";

/** Screen-space overlay on top of the zoomed dungeon: room names, turn, initiative bar, roll results. */
export class UiScene extends Phaser.Scene {
  private banner!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private turnBox!: Phaser.GameObjects.Graphics;
  private rollBox!: Phaser.GameObjects.Container;
  private orderBar!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "ui", active: true });
  }

  preload(): void {
    if (!this.textures.exists("tiles")) this.load.atlas("tiles", assetUrl("atlas.png"), assetUrl("atlas.json"));
  }

  create(): void {
    this.orderBar = this.add.container(20, 150);
    this.banner = this.add
      .text(BOARD_WIDTH / 2, 90, "", { fontFamily: FONT, fontSize: "56px", color: "#f3e9d2", stroke: "#000", strokeThickness: 10 })
      .setOrigin(0.5)
      .setAlpha(0);
    this.turnBox = this.add.graphics();
    this.turnText = this.add.text(40, BOARD_HEIGHT - 70, "", { fontFamily: FONT, fontSize: "44px", color: "#fff", stroke: "#000", strokeThickness: 8 }).setOrigin(0, 0.5);
    this.rollBox = this.add.container(BOARD_WIDTH - 40, 40);

    const onRoom = (name: string) => this.showBanner(name);
    const onTurn = (name: string, color?: string) => this.showTurn(name, color);
    const onRoll = (r: RollOutcome) => this.showRoll(r);
    const onOrder = (entries: OrderEntry[]) => this.showOrder(entries);
    const onCombat = (started: boolean) => started && this.showBanner("⚔️ Kampf!");
    this.game.events.on("room-name", onRoom);
    this.game.events.on("turn", onTurn);
    this.game.events.on("roll", onRoll);
    this.game.events.on("order", onOrder);
    this.game.events.on("combat", onCombat);
    // Ask the board for the current state (turn) now that we can show it.
    this.game.events.emit("ui-ready");
    this.events.once("shutdown", () => {
      this.game.events.off("room-name", onRoom);
      this.game.events.off("turn", onTurn);
      this.game.events.off("roll", onRoll);
      this.game.events.off("order", onOrder);
      this.game.events.off("combat", onCombat);
    });
  }

  private showBanner(name: string): void {
    this.banner.setText(name).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 2500, duration: 1200 });
  }

  private showTurn(name: string, color?: string): void {
    this.turnText.setText(`▶ ${name} ist dran`);
    const w = this.turnText.width + 60;
    this.turnBox.clear();
    this.turnBox.fillStyle(0x000000, 0.65).fillRoundedRect(20, BOARD_HEIGHT - 110, w, 80, 16);
    if (color) this.turnBox.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1).fillRoundedRect(20, BOARD_HEIGHT - 110, 12, 80, 6);
  }

  /** Initiative bar on the left edge: portraits in turn order, the active one highlighted. */
  private showOrder(entries: OrderEntry[]): void {
    this.orderBar.removeAll(true);
    const row = 92;
    const visible = entries.slice(0, 9);
    visible.forEach((e, i) => {
      const y = i * row;
      const bg = this.add.graphics();
      const edge = e.active ? 0xe0a526 : e.enemy ? 0x8a2a2a : e.color ? Phaser.Display.Color.HexStringToColor(e.color).color : 0x5a4d42;
      bg.fillStyle(0x14110f, e.active ? 0.95 : 0.8).fillRoundedRect(0, y, e.active ? 320 : 290, row - 10, 14);
      bg.lineStyle(e.active ? 5 : 3, edge, 1).strokeRoundedRect(0, y, e.active ? 320 : 290, row - 10, 14);
      this.orderBar.add(bg);
      const frames = e.look ? dollFrames(e.look) : e.monsterId ? [`monster.${e.monsterId}`] : [];
      for (const f of frames) this.orderBar.add(this.add.image(44, y + 41, "tiles", f).setScale(2));
      const name = this.add.text(88, y + 12, e.name, { fontFamily: FONT, fontSize: "26px", color: e.health <= 0 ? "#8d8172" : "#f3e9d2", fontStyle: e.active ? "bold" : "normal" });
      this.orderBar.add(name);
      if (e.initiative !== undefined) this.orderBar.add(this.add.text(e.active ? 300 : 270, y + 12, String(e.initiative), { fontFamily: FONT, fontSize: "24px", color: "#b3a58a" }).setOrigin(1, 0));
      const hp = this.add.graphics();
      hp.fillStyle(0x3a2f27, 1).fillRect(88, y + 54, 180, 12);
      const pct = Math.max(0, Math.min(1, e.health));
      hp.fillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xe0b030 : 0xe04040, 1).fillRect(88, y + 54, 180 * pct, 12);
      this.orderBar.add(hp);
    });
  }

  /** Big result card with the breakdown, e.g. "🎲 14 + 3 (Stärke) + 2 (Übung) = 19 gegen RK 15 → Treffer!". */
  private showRoll(r: RollOutcome): void {
    this.rollBox.removeAll(true);
    this.tweens.killTweensOf(this.rollBox);
    const width = 860;
    const hasDie = r.dice.length > 0;
    const left = hasDie ? 170 : 30;
    const title = this.add.text(-width + left, 24, r.title, { fontFamily: FONT, fontSize: "36px", color: "#e0a526", fontStyle: "bold" });
    const body = this.add.text(-width + left, 80, r.lines.map((l) => l.text).join("\n"), {
      fontFamily: FONT,
      fontSize: "28px",
      color: "#f3e9d2",
      wordWrap: { width: width - left - 30 },
      lineSpacing: 8,
    });
    const height = Math.max(180, 110 + body.height);
    const bg = this.add.graphics();
    const edge = r.crit ? 0xffd700 : r.success === true ? 0x4caf50 : r.success === false ? 0xe04040 : 0x5a4d42;
    bg.fillStyle(0x14110f, 0.92).fillRoundedRect(-width, 0, width, height, 18);
    bg.lineStyle(6, edge, 1).strokeRoundedRect(-width, 0, width, height, 18);
    this.rollBox.add([bg, title, body]);
    if (hasDie) {
      // The die that counts, big enough to read from the sofa.
      const die = this.add.graphics();
      die.fillStyle(r.crit ? 0xb8860b : 0x7a2e22, 1).fillRoundedRect(-width + 24, 24, 120, 120, 20);
      die.lineStyle(4, 0xf3e9d2, 1).strokeRoundedRect(-width + 24, 24, 120, 120, 20);
      const n = this.add.text(-width + 84, 76, String(r.kept), { fontFamily: FONT, fontSize: "68px", fontStyle: "bold", color: "#fff", stroke: "#000", strokeThickness: 6 }).setOrigin(0.5);
      const sides = this.add.text(-width + 84, 128, `W${r.sides}`, { fontFamily: FONT, fontSize: "20px", color: "#f3e9d2" }).setOrigin(0.5);
      this.rollBox.add([die, n, sides]);
      if (r.dice.length > 1) {
        const other = r.dice.find((d, i) => d !== r.kept || i > 0 && r.dice[0] === r.kept) ?? r.dice[1]!;
        this.rollBox.add(this.add.text(-width + 84, 162, `(auch: ${other})`, { fontFamily: FONT, fontSize: "20px", color: "#b3a58a" }).setOrigin(0.5));
      }
      n.setScale(1.6);
      this.tweens.add({ targets: n, scale: 1, duration: 300, ease: "Back.easeOut" });
    }
    this.rollBox.setAlpha(1);
    this.tweens.add({ targets: this.rollBox, alpha: 0, delay: 5000 + r.lines.length * 700, duration: 800 });
  }
}
