import Phaser from "phaser";
import { BOARD_WIDTH } from "./DungeonScene";

/** Screen-space overlay on top of the zoomed dungeon (room names, later initiative bar and narration). */
export class UiScene extends Phaser.Scene {
  private banner!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "ui", active: true });
  }

  create(): void {
    this.banner = this.add
      .text(BOARD_WIDTH / 2, 90, "", { fontFamily: "system-ui, sans-serif", fontSize: "56px", color: "#f3e9d2", stroke: "#000", strokeThickness: 10 })
      .setOrigin(0.5)
      .setAlpha(0);
    const show = (name: string) => {
      this.banner.setText(name).setAlpha(1);
      this.tweens.killTweensOf(this.banner);
      this.tweens.add({ targets: this.banner, alpha: 0, delay: 2500, duration: 1200 });
    };
    this.game.events.on("room-name", show);
    this.events.once("shutdown", () => this.game.events.off("room-name", show));
  }
}
