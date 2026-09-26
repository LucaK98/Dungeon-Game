/**
 * The TV is the host: it owns the lobby (and later the game state) and
 * decides everything. Phones only send wishes.
 */
import { createTransport, type GameTransport } from "../net";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import { MAX_PLAYERS, type LobbyPlayer, type LobbyState } from "../shared/lobby";
import { sanitizeProfile } from "./profile";
import type { NetKind } from "../shared/transport";
import type { PlayerId, PlayerInfo } from "../shared/types";

const ROOM_KEY = "couch-dungeon.tv.room";
const LOBBY_KEY = "couch-dungeon.tv.lobby";

function load<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the TV just forgets the lobby on reload.
  }
}

export class GameHost {
  private listeners: ((lobby: LobbyState) => void)[] = [];
  private eventListeners: ((e: GameEvent, from: PlayerId) => void)[] = [];

  private constructor(
    readonly transport: GameTransport,
    readonly net: NetKind,
    public lobby: LobbyState,
  ) {
    transport.onPresence((players) => this.onPresence(players));
    transport.onEvent((e, from) => {
      if (from !== "host") this.onEvent(e, from);
    });
  }

  static async start(net: NetKind): Promise<GameHost> {
    const transport = createTransport(net);
    const room = await transport.createRoom(load<string>(ROOM_KEY));
    save(ROOM_KEY, room);
    const stored = load<LobbyState>(LOBBY_KEY);
    const lobby: LobbyState =
      stored && stored.room === room
        ? { ...stored, players: stored.players.map((p) => ({ ...p, connected: false })) }
        : { room, phase: "lobby", players: [] };
    return new GameHost(transport, net, lobby);
  }

  onChange(listener: (lobby: LobbyState) => void): () => void {
    this.listeners.push(listener);
    listener(this.lobby);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Game events from phones that the lobby does not handle itself. */
  onPlayerEvent(listener: (e: GameEvent, from: PlayerId) => void): void {
    this.eventListeners.push(listener);
  }

  joinUrl(): string {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#/play?room=${this.lobby.room}${this.net === "local" ? "" : `&net=${this.net}`}`;
  }

  setStory(story: LobbyState["story"]): void {
    this.lobby.story = story;
    this.changed();
  }

  /** Back to the lobby after a game (players stay, all "not ready"). */
  backToLobby(): void {
    this.lobby.phase = "lobby";
    for (const p of this.lobby.players) p.ready = false;
    this.changed();
  }

  /** Restores the players of a saved game; they rejoin with their stored IDs. */
  restorePlayers(players: LobbyPlayer[]): void {
    this.lobby.players = players.map((p) => ({ ...p, connected: this.lobby.players.some((q) => q.id === p.id && q.connected) }));
    this.lobby.phase = "playing";
    this.changed();
  }

  canStart(): boolean {
    const active = this.lobby.players.filter((p) => p.connected);
    return active.length > 0 && active.every((p) => p.profile && p.ready);
  }

  startGame(): void {
    if (!this.canStart()) return;
    // Players who left before the start are dropped.
    this.lobby.players = this.lobby.players.filter((p) => p.connected);
    this.lobby.phase = "playing";
    this.changed();
  }

  /** Fills the lobby with four example heroes (for #/tv?demo). */
  useDemoParty(): void {
    const heroes: [string, string, string, 1 | 2, string][] = [
      ["Brunhild", "fighter", "human", 2, "#e6194b"],
      ["Siegfried", "paladin", "human", 1, "#3cb44b"],
      ["Ilmarin", "wizard", "elf", 1, "#4363d8"],
      ["Pip", "rogue", "halfling", 2, "#ffe119"],
    ];
    this.lobby.players = heroes.map(([name, classId, raceId, variant, color], i) => ({
      id: `demo-${i}`,
      profile: { name, classId, raceId, look: defaultLook(classId, raceId, variant), color },
      ready: true,
      connected: true,
    }));
    this.lobby.phase = "playing";
  }

  private player(id: PlayerId): LobbyPlayer | undefined {
    return this.lobby.players.find((p) => p.id === id);
  }

  private onPresence(players: PlayerInfo[]): void {
    for (const info of players) {
      const known = this.player(info.id);
      if (known) {
        known.connected = info.connected !== false;
      } else if (info.connected !== false) {
        const seats = this.lobby.players.length;
        if (this.lobby.phase !== "lobby" || seats >= MAX_PLAYERS) {
          const reason = this.lobby.phase !== "lobby" ? "Das Spiel läuft schon." : `Es können höchstens ${MAX_PLAYERS} Leute mitspielen.`;
          this.transport.send({ type: "join_rejected", reason }, info.id);
          continue;
        }
        this.lobby.players.push({ id: info.id, profile: null, ready: false, connected: true });
      }
    }
    this.changed();
  }

  private onEvent(e: GameEvent, from: PlayerId): void {
    const p = this.player(from);
    if (!p) return;
    if (e.type === "lobby_profile") {
      if (this.lobby.phase !== "lobby") return;
      const taken = this.lobby.players.filter((o) => o.id !== from && o.profile).map((o) => o.profile!.color);
      p.profile = sanitizeProfile(e.profile, taken) ?? null;
      p.ready = !!p.profile && e.ready;
      this.changed();
      return;
    }
    for (const l of this.eventListeners) l(e, from);
  }

  private changed(): void {
    save(LOBBY_KEY, this.lobby);
    this.transport.send({ type: "lobby_state", lobby: this.lobby });
    for (const l of this.listeners) l(this.lobby);
  }
}
