import Phaser from "phaser";
import { seededRng, randomRng, type Rng } from "../engine/rng";
import { revealAround } from "../map/walk";
import { cellIndex } from "../shared/map";
import { BOARD_HEIGHT, BOARD_WIDTH, DungeonScene } from "./DungeonScene";
import type { GameHost } from "./host";
import { createSession, party, type GameSession } from "./session";
import { UiScene } from "./UiScene";

/** The Phaser game board. */
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

  // Keyboard helpers on the TV (testing without phones): N = next room, R = new dungeon.
  let roomIndex = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      session = newSession();
      roomIndex = 0;
      scene.scene.restart();
    } else if (e.key === "n" || e.key === "N") {
      roomIndex = (roomIndex + 1) % session.map.rooms.length;
      const room = session.map.rooms[roomIndex]!;
      const spots = [...room.spots.party, ...room.spots.npc, ...room.spots.monster];
      const free = [] as { x: number; y: number }[];
      for (let y = room.y + 1; y < room.y + room.h - 1 && free.length < 8; y++) {
        for (let x = room.x + 1; x < room.x + room.w - 1 && free.length < 8; x++) {
          const i = cellIndex(session.map, x, y);
          const occupied = Object.values(session.battle.creatures).some((c) => c.pos?.x === x && c.pos?.y === y);
          if (session.map.cells[i] === "floor" && !occupied && !session.map.objects.some((o) => o.blocking && o.x === x && o.y === y)) free.push({ x, y });
        }
      }
      party(session).forEach((c, i) => (c.pos = spots.find((s) => !Object.values(session.battle.creatures).some((o) => o !== c && o.pos?.x === s.x && o.pos?.y === s.y)) ?? free[i] ?? c.pos));
      party(session).forEach((c) => revealAround(session.map, c.pos!).forEach((r) => scene.showRoomName(session.map.rooms[r]!.name)));
      scene.refresh();
    }
  };
  window.addEventListener("keydown", onKey);

  return () => {
    window.removeEventListener("keydown", onKey);
    game.destroy(true);
    container.remove();
  };
}
