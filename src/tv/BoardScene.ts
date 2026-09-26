import Phaser from "phaser";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;

/** Placeholder until A3 draws the dungeon. */
export class BoardScene extends Phaser.Scene {
  constructor() {
    super("board");
  }

  create(): void {
    const cx = BOARD_WIDTH / 2;
    this.add
      .text(cx, 420, "Couch-Dungeon", { fontFamily: "system-ui, sans-serif", fontSize: "120px", color: "#e0a526" })
      .setOrigin(0.5);
    this.add
      .text(cx, 580, "Spielbrett bereit. Hier entsteht bald der Dungeon.", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "48px",
        color: "#f3e9d2",
      })
      .setOrigin(0.5);
  }
}
