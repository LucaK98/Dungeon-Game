import Phaser from "phaser";
import { Director, newStoryState, type StoryResult, type StoryState } from "../dm/director";
import { sceneById, sceneRooms } from "../dm/planner";
import { ScriptedDM } from "../dm/scripted";
import { AiDM, type AiStatus } from "../dm/ai/aidm";
import { countAiCall, loadAiSettings, providersFrom } from "../dm/ai/settings";
import { randomRng, seededRng, type Rng } from "../engine/rng";
import type { Creature } from "../shared/game";
import type { Duration, Story } from "../shared/story";
import { BOARD_HEIGHT, BOARD_WIDTH, DungeonScene } from "./DungeonScene";
import { endScreen } from "./end-screen";
import { GameController } from "./game";
import type { GameHost } from "./host";
import { clearSave, writeSave } from "./save";
import { createSession, type GameSession } from "./session";
import { UiScene } from "./UiScene";

export interface BoardOptions {
  seed?: number;
  demo?: boolean;
  story?: { story: Story; duration: Duration };
  /** Continue a saved game. */
  resume?: { state: StoryState; heroes: Creature[] };
  /** Called when the story is over and the players want to go back. */
  onExit?: () => void;
}

/** The Phaser game board plus the game controller (and, for stories, the director). */
export function startBoard(root: HTMLElement, host: GameHost, opts: BoardOptions = {}): () => void {
  const container = document.createElement("div");
  container.className = "tv";
  root.append(container);
  const rng: Rng = opts.seed !== undefined ? seededRng(opts.seed) : randomRng();
  const players = () => host.lobby.players.filter((p) => p.profile).map((p) => ({ playerId: p.id, profile: p.profile! }));

  const newSession = (): GameSession => {
    if (opts.story) {
      const first = sceneById(opts.story.story, (opts.resume?.state ?? newStoryState(opts.story.story, rng, opts.story.duration)).plan[0]!);
      const session = createSession(rng, { players: players(), plan: { path: sceneRooms(first, opts.story.duration) }, noMonsters: true });
      if (opts.resume) {
        for (const h of opts.resume.heroes) session.battle.creatures[h.id] = structuredClone(h);
      }
      return session;
    }
    return createSession(rng, { players: players() });
  };
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
  let uiReady = false;
  const early: import("../shared/story").Narration[] = [];
  let closeEnd: (() => void) | undefined;
  const wire = () => {
    controller?.destroy();
    const c = new GameController(
      session,
      rng,
      (playerId, event) => host.transport.send(event, playerId),
      (event) => host.transport.send(event),
      { autoHeroes: !!opts.demo },
    );
    controller = c;
    c.on({
      changed: () => {
        if (scene.sys.isActive()) scene.refresh();
        game.events.emit("order", c.mode === "combat" ? c.orderEntries() : []);
        if (c.storyView) game.events.emit("chapter", c.storyView.chapter);
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
      narration: (lines) => {
        // The UI scene may not exist yet (story intro): keep the lines until it is ready.
        if (uiReady) game.events.emit("narration", lines);
        else early.push(...lines);
      },
      mapChanged: () => {
        if (scene.sys.isActive() || scene.sys.isPaused()) scene.scene.restart();
      },
    });
    c.start();
    // Test hook for browser play-throughs (dev server only, not in the published build).
    if (import.meta.env.DEV) (window as unknown as { __couchTv?: unknown }).__couchTv = { game: c };

    if (opts.story) {
      const { story, duration } = opts.story;
      const state = opts.resume ? structuredClone(opts.resume.state) : newStoryState(story, rng, duration);
      const providers = providersFrom(loadAiSettings(), host.lobby.room);
      let aiStatus: AiStatus | undefined = providers ? { kind: "ok", model: providers[0]!.model } : undefined;
      const showAi = () => game.events.emit("ai-status", aiStatus);
      const dm = providers
        ? new AiDM(story, providers, {
            onCall: countAiCall,
            onStatus: (s) => {
              aiStatus = s;
              showAi();
            },
          })
        : new ScriptedDM(story);
      // Also after the UI scene restarts (new map).
      game.events.on("ui-ready", showAi);
      if (uiReady) showAi();
      const director = new Director(story, state, c, dm, rng, {
        duration,
        onSave: (saved) => {
          writeSave({ savedAt: Date.now(), state: { ...saved, minutesBefore: director.minutesPlayed() }, heroes: c.heroes().map((h) => structuredClone(h)), players: host.lobby.players });
          c.narrate([{ text: "💾 Speicherpunkt erreicht. Ihr könnt das Spiel hier später fortsetzen." }]);
        },
        onEnd: (result: StoryResult) => {
          clearSave();
          // Let the last narration run before showing the summary.
          setTimeout(() => {
            closeEnd = endScreen(root, result, () => {
              closeEnd?.();
              opts.onExit?.();
            });
          }, 9000);
        },
      });
      void director.run();
    }
  };
  wire();

  game.events.on("ui-ready", () => {
    uiReady = true;
    if (early.length) game.events.emit("narration", early.splice(0));
    controller?.announceTurn();
    if (controller?.storyView) game.events.emit("chapter", controller.storyView.chapter);
  });

  host.onPlayerEvent((e, from) => {
    if (e.type === "player_action") controller?.handle(from, e.action);
  });
  host.onSeatMoved((oldId, newId) => controller?.reassignPlayer(oldId, newId));
  // A phone that (re)connects gets its view again.
  const offLobby = host.onChange(() => controller?.broadcast());

  // Keyboard helpers on the TV (demo mode): R = new random dungeon, F = demo fight.
  const onKey = (e: KeyboardEvent) => {
    if (!opts.demo) return;
    if (e.key === "f" || e.key === "F") controller?.spawnNearParty(["goblin", "goblin", "goblin"]);
    if (e.key === "r" || e.key === "R") {
      session = newSession();
      wire();
      scene.scene.restart();
    }
  };
  window.addEventListener("keydown", onKey);

  return () => {
    offLobby();
    closeEnd?.();
    controller?.destroy();
    window.removeEventListener("keydown", onKey);
    game.destroy(true);
    container.remove();
  };
}
