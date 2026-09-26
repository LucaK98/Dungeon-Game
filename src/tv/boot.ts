import Phaser from "phaser";
import type { Route } from "../shared/route";
import { BOARD_HEIGHT, BOARD_WIDTH, BoardScene } from "./BoardScene";

export function startTv(root: HTMLElement, _route: Extract<Route, { view: "tv" }>): () => void {
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
    scene: [BoardScene],
  });

  return () => game.destroy(true);
}
