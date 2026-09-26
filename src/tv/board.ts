import Phaser from "phaser";
import { BOARD_HEIGHT, BOARD_WIDTH, BoardScene } from "./BoardScene";
import type { GameHost } from "./host";

/** The Phaser game board (dungeon view arrives in A3). */
export function startBoard(root: HTMLElement, host: GameHost): () => void {
  const container = document.createElement("div");
  container.className = "tv";
  root.append(container);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    backgroundColor: "#14110f",
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new BoardScene(host)],
  });
  return () => {
    game.destroy(true);
    container.remove();
  };
}
