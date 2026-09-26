import Phaser from "phaser";
import { randomRng, seededRng, type Rng } from "../engine/rng";
import { BOARD_HEIGHT, BOARD_WIDTH, DungeonScene } from "./DungeonScene";
import { GameController } from "./game";
import type { GameHost } from "./host";
import { createSession, type GameSession } from "./session";
import { UiScene } from "./UiScene";

/** The Phaser game board plus the game controller that drives it. */
export function startBoard(root: HTMLElement, host: GameHost, opts: { seed?: number; demo?: boolean } = {}): () => void {
  const seed = opts.seed;
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

  let controller: GameController | undefined;
  const wire = () => {
    controller?.destroy();
    controller = new GameController(
      session,
      rng,
      (playerId, event) => host.transport.send(event, playerId),
      (event) => host.transport.send(event),
      { autoHeroes: !!opts.demo },
    );
    controller.on({
      changed: () => {
        if (scene.sys.isActive()) scene.refresh();
        game.events.emit("order", controller!.mode === "combat" ? controller!.orderEntries() : []);
      },
      turn: (name, color) => game.events.emit("turn", name, color),
      roll: (r) => {
        game.events.emit("roll", r);
        if (scene.sys.isActive() && r.hits?.length) scene.showHits(r.hits);
      },
      roomRevealed: (name) => scene.showRoomName(name),
      combat: (started) => {
        game.events.emit("combat", started);
        if (scene.sys.isActive()) scene.setCombatLayout(started);
      },
    });
    controller.start();
  };
  wire();

  game.events.on("ui-ready", () => controller?.announceTurn());

  host.onPlayerEvent((e, from) => {
    if (e.type === "player_action") controller?.handle(from, e.action);
  });
  // A phone that (re)connects gets its view again.
  const offLobby = host.onChange(() => controller?.broadcast());

  // Keyboard helpers on the TV: R = new random dungeon, F = demo fight (demo mode only).
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === "f" || e.key === "F") && opts.demo) controller?.spawnNearParty(["goblin", "goblin", "goblin"]);
    if (e.key === "r" || e.key === "R") {
      session = newSession();
      wire();
      scene.scene.restart();
    }
  };
  window.addEventListener("keydown", onKey);

  return () => {
    offLobby();
    controller?.destroy();
    window.removeEventListener("keydown", onKey);
    game.destroy(true);
    container.remove();
  };
}
