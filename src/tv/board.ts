import Phaser from "phaser";
import { randomRng, seededRng, type Rng } from "../engine/rng";
import { BOARD_HEIGHT, BOARD_WIDTH, DungeonScene } from "./DungeonScene";
import { GameController } from "./game";
import type { GameHost } from "./host";
import { createSession, type GameSession } from "./session";
import { UiScene } from "./UiScene";

/** The Phaser game board plus the game controller that drives it. */
export function startBoard(root: HTMLElement, host: GameHost, seed?: number): () => void {
  const container = document.createElement("div");
  container.className = "tv";
  root.append(container);
  const rng: Rng = seed !== undefined ? seededRng(seed) : randomRng();

  const newSession = (): GameSession =>
    createSession(rng, {
      players: host.lobby.players.filter((p) => p.profile).map((p) => ({ playerId: p.id, profile: p.profile! })),
    });
  let session = newSession();
  const scene = new DungeonScene(() => session);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    backgroundColor: "#000000",
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene, UiScene],
  });

  let controller: GameController;
  const wire = () => {
    controller = new GameController(
      session,
      rng,
      (playerId, event) => host.transport.send(event, playerId),
      (event) => host.transport.send(event),
    );
    controller.on({
      changed: () => scene.sys.isActive() && scene.refresh(),
      turn: (name, color) => game.events.emit("turn", name, color),
      roll: (r) => game.events.emit("roll", r),
      roomRevealed: (name) => scene.showRoomName(name),
    });
    controller.start();
  };
  wire();

  game.events.on("ui-ready", () => controller.announceTurn());

  host.onPlayerEvent((e, from) => {
    if (e.type === "player_action") controller.handle(from, e.action);
  });
  // A phone that (re)connects gets its view again.
  const offLobby = host.onChange(() => controller.broadcast());

  // Keyboard helper on the TV: R = new random dungeon.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      session = newSession();
      wire();
      scene.scene.restart();
    }
  };
  window.addEventListener("keydown", onKey);

  return () => {
    offLobby();
    window.removeEventListener("keydown", onKey);
    game.destroy(true);
    container.remove();
  };
}
