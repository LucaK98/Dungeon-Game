import Phaser from "phaser";
import { dollFrames } from "../shared/doll";
import { assetUrl } from "../ui/atlas";
import type { GameHost } from "./host";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;

/** Placeholder until A3 draws the dungeon: shows the assembled party. */
export class BoardScene extends Phaser.Scene {
  constructor(private host: GameHost) {
    super("board");
  }

  preload(): void {
    this.load.atlas("tiles", assetUrl("atlas.png"), assetUrl("atlas.json"));
  }

  create(): void {
    const cx = BOARD_WIDTH / 2;
    this.add.text(cx, 200, "Die Heldengruppe", { fontFamily: "system-ui, sans-serif", fontSize: "96px", color: "#e0a526" }).setOrigin(0.5);
    const players = this.host.lobby.players.filter((p) => p.profile);
    players.forEach((p, i) => {
      const x = cx + (i - (players.length - 1) / 2) * 360;
      for (const frame of dollFrames(p.profile!.look)) this.add.image(x, 520, "tiles", frame).setScale(8);
      this.add.text(x, 700, p.profile!.name, { fontFamily: "system-ui, sans-serif", fontSize: "48px", color: p.profile!.color }).setOrigin(0.5);
    });
  }
}
