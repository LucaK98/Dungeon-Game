/**
 * Phone-side logic shared by every transport: heartbeat, join handshake,
 * duplicate-ID handling and connection state.
 */
import type { GameEvent } from "../shared/events";
import type { PlayerId, PlayerInfo } from "../shared/types";
import { HEARTBEAT_MS, TIMEOUT_MS, type Wire } from "./wire";

export class ClientCore {
  readonly instance = Math.random().toString(36).slice(2);
  private eventHandlers: ((e: GameEvent, from: PlayerId | "host") => void)[] = [];
  private presenceHandlers: ((players: PlayerInfo[]) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastHostMessage = 0;
  private connected = false;
  private joined: (() => void) | undefined;
  private replacedHandlers: (() => void)[] = [];
  /** Take over our seat if another page of ours still holds it (see HostCore). */
  claim = false;

  constructor(
    private post: (msg: Wire) => void,
    public player: PlayerInfo,
    /** Called when our stored ID is already used by another open tab. */
    private newId: () => PlayerId,
    private now: () => number = Date.now,
  ) {}

  /** Resolves once the host has confirmed us, rejects after `timeoutMs`. */
  join(timeoutMs = 5000): Promise<void> {
    const joined = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Kein Spiel mit diesem Code gefunden. Läuft das Spielbrett auf dem Fernseher?")), timeoutMs);
      this.joined = () => {
        clearTimeout(t);
        resolve();
      };
    });
    // Listen first, then say hello: the answer may come back synchronously.
    this.hello();
    this.timer = setInterval(() => this.tick(), HEARTBEAT_MS);
    return joined;
  }

  stop(): void {
    if (!this.timer) return; // already stopped (or replaced)
    clearInterval(this.timer);
    this.timer = undefined;
    this.post({ t: "bye", playerId: this.player.id, instance: this.instance });
  }

  updatePlayer(patch: Partial<PlayerInfo>): void {
    this.player = { ...this.player, ...patch };
    this.hello();
  }

  receive(msg: Wire): void {
    if (msg.t === "hello" || msg.t === "bye") return; // other phones
    this.lastHostMessage = this.now();
    this.setConnected(true);
    switch (msg.t) {
      case "host-hello":
        this.hello();
        return;
      case "replaced":
        if (msg.instance === this.instance) {
          if (this.timer) clearInterval(this.timer);
          this.timer = undefined;
          for (const h of this.replacedHandlers) h();
        }
        return;
      case "id-taken":
        if (msg.instance === this.instance) {
          this.player = { ...this.player, id: this.newId() };
          this.hello();
        }
        return;
      case "presence":
        if (msg.players.some((p) => p.id === this.player.id)) {
          this.joined?.();
          this.joined = undefined;
        }
        for (const h of this.presenceHandlers) h(msg.players);
        return;
      case "event":
        if (msg.to && msg.to !== this.player.id) return;
        for (const h of this.eventHandlers) h(msg.event, msg.from);
        return;
    }
  }

  send(event: GameEvent): void {
    this.post({ t: "event", from: this.player.id, event });
  }

  onEvent(h: (e: GameEvent, from: PlayerId | "host") => void): void {
    this.eventHandlers.push(h);
  }

  onPresence(h: (players: PlayerInfo[]) => void): void {
    this.presenceHandlers.push(h);
  }

  onConnection(h: (connected: boolean) => void): void {
    this.connectionHandlers.push(h);
  }

  /** This page lost its seat to a newer page of the same player. */
  onReplaced(h: () => void): void {
    this.replacedHandlers.push(h);
  }

  private hello(): void {
    this.post({ t: "hello", player: this.player, instance: this.instance, ...(this.claim ? { claim: true } : {}) });
  }

  private tick(): void {
    this.hello();
    if (this.connected && this.now() - this.lastHostMessage > TIMEOUT_MS) this.setConnected(false);
  }

  private setConnected(value: boolean): void {
    if (value === this.connected) return;
    this.connected = value;
    for (const h of this.connectionHandlers) h(value);
  }
}
