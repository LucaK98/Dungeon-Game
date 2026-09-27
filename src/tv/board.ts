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
import { formatCode, newCloudId, type CloudId } from "../net/cloud-save";
import { createSession, type GameSession } from "./session";
import { UiScene } from "./UiScene";
import { initRes } from "./render";
import { THEMES } from "../map/modules";
import { cellIndex } from "../shared/map";
import { play, setAmbience, unlockSoundOnGesture } from "../ui/sound";

/** Sounds for a roll on the TV: dice first, then what happened. */
function rollSounds(r: import("../shared/view").RollOutcome): void {
  if (r.title === "Sieg!") return play("victory");
  if (r.title === "Niederlage") return play("defeat");
  const hits = r.hits ?? [];
  const after = () => {
    if (hits.some((h) => h.crit)) play("crit");
    else if (hits.some((h) => !h.miss && !h.heal && h.amount > 0)) play("hit");
    else if (hits.some((h) => h.heal)) play("heal");
    else if (hits.some((h) => h.miss)) play("miss");
  };
  if (r.dice.length) {
    play("dice");
    setTimeout(after, 420);
  } else after();
}

export interface BoardOptions {
  seed?: number;
  demo?: boolean;
  story?: { story: Story; duration: Duration };
  /** Continue a saved game. */
  resume?: { state: StoryState; heroes: Creature[] };
  /** Save code of this game in the cloud (a new one is made if missing). */
  cloud?: CloudId;
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
  const cloud = opts.cloud ?? newCloudId();
  const scene = new DungeonScene(() => session);

  // The canvas has the screen's real resolution; the scenes zoom the 1920×1080 layout onto it.
  const res = initRes(container);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: Math.round(BOARD_WIDTH * res),
    height: Math.round(BOARD_HEIGHT * res),
    backgroundColor: "#000000",
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene, UiScene],
  });

  unlockSoundOnGesture();
  /** Background sound for where the heroes are: wind, crickets, drips or a quiet hum. */
  const updateAmbience = (c: GameController) => {
    const map = c.map;
    const lead = c.heroes().find((h) => h.pos && !h.dead);
    if (!lead?.pos) return;
    const room = map.rooms[map.roomOf[cellIndex(map, lead.pos.x, lead.pos.y)] ?? -1];
    if (!room) return;
    setAmbience({ outdoor: THEMES[room.theme].outdoor, night: !!map.dark, cave: ["cave", "mine", "lair"].includes(room.theme) });
  };
  let controller: GameController | undefined;
  let worldTimer: ReturnType<typeof setInterval> | undefined;
  let uiReady = false;
  const early: import("../shared/story").Narration[] = [];
  let closeEnd: (() => void) | undefined;
  const wire = () => {
    controller?.destroy();
    if (worldTimer) clearInterval(worldTimer);
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
        updateAmbience(c);
        game.events.emit("order", c.mode === "combat" ? c.orderEntries() : []);
        if (c.storyView) game.events.emit("chapter", c.storyView.chapter);
      },
      turn: (name, color, free) => game.events.emit("turn", name, color, free),
      roll: (r) => {
        game.events.emit("roll", r);
        rollSounds(r);
        if (scene.sys.isActive() && r.hits?.length) {
          scene.showHits(r.hits);
          const big = r.hits.some((h) => !h.miss && !h.heal && (h.crit || h.amount >= 10));
          if (big) scene.shake(r.hits.some((h) => h.crit));
        }
      },
      roomRevealed: (name) => scene.showRoomName(name),
      combat: (started) => {
        game.events.emit("combat", started);
        if (started) play("fight");
        if (scene.sys.isActive()) scene.setCombatLayout(started);
      },
      narration: (lines) => {
        if (lines.some((l) => l.text.startsWith("✨"))) play("chime");
        // The UI scene may not exist yet (story intro): keep the lines until it is ready.
        if (uiReady) game.events.emit("narration", lines);
        else early.push(...lines);
      },
      fx: (kind, pos) => {
        if (scene.sys.isActive()) scene.fx(kind, pos);
        play(kind === "puff" ? "thud" : kind === "shake" ? "rumble" : kind === "splash" ? "splash" : "coin");
      },
      spotlight: (id) => {
        if (scene.sys.isActive()) scene.spotlight(id);
        play("boss");
      },
      mapChanged: () => {
        if (scene.sys.isActive() || scene.sys.isPaused()) scene.scene.restart();
      },
    });
    c.start();
    // Characters stroll, guards patrol.
    worldTimer = setInterval(() => c.tickWorld(), 3000);
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
        world: true,
        onSave: (saved, announce) => {
          // Every scene is saved (here and, with the code, online); long games announce their save points.
          void writeSave({ savedAt: Date.now(), state: { ...saved, minutesBefore: director.minutesPlayed() }, heroes: c.heroes().map((h) => structuredClone(h)), players: host.lobby.players, cloud }).then((online) =>
            // The board is rebuilt for the new scene: show the note once it is back.
            setTimeout(() => {
              game.events.emit("saved", online ? formatCode(cloud.code) : undefined);
              if (announce) c.narrate([{ text: `💾 Speicherpunkt erreicht. Ihr könnt das Spiel später fortsetzen${online ? ` – auch an einem anderen Gerät mit dem Code ${formatCode(cloud.code)}` : ""}.` }]);
            }, 2500),
          );
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
    if (worldTimer) clearInterval(worldTimer);
    setAmbience(undefined);
    closeEnd?.();
    controller?.destroy();
    window.removeEventListener("keydown", onKey);
    game.destroy(true);
    container.remove();
  };
}
