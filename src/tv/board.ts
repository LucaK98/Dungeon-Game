import Phaser from "phaser";
import { loadSaga, loadVillage, saveSaga, saveVillage } from "./homeland-store";
import { markCarried, sagaCarry, villageIncome, type SagaEntry } from "../shared/homeland";
import { Director, newStoryState, type StoryResult, type StoryState } from "../dm/director";
import { sceneById, sceneRooms } from "../dm/planner";
import { ScriptedDM } from "../dm/scripted";
import { AiDM, type AiStatus } from "../dm/ai/aidm";
import { countAiCall, loadAiSettings, providersFrom } from "../dm/ai/settings";
import { randomRng, seededRng, type Rng } from "../engine/rng";
import type { Creature } from "../shared/game";
import type { RollOutcome } from "../shared/view";
import type { Difficulty } from "../shared/difficulty";
import type { Duration, Story } from "../shared/story";
import { BOARD_HEIGHT, BOARD_WIDTH, DungeonScene } from "./DungeonScene";
import { endScreen } from "./end-screen";
import { GameController } from "./game";
import type { GameHost } from "./host";
import { clearSave, writeSave } from "./save";
import { formatCode, newCloudId, type CloudId } from "../net/cloud-save";
import { createSession, type GameSession } from "./session";
import { UiScene } from "./UiScene";
import { initRes, loadCrude } from "./render";
import { THEMES } from "../map/modules";
import { cellIndex } from "../shared/map";
import { play, setAmbience, unlockSoundOnGesture } from "../ui/sound";
import { setMood } from "../ui/music";
import { settingsScreen } from "./settings";
import { loadNpcWorld, saveNpcWorld } from "./npc-store";
import { bondLabel, bondOf, familyView, findMind, loveLabel, loveOf, nameChild, setChildWish, setSquire, squireOf } from "../dm/npc-world";
import { castCharacter } from "./voice/cast";
import { MIRRORED_SCENE, MIRRORED_UI, MirrorHost } from "./mirror";
import { openStream } from "../net/stream";

/** Sounds for a roll on the TV: dice first, then what happened. */
/** How long the die tumbles on the TV before it lands (ms). */
const TUMBLE_ASKED = 900;
const TUMBLE_QUICK = 450;

/** Sounds, music and background noise also go to viewers at home (src/tv/mirror.ts). */
let mirror: MirrorHost | undefined;
let lastMood: Parameters<typeof setMood>[0] | undefined;
let lastAmbience: Parameters<typeof setAmbience>[0];
function sfx(name: Parameters<typeof play>[0]): void {
  play(name);
  mirror?.push({ k: "sound", n: name });
}
function moodTo(m: Parameters<typeof setMood>[0]): void {
  setMood(m);
  if (m !== lastMood) mirror?.push({ k: "mood", mood: m });
  lastMood = m;
}
function ambienceTo(a: Parameters<typeof setAmbience>[0]): void {
  setAmbience(a);
  if (JSON.stringify(a) !== JSON.stringify(lastAmbience)) mirror?.push({ k: "mood", ambience: a ?? null });
  lastAmbience = a;
}

function rollSounds(r: RollOutcome, impactMs = 0, tumbled = false): void {
  if (r.title === "Sieg!") return sfx("victory");
  if (r.title === "Niederlage") return sfx("defeat");
  const hits = r.hits ?? [];
  const after = () => {
    if (hits.some((h) => h.crit)) sfx("crit");
    else if (hits.some((h) => !h.miss && !h.heal && h.amount > 0)) sfx("hit");
    else if (hits.some((h) => h.heal)) sfx("heal");
    else if (hits.some((h) => h.miss)) sfx("miss");
  };
  if (r.dice.length) {
    if (!tumbled) sfx("dice");
    setTimeout(after, Math.max(420, impactMs));
  } else setTimeout(after, impactMs);
}

