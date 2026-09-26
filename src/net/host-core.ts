/**
 * Host-side bookkeeping shared by every transport: who is connected,
 * duplicate tabs, heartbeats and timeouts.
 */
import type { GameEvent } from "../shared/events";
import type { PlayerId, PlayerInfo } from "../shared/types";
import { TIMEOUT_MS, type Wire } from "./wire";

interface Known {
  info: PlayerInfo;
  instance: string;
  lastSeen: number;
}

export class HostCore {
  private players = new Map<PlayerId, Known>();
  private eventHandlers: ((e: GameEvent, from: PlayerId | "host") => void)[] = [];
  private presenceHandlers: ((players: PlayerInfo[]) => void)[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Pages that lost their seat to a newer page; their late hellos are ignored. */
  private replaced = new Set<string>();

  /** `post` sends a wire message to one player (to) or everyone. */
  constructor(private post: (msg: Wire, to?: PlayerId) => void, private now: () => number = Date.now) {}

  start(): void {
    this.post({ t: "host-hello" });
    this.timer = setInterval(() => this.checkTimeouts(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  receive(msg: Wire): void {
    switch (msg.t) {
      case "hello": {
        if (this.replaced.has(msg.instance)) return;
        const known = this.players.get(msg.player.id);
        const alive = known && known.info.connected && this.now() - known.lastSeen < TIMEOUT_MS;
        if (known && alive && known.instance !== msg.instance) {
          if (msg.claim) {
            // The same player reopened the game (app closed without saying goodbye): the new page gets the seat.
            this.replaced.add(known.instance);
            this.post({ t: "replaced", instance: known.instance });
          } else {
            // Two open tabs with the same stored ID on one computer: the newcomer must pick another one.
            this.post({ t: "id-taken", instance: msg.instance });
            return;
          }
        }
        // A takeover counts as a change so the game re-sends everything to the new page.
        const changed = !known || !known.info.connected || known.info.name !== msg.player.name || known.instance !== msg.instance;
        this.players.set(msg.player.id, {
          info: { ...msg.player, connected: true },
          instance: msg.instance,
          lastSeen: this.now(),
        });
        if (changed) this.emitPresence();
        else this.post({ t: "presence", players: this.list() }, msg.player.id);
        return;
      }
      case "bye": {
        const known = this.players.get(msg.playerId);
        if (known && known.instance === msg.instance) {
          known.info.connected = false;
          this.emitPresence();
        }
        return;
      }
      case "event":
        if (msg.from !== "host" && this.players.has(msg.from)) {
          const known = this.players.get(msg.from)!;
          known.lastSeen = this.now();
          for (const h of this.eventHandlers) h(msg.event, msg.from);
        }
        return;
      default:
        return;
    }
  }

  send(event: GameEvent, to?: PlayerId): void {
    this.post({ t: "event", from: "host", ...(to ? { to } : {}), event }, to);
  }

  onEvent(h: (e: GameEvent, from: PlayerId | "host") => void): void {
    this.eventHandlers.push(h);
  }

  onPresence(h: (players: PlayerInfo[]) => void): void {
    this.presenceHandlers.push(h);
    h(this.list());
  }

  list(): PlayerInfo[] {
    return [...this.players.values()].map((k) => k.info);
  }

  private emitPresence(): void {
    const players = this.list();
    this.post({ t: "presence", players });
    for (const h of this.presenceHandlers) h(players);
  }

  private checkTimeouts(): void {
    let changed = false;
    for (const k of this.players.values()) {
      if (k.info.connected && this.now() - k.lastSeen > TIMEOUT_MS) {
        k.info.connected = false;
        changed = true;
      }
    }
    if (changed) this.emitPresence();
  }
}
