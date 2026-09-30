/**
 * Playing from home: this screen shows the TV's board (drawn from the TV's stream, see
 * src/tv/mirror.ts) with sound, music and voice. Controls stay on the phone – or in a side window.
 */
import Phaser from "phaser";
import { openStream, type Stream } from "../net/stream";
import type { Route } from "../shared/route";
import { isValidRoomCode, normalizeRoomCode } from "../shared/room";
import type { GameSession } from "../tv/session";
import { BOARD_HEIGHT, BOARD_WIDTH, DungeonScene } from "../tv/DungeonScene";
import { UiScene } from "../tv/UiScene";
import { initRes } from "../tv/render";
import { applyMapChanges, type MirrorItem, type MirrorMsg } from "../tv/mirror";
import { endScreen } from "../tv/end-screen";
import type { StoryResult } from "../dm/director";
import { h } from "../ui/dom";
import { play, setAmbience, unlockSoundOnGesture } from "../ui/sound";
import { setMood, unlockMusicOnGesture } from "../ui/music";

export function startWatch(root: HTMLElement, route: Extract<Route, { view: "watch" }>): () => void {
  if (!route.room || !isValidRoomCode(route.room)) return askCode(root, route);
  document.body.classList.add("is-tv");
  const room = route.room;
  const viewer = crypto.randomUUID();
  let stream: Stream | undefined;
  let closed = false;
  let game: Phaser.Game | undefined;
  let scene: DungeonScene | undefined;
  let session: GameSession | undefined;
  let uiReady = false;
  const waiting: MirrorItem[] = [];
  let closeEnd: (() => void) | undefined;

  const playUrl = `${location.pathname}#/play?room=${room}&net=${route.net}`;
  const controls = h(
    "div",
    { class: "watch-bar" },
    h("span", {}, `🏠 Zuschauen · Raum ${room}`),
    h("button", { class: "tv-btn small", type: "button", textContent: "🎮 Steuerung im Fenster", onclick: () => window.open(playUrl, `couch-play-${room}`, "width=430,height=880") }),
  );
  const status = h("div", { class: "watch-status" }, h("h1", {}, "🏠 Von zu Hause mitspielen"), h("p", { class: "slide-text" }, "Verbinde mit dem Spiel …"));
  const start = h("button", { class: "tv-btn primary", type: "button", textContent: "▶ Ton an & zuschauen" });
  start.addEventListener("click", () => start.remove());
  status.append(start, h("p", { class: "muted" }, "Gesteuert wird wie immer mit dem Handy (QR-Code/Code vom Fernseher) – oder hier mit „🎮 Steuerung im Fenster“."));
  root.append(controls, status);
  unlockSoundOnGesture();
  unlockMusicOnGesture();

  const apply = (item: MirrorItem) => {
    switch (item.k) {
      case "ui":
        if (!game || !uiReady) waiting.push(item);
        else game.events.emit(item.name, ...item.args);
        return;
      case "scene": {
        if (!scene?.sys.isActive()) return;
        const api = scene as unknown as Record<string, (...a: unknown[]) => unknown>;
        api[item.m]?.(...item.args);
        return;
      }
      case "sound":
        play(item.n as Parameters<typeof play>[0]);
        return;
      case "mood":
        if (item.mood) setMood(item.mood as Parameters<typeof setMood>[0]);
        if (item.ambience !== undefined) setAmbience((item.ambience ?? undefined) as Parameters<typeof setAmbience>[0]);
        return;
      case "end":
        closeEnd?.();
        closeEnd = endScreen(root, item.result as StoryResult, () => {
          closeEnd?.();
          closeEnd = undefined;
        });
        return;
    }
  };

  const board = (s: GameSession) => {
    session = s;
    if (game && scene) {
      if (scene.sys.isActive() || scene.sys.isPaused()) scene.scene.restart();
      return;
    }
    status.remove();
    const container = h("div", { class: "tv" });
    root.append(container);
    scene = new DungeonScene(() => session!);
    const res = initRes(container);
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: Math.round(BOARD_WIDTH * res),
      height: Math.round(BOARD_HEIGHT * res),
      backgroundColor: "#000000",
      pixelArt: true,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [scene, UiScene],
    });
    game.events.on("ui-ready", () => {
      uiReady = true;
      for (const item of waiting.splice(0)) apply(item);
    });
  };

  const receive = (raw: unknown) => {
    const msg = raw as MirrorMsg;
    switch (msg?.t) {
      case "map":
        board({ map: msg.map, battle: msg.battle, partyIds: msg.partyIds });
        return;
      case "state":
        if (!session) return;
        session.battle = msg.battle;
        session.partyIds = msg.partyIds;
        applyMapChanges(session.map, msg.map);
        if (scene?.sys.isActive()) scene.refresh();
        return;
      case "batch":
        for (const item of msg.items) apply(item);
        return;
    }
  };

  // Handle for browser tests.
  if (location.hash.includes("debug") || import.meta.env.DEV) (window as unknown as { __couchWatch?: unknown }).__couchWatch = { session: () => session, scene: () => scene };

  let hello: ReturnType<typeof setInterval> | undefined;
  let waitNote: ReturnType<typeof setTimeout> | undefined;
  void openStream(room, route.net === "local")
    .then((s) => {
      if (closed) return s.close();
      stream = s;
      s.onMessage(receive);
      s.publish({ t: "hi", viewer, fresh: true } satisfies MirrorMsg);
      // Every few seconds: still here (and, until the board shows, please send it).
      hello = setInterval(() => s.publish({ t: "hi", viewer, ...(session ? {} : { fresh: true }) } satisfies MirrorMsg), 5000);
      waitNote = setTimeout(() => {
        if (!session) status.querySelector("p")!.textContent = "Warte auf das Spiel … Sobald auf dem Fernseher ein Abenteuer läuft, erscheint hier das Spielbrett.";
      }, 6000);
    })
    .catch(() => {
      status.querySelector("p")!.textContent = "Keine Verbindung. Ist dieser Computer mit dem Internet verbunden?";
    });

  return () => {
    closed = true;
    if (hello) clearInterval(hello);
    if (waitNote) clearTimeout(waitNote);
    stream?.close();
    closeEnd?.();
    setAmbience(undefined);
    game?.destroy(true);
    document.body.classList.remove("is-tv");
    root.replaceChildren();
  };
}

/** No code yet: ask for the one on the TV. */
function askCode(root: HTMLElement, route: Extract<Route, { view: "watch" }>): () => void {
  const input = h("input", { class: "text-input", placeholder: "Code vom Fernseher, z. B. K7QD", maxLength: 4, autocomplete: "off" }) as HTMLInputElement;
  const go = h("button", { class: "big-button", type: "button", textContent: "▶ Spielbrett anzeigen" });
  const submit = () => {
    const code = normalizeRoomCode(input.value);
    if (isValidRoomCode(code)) location.hash = `#/watch?room=${code}&net=${route.net}`;
    else input.focus();
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  root.append(
    h(
      "main",
      { class: "home" },
      h("h1", {}, "🏠 Von zu Hause mitspielen"),
      h("p", {}, "Du siehst hier das Spielbrett vom Fernseher deiner Freunde – live, mit Ton und Stimmen. Gesteuert wird mit dem Handy oder in einem Fenster daneben."),
      input,
      go,
    ),
  );
  setTimeout(() => input.focus(), 50);
  return () => root.replaceChildren();
}
