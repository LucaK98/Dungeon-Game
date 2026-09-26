import Phaser from "phaser";
import type { RollOutcome } from "../shared/view";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./DungeonScene";

const FONT = "system-ui, sans-serif";

/** Screen-space overlay on top of the zoomed dungeon: room names, whose turn it is, roll results. */
export class UiScene extends Phaser.Scene {
  private banner!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private turnBox!: Phaser.GameObjects.Graphics;
  private rollBox!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "ui", active: true });
  }

  create(): void {
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
    this.game.events.on("room-name", onRoom);
    this.game.events.on("turn", onTurn);
    this.game.events.on("roll", onRoll);
    // Ask the board for the current state (turn) now that we can show it.
    this.game.events.emit("ui-ready");
    this.events.once("shutdown", () => {
      this.game.events.off("room-name", onRoom);
      this.game.events.off("turn", onTurn);
      this.game.events.off("roll", onRoll);
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

  /** Big result card with the breakdown, e.g. "🎲 14 + 3 (Stärke) + 2 (Übung) = 19 gegen RK 15 → Treffer!". */
  private showRoll(r: RollOutcome): void {
    this.rollBox.removeAll(true);
    this.tweens.killTweensOf(this.rollBox);
    const width = 820;
    const title = this.add.text(-width + 30, 24, r.title, { fontFamily: FONT, fontSize: "36px", color: "#e0a526", fontStyle: "bold" });
    const body = this.add.text(-width + 30, 80, r.lines.map((l) => l.text).join("\n"), {
      fontFamily: FONT,
      fontSize: "28px",
      color: "#f3e9d2",
      wordWrap: { width: width - 60 },
      lineSpacing: 8,
    });
    const height = 110 + body.height;
    const bg = this.add.graphics();
    const edge = r.crit ? 0xffd700 : r.success === true ? 0x4caf50 : r.success === false ? 0xe04040 : 0x5a4d42;
    bg.fillStyle(0x14110f, 0.9).fillRoundedRect(-width, 0, width, height, 18);
    bg.lineStyle(6, edge, 1).strokeRoundedRect(-width, 0, width, height, 18);
    this.rollBox.add([bg, title, body]);
    this.rollBox.setAlpha(1);
    this.tweens.add({ targets: this.rollBox, alpha: 0, delay: 6000 + r.lines.length * 600, duration: 800 });
  }
}
