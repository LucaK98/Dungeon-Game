/**
 * The TV's picture for viewers at home: everything the board draws, shows and plays goes out
 * over a stream (src/net/stream.ts), and a viewer's board (src/watch/boot.ts) draws the same.
 * Nothing is sent while nobody watches.
 */
import type { Stream } from "../net/stream";
import type { Battle } from "../shared/game";
import type { DungeonMap } from "../shared/map";

export type MirrorItem =
  | { k: "ui"; name: string; args: unknown[] }
  | { k: "scene"; m: string; args: unknown[] }
  | { k: "sound"; n: string }
  | { k: "mood"; ambience?: unknown; mood?: string }
  | { k: "end"; result: unknown };

/** The parts of the map that change while playing. */
export interface MapChanges {
  explored: string;
  objects: DungeonMap["objects"];
  surface: DungeonMap["surface"];
  overlays: DungeonMap["overlays"];
  decals: DungeonMap["decals"];
  dark?: boolean;
  weather?: DungeonMap["weather"];
}

export type MirrorMsg =
  | { t: "batch"; items: MirrorItem[] }
  | { t: "map"; map: DungeonMap; battle: Battle; partyIds: string[] }
  | { t: "state"; battle: Battle; partyIds: string[]; map: MapChanges }
  /** Viewer → TV: I am here (on join and every few seconds). */
  | { t: "hi"; viewer: string; fresh?: boolean };

export function packExplored(explored: boolean[]): string {
  return explored.map((b) => (b ? "1" : "0")).join("");
}

export function unpackExplored(s: string): boolean[] {
  return [...s].map((c) => c === "1");
}

export function mapChanges(map: DungeonMap): MapChanges {
  return {
    explored: packExplored(map.explored),
    objects: map.objects,
    surface: map.surface,
    overlays: map.overlays,
    decals: map.decals,
    ...(map.dark ? { dark: true } : {}),
    ...(map.weather ? { weather: map.weather } : {}),
  };
}

export function applyMapChanges(map: DungeonMap, c: MapChanges): void {
  map.explored = unpackExplored(c.explored);
  map.objects = c.objects;
  map.surface = c.surface;
  map.overlays = c.overlays;
  map.decals = c.decals;
  map.dark = c.dark;
  map.weather = c.weather;
}

const VIEWER_TIMEOUT_MS = 20_000;

export class MirrorHost {
  private items: MirrorItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  private viewers = new Map<string, number>();

  constructor(
    private stream: Stream,
    private session: () => { map: DungeonMap; battle: Battle; partyIds: string[] },
    /** A viewer joined: the board sends what is on screen right now (log, order, chapter …). */
    private onJoin: () => void,
  ) {
    stream.onMessage((raw) => {
      const msg = raw as MirrorMsg;
      if (msg?.t !== "hi") return;
      const known = this.viewers.has(msg.viewer);
      this.viewers.set(msg.viewer, Date.now());
      if (!known || msg.fresh) {
        this.sendMap();
        this.onJoin();
      }
    });
  }

  /** Somebody is watching (seen in the last seconds). */
  get watched(): boolean {
    const now = Date.now();
    for (const [id, seen] of this.viewers) if (now - seen > VIEWER_TIMEOUT_MS) this.viewers.delete(id);
    return this.viewers.size > 0;
  }

  push(item: MirrorItem): void {
    if (!this.watched) return;
    this.items.push(item);
    this.flushTimer ??= setTimeout(() => this.flush(), 120);
  }

  ui(name: string, args: unknown[]): void {
    this.push({ k: "ui", name, args });
  }

  scene(m: string, args: unknown[]): void {
    this.push({ k: "scene", m, args });
  }

  /** The board changed: the latest state goes out a few times per second at most. */
  changed(): void {
    if (!this.watched || this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined;
      this.flush();
      const s = this.session();
      this.stream.publish({ t: "state", battle: s.battle, partyIds: s.partyIds, map: mapChanges(s.map) } satisfies MirrorMsg);
    }, 250);
  }

  /** A new map (next scene): viewers rebuild their board. */
  sendMap(): void {
    if (!this.watched) return;
    this.flush();
    const s = this.session();
    this.stream.publish({ t: "map", map: s.map, battle: s.battle, partyIds: s.partyIds } satisfies MirrorMsg);
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.items.length) return;
    const items = this.items.splice(0);
    this.stream.publish({ t: "batch", items } satisfies MirrorMsg);
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stream.close();
  }
}

/** UI events of the board that viewers get as they are ("room-name" comes with the scene call). */
export const MIRRORED_UI = new Set(["ai-status", "asked", "camp", "chapter", "clock", "combat", "flash", "info-banner", "log", "narration", "notes", "order", "reward", "roll", "round", "saved", "scene-card", "travel", "turn", "vote"]);

/** Board methods that viewers replay (refresh goes as a state snapshot). */
export const MIRRORED_SCENE = ["showHits", "shake", "playFx", "showRoomName", "setCombatLayout", "showPoint", "showSpeech", "showSpeechByName", "showGain", "showEmote", "fx", "spotlight"] as const;