export interface BoardOptions {
  seed?: number;
  demo?: boolean;
  story?: { story: Story; duration: Duration; difficulty?: Difficulty };
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
  const difficulty: Difficulty = opts.resume?.state.difficulty ?? opts.story?.difficulty ?? "normal";
  const players = () => host.lobby.players.filter((p) => p.profile).map((p) => ({ playerId: p.id, profile: p.profile! }));
  // The home village and the saga of earlier adventures (kept on this TV).
  const village = loadVillage();
  const saga = loadSaga();
  const carry = opts.story && !opts.resume ? sagaCarry(saga) : {};

  const newSession = (): GameSession => {
    if (opts.story) {
      const first = sceneById(opts.story.story, (opts.resume?.state ?? newStoryState(opts.story.story, rng, opts.story.duration)).plan[0]!);
      // Teenage children who were asked along come as squires.
      const kin = loadNpcWorld();
      const squires = Object.fromEntries(players().flatMap((p) => ((kid) => (kid ? [[p.profile.name, { name: kid.name }]] : []))(squireOf(kin, p.profile.name))));
      const session = createSession(rng, { players: players(), plan: { path: sceneRooms(first, opts.story.duration) }, noMonsters: true, difficulty, village: village.built, squires });
      if (opts.resume) {
        for (const h of opts.resume.heroes) session.battle.creatures[h.id] = structuredClone(h);
      }
      return session;
    }
    // Demo mode can be asked for certain rooms: #/tv?demo&rooms=wirtshaus,gruft
    const rooms = opts.demo ? new URLSearchParams(location.hash.split("?")[1] ?? "").get("rooms") : null;
    return createSession(rng, { players: players(), ...(rooms ? { plan: { path: rooms.split(",") } } : {}) });
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

  // Viewers at home (#/watch) see and hear the same board: UI events, board effects and state go out.
  const emitRaw = game.events.emit.bind(game.events);
  game.events.emit = ((name: string | symbol, ...args: unknown[]) => {
    if (typeof name === "string" && MIRRORED_UI.has(name)) mirror?.ui(name, args);
    return emitRaw(name, ...args);
  }) as typeof game.events.emit;
  const sceneApi = scene as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const m of MIRRORED_SCENE) {
    const orig = sceneApi[m]!.bind(scene);
    sceneApi[m] = (...args: unknown[]) => {
      mirror?.scene(m, args);
      return orig(...args);
    };
  }
  const refreshBoard = scene.refresh.bind(scene);
  scene.refresh = () => {
    mirror?.changed();
    refreshBoard();
  };
  void openStream(host.lobby.room, host.net === "local")
    .then((stream) => {
      mirror = new MirrorHost(stream, () => session, () => {
        const c = controller;
        const m = mirror;
        if (!c || !m) return;
        m.scene("setCombatLayout", [c.mode === "combat"]);
        m.ui("combat", [c.mode === "combat"]);
        m.ui("log", [c.recentLog(14), 0]);
        m.ui("order", [c.mode === "combat" || !c.freeExplore ? c.orderEntries() : []]);
        if (c.storyView) {
          m.ui("chapter", [c.storyView.chapter, c.storyView.goal]);
          m.ui("notes", [c.storyView.tasks ?? [], c.storyView.moreTasks ?? 0, c.storyView.clues.map((x) => x.text)]);
        }
        if (lastAi) m.ui("ai-status", [lastAi]);
        m.push({ k: "mood", ...(lastMood ? { mood: lastMood } : {}), ambience: lastAmbience ?? null });
      });
    })
    .catch(() => {
      // No stream (offline): the game works without viewers.
    });
  let lastAi: unknown;
  /** Background sound for where the heroes are: wind, crickets, drips or a quiet hum. */
  const updateAmbience = (c: GameController) => {
    const map = c.map;
    const lead = c.heroes().find((h) => h.pos && !h.dead);
    if (!lead?.pos) return;
    const room = map.rooms[map.roomOf[cellIndex(map, lead.pos.x, lead.pos.y)] ?? -1];
    if (!room) return;
    ambienceTo({ outdoor: THEMES[room.theme].outdoor, night: !!map.dark, cave: ["cave", "mine", "lair"].includes(room.theme) });
    // Music: the fight decides; otherwise the place.
    if (c.mode === "combat") moodTo(c.enemiesInFight().some((e) => e.boss) ? "boss" : "fight");
    else if (map.dark || ["cave", "mine", "lair", "crypt"].includes(room.theme)) moodTo("night");
    else if (["village", "town", "tavern"].includes(room.theme)) moodTo("town");
    else if (THEMES[room.theme].outdoor) moodTo("wild");
    else moodTo("halls");
  };
  let controller: GameController | undefined;
  let worldTimer: ReturnType<typeof setInterval> | undefined;
  let uiReady = false;
  let earlyScene: { title: string; goal: string } | undefined;
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
      { autoHeroes: !!opts.demo, turnBasedExplore: true },
    );
    controller = c;
    c.crude = loadCrude();
    c.difficulty = difficulty;
    c.village = [...village.built];
    // Lines already in the TV's log column.
    let shownLog = -1;
    // Who the TV is waiting on to roll (the hero whose phone shows the die).
    let askedFor: string | undefined;
    const showHitsLater = (hits: NonNullable<RollOutcome["hits"]>, delay: number) =>
      scene.time.delayedCall(delay, () => {
        scene.showHits(hits);
        const big = hits.some((h) => !h.miss && !h.heal && (h.crit || h.amount >= 10));
        if (big) scene.shake(hits.some((h) => h.crit));
      });
    c.on({
      changed: () => {
        if (scene.sys.isActive()) scene.refresh();
        if (c.logCount !== shownLog) {
          const added = shownLog < 0 ? 0 : c.logCount - shownLog;
          shownLog = c.logCount;
          game.events.emit("log", c.recentLog(14), added);
        }
        updateAmbience(c);
        // The group at the left edge: in fights and when exploring in turns (who is next).
        game.events.emit("order", c.mode === "combat" || !c.freeExplore ? c.orderEntries() : []);
        if (c.storyView) {
          game.events.emit("chapter", c.storyView.chapter, c.storyView.goal);
          game.events.emit("notes", c.storyView.tasks ?? [], c.storyView.moreTasks ?? 0, c.storyView.clues.map((x) => x.text));
        }
      },
      clock: (seconds) => game.events.emit("clock", seconds),
      round: (ended) => game.events.emit("round", ended),
      flash: (text) => game.events.emit("flash", text),
      scene: (title, goal) => {
        // The first scene starts before the TV's overlay is ready: shown as soon as it is.
        if (uiReady) game.events.emit("scene-card", title, goal);
        else earlyScene = { title, goal };
      },
      turn: (name, color, free, info) => {
        askedFor = undefined;
        if (scene.sys.isActive()) scene.clearAim();
        game.events.emit("turn", name, color, free, info);
      },
      askCancelled: () => {
        askedFor = undefined;
        if (scene.sys.isActive()) scene.clearAim();
        game.events.emit("ask-cancel");
      },
      asked: (prompt, id, name, color) => {
        askedFor = id;
        game.events.emit("asked", prompt, name, color);
        if (scene.sys.isActive() && prompt.targetIds?.length) scene.showAim(id, prompt.targetIds);
      },
      roll: (r) => {
        // The die tumbles on the TV first (longer when everybody waited for this throw).
        const tumble = r.dice.length ? (askedFor === r.creatureId ? TUMBLE_ASKED : TUMBLE_QUICK) : 0;
        askedFor = undefined;
        game.events.emit("roll", r, tumble);
        if (scene.sys.isActive()) setTimeout(() => scene.sys.isActive() && scene.clearAim(), tumble + 400);
        if (tumble) sfx("dice");
        // First the swing, arrow or spell, then the numbers where it lands.
        const start = () => {
          const impact = scene.sys.isActive() ? scene.playFx(r.fx) : 0;
          rollSounds(r, impact, tumble > 0);
          if (scene.sys.isActive() && r.hits?.length) showHitsLater(r.hits, impact);
        };
        // A hero who walks up first strikes when arrived, never from mid-way (the walk starts with the
        // board update right after this, so look a moment later).
        setTimeout(() => {
          const wait = Math.max(tumble, scene.sys.isActive() ? scene.walkRemaining() : 0);
          if (wait) setTimeout(start, wait);
          else start();
        }, 0);
      },
      roomRevealed: (name) => scene.showRoomName(name),
      combat: (started) => {
        game.events.emit("combat", started);
        updateAmbience(c);
        if (started) sfx("fight");
        if (scene.sys.isActive()) scene.setCombatLayout(started);
      },
      point: (id, at, path) => {
        if (scene.sys.isActive()) scene.showPoint(id, at, path);
      },
      speech: (id, text) => {
        if (scene.sys.isActive()) scene.showSpeech(id, text);
      },
      narration: (lines) => {
        // NPCs talk with a bubble over their figure too.
        if (scene.sys.isActive()) for (const l of lines) if (l.npc) scene.showSpeechByName(l.npc, l.text);
        if (lines.some((l) => l.text.startsWith("✨"))) sfx("chime");
        // The UI scene may not exist yet (story intro): keep the lines until it is ready.
        if (uiReady) game.events.emit("narration", lines);
        else early.push(...lines);
      },
      banner: (info) => game.events.emit("info-banner", info),
      travel: (t) => {
        game.events.emit("travel", t);
        if (t?.chosen !== undefined) sfx("chime");
      },
      vote: (state) => {
        game.events.emit("vote", state);
        if (state?.cast) sfx("pop");
      },
      camp: (state) => {
        game.events.emit("camp", state);
        if (state) moodTo("town");
        else updateAmbience(c);
      },
      reward: (r) => {
        const active = scene.sys.isActive();
        if (r.kind === "gold") {
          if (active) scene.showGain(r.heroId, `+${r.amount} 💰`);
          sfx("coin");
          return;
        }
        if (r.kind === "item") {
          if (active) scene.showGain(r.heroId, `+${r.qty} ${r.icon}`, "#b8f5c0");
          sfx("pop");
          return;
        }
        if (active) scene.showGain(r.heroId, r.kind === "level" ? `⬆️ Stufe ${r.level}` : `${r.icon} ${r.title}`);
        sfx(r.kind === "level" ? "victory" : "chime");
        game.events.emit("reward", r, c.battle.creatures[r.heroId]?.appearance?.look);
      },
      emote: (id, emoji) => {
        if (scene.sys.isActive()) scene.showEmote(id, emoji);
        sfx("pop");
      },
      fx: (kind, pos) => {
        if (scene.sys.isActive()) scene.fx(kind, pos);
        sfx(kind === "puff" ? "thud" : kind === "shake" ? "rumble" : kind === "splash" ? "splash" : "coin");
      },
      spotlight: (id) => {
        if (scene.sys.isActive()) scene.spotlight(id);
        sfx("boss");
      },
      mapChanged: () => {
        if (scene.sys.isActive() || scene.sys.isPaused()) scene.scene.restart();
        mirror?.sendMap();
      },
    });
    // Known weaknesses show over the foes.
    scene.typesOf = (x) => c.knownTypes(x);
    // While the TV tells the story, the phones wait.
    // (A new controller replaces the listener of the one before.)
    game.events.off("narrating");
    game.events.on("narrating", (on: boolean) => c.setNarrating(on));
    c.start();
    // Characters stroll, guards patrol.
    worldTimer = setInterval(() => c.tickWorld(), 3000);
    // Test hook for browser play-throughs (dev server only, not in the published build).
    if (import.meta.env.DEV) (window as unknown as { __couchTv?: unknown }).__couchTv = { game: c, scene };

    if (opts.story) {
      const { story, duration } = opts.story;
      const state = opts.resume ? structuredClone(opts.resume.state) : { ...newStoryState(story, rng, duration), difficulty };
      const providers = providersFrom(loadAiSettings(), host.lobby.room);
      let aiStatus: AiStatus | undefined = providers ? { kind: "ok", model: providers[0]!.model } : undefined;
      const showAi = () => game.events.emit("ai-status", aiStatus);
      const dm = providers
        ? new AiDM(story, providers, {
            onCall: countAiCall,
            onStatus: (s) => {
              aiStatus = s;
              lastAi = s;
              showAi();
            },
          })
        : new ScriptedDM(story);
      // Also after the UI scene restarts (new map).
      game.events.on("ui-ready", showAi);
      if (uiReady) showAi();
      // The characters' memory: the same people with the same voice and feelings in every adventure.
      const npcWorld = loadNpcWorld();
      c.npcNote = (name, hero) => {
        const mind = findMind(npcWorld, name);
        if (!mind) return undefined;
        const bond = bondOf(mind, hero);
        const love = loveOf(mind, hero);
        const tie = mind.spouse === hero ? "spouse" : mind.engaged === hero ? "engaged" : undefined;
        return { bond, mood: bondLabel(bond), ...(mind.facts.length ? { memory: mind.facts[mind.facts.length - 1]! } : {}), ...(love ? { love, loveLabel: loveLabel(love) } : {}), ...(tie ? { tie } : {}) };
      };
      c.familyOf = (hero) => familyView(npcWorld, hero);
      c.onFamily = (hero, a) => {
        const ok =
          a.act === "wish" || a.act === "no_wish"
            ? setChildWish(npcWorld, hero.name, a.act === "wish")
            : a.act === "name"
              ? nameChild(npcWorld, hero.name, a.index ?? -1, a.name ?? "")
              : setSquire(npcWorld, hero.name, a.index ?? -1, a.act === "squire");
        if (!ok) return a.act === "name" ? "Dieser Name geht nicht (mindestens 2 Buchstaben, nur einmal)." : a.act === "squire" ? "Nur Jugendliche können als Knappe mit." : "Das geht gerade nicht.";
        saveNpcWorld(npcWorld);
        if (a.act === "wish") c.tellPlayer(hero.playerId!, "💞 Nach dem Abenteuer, zu Hause …");
        if (a.act === "squire") c.tellPlayer(hero.playerId!, "🗡️ Kommt beim nächsten Abenteuer als Knappe mit.");
        return undefined;
      };
      const director = new Director(story, state, c, dm, rng, {
        npcs: {
          world: npcWorld,
          save: () => saveNpcWorld(npcWorld),
          onMeet: (mind) => castCharacter(mind.name, mind.persona.gender, `${mind.persona.voiceStyle}, ${mind.persona.speech}`),
        },
        duration,
        world: true,
        saga: carry,
        onSave: (saved, announce) => {
          // Every scene is saved (here and, with the code, online); long games announce their save points.
          void writeSave({ savedAt: Date.now(), state: { ...saved, minutesBefore: director.minutesPlayed() }, heroes: [...c.heroes(), ...Object.values(c.session.battle.creatures).filter((x) => x.companion && !x.dead)].map((h) => structuredClone(h)), players: host.lobby.players, cloud }).then((online) =>
            // The board is rebuilt for the new scene: show the note once it is back.
            setTimeout(() => {
              game.events.emit("saved", online ? formatCode(cloud.code) : undefined);
              if (announce) c.narrate([{ text: `💾 Speicherpunkt erreicht. Ihr könnt das Spiel später fortsetzen${online ? ` – auch an einem anderen Gerät mit dem Code ${formatCode(cloud.code)}` : ""}.` }]);
            }, 2500),
          );
        },
        onEnd: (result: StoryResult) => {
          clearSave();
          // Home: the village gets its share, the saga a new chapter.
          const won = result.ending.kind !== "scheitern";
          const income = villageIncome(won, c.heroes().length);
          const home = loadVillage();
          home.gold += income;
          saveVillage(home);
          const book = loadSaga();
          markCarried(book, carry);
          book.entries.push({
            storyId: story.id,
            title: story.title,
            endingTitle: result.ending.title,
            kind: result.ending.kind as SagaEntry["kind"],
            heroes: result.homeland?.heroes ?? [],
            at: Date.now(),
            ...(result.homeland?.ally ? { ally: result.homeland.ally } : {}),
            ...(result.homeland?.nemesis ? { nemesis: result.homeland.nemesis } : {}),
          });
          saveSaga(book);
          result.village = { income, gold: home.gold, ally: result.homeland?.ally?.name, nemesis: result.homeland?.nemesis?.name };
          // Let the last narration run before showing the summary.
          setTimeout(() => {
            mirror?.push({ k: "end", result });
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
    if (earlyScene) game.events.emit("scene-card", earlyScene.title, earlyScene.goal);
    earlyScene = undefined;
    controller?.announceTurn();
    if (controller?.storyView) {
      game.events.emit("chapter", controller.storyView.chapter, controller.storyView.goal);
      game.events.emit("notes", controller.storyView.tasks ?? [], controller.storyView.moreTasks ?? 0, controller.storyView.clues.map((x) => x.text));
    }
    if (controller) {
      game.events.emit("log", controller.recentLog(14), 0);
      game.events.emit("order", controller.mode === "combat" || !controller.freeExplore ? controller.orderEntries() : []);
      // Once more when the pictures are surely loaded.
      const c = controller;
      setTimeout(() => game.events.emit("order", c.mode === "combat" || !c.freeExplore ? c.orderEntries() : []), 2500);
    }
  });

  host.onPlayerEvent((e, from) => {
    if (e.type === "player_action") controller?.handle(from, e.action);
  });
  host.onSeatMoved((oldId, newId) => controller?.reassignPlayer(oldId, newId));
  // A phone that (re)connects gets its view again.
  const offLobby = host.onChange(() => controller?.broadcast());

  // Settings during the game: a small ⚙️ in the corner (or Escape / S on the keyboard).
  let settingsOpen = false;
  const openSettings = () => {
    if (settingsOpen) return;
    settingsOpen = true;
    const layer = document.createElement("div");
    layer.className = "ingame-settings";
    document.body.append(layer);
    void settingsScreen(layer).then(() => {
      layer.remove();
      settingsOpen = false;
      if (controller) controller.crude = loadCrude();
    });
  };
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ingame-gear";
  gear.title = "Einstellungen";
  gear.textContent = "⚙️";
  gear.addEventListener("click", openSettings);
  container.append(gear);

  // Keyboard helpers on the TV (demo mode): R = new random dungeon, F = demo fight.
  const onKey = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing && !settingsOpen && (e.key === "Escape" || e.key === "s" || e.key === "S")) {
      openSettings();
      return;
    }
    if (!opts.demo) return;
    if (e.key === "f" || e.key === "F") controller?.spawnNearParty(["goblin", "goblin", "goblin"]);
    // E = explore everything (to look at the whole map).
    if (e.key === "e" || e.key === "E") {
      session.map.explored.fill(true);
      controller?.broadcast();
      scene.refresh();
    }
    if (e.key === "r" || e.key === "R") {
      session = newSession();
      wire();
      mirror?.sendMap();
      scene.scene.restart();
    }
  };
  window.addEventListener("keydown", onKey);
  // Demo mode: handles for browser tests (look at fire, bubbles …).
  if (opts.demo || location.hash.includes("debug")) (window as unknown as { __couch?: unknown }).__couch = { session: () => session, controller: () => controller, scene: () => scene };

  return () => {
    offLobby();
    mirror?.close();
    mirror = undefined;
    if (worldTimer) clearInterval(worldTimer);
    ambienceTo(undefined);
    closeEnd?.();
    controller?.destroy();
    window.removeEventListener("keydown", onKey);
    document.querySelector(".ingame-settings")?.remove();
    game.destroy(true);
    container.remove();
  };
}
