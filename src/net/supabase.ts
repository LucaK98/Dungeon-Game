/**
 * Multiplayer over Supabase Realtime (broadcast channels). TV and phones only open a normal
 * websocket to Supabase – no direct device-to-device link – so it works in every Wi-Fi and on
 * mobile data. One channel per room code; the TV is the host (HostCore), phones are clients
 * (ClientCore), exactly like the local and PeerJS transports.
 *
 * The publishable key below is meant to be public (it only allows what the project permits);
 * no secret is stored here. Broadcast channels need no tables.
 */
import type { GameEvent } from "../shared/events";
import { generateRoomCode, isValidRoomCode } from "../shared/room";
import type { Transport } from "../shared/transport";
import type { PlayerId, PlayerInfo, RoomCode } from "../shared/types";
import { ClientCore } from "./client-core";
import { HostCore } from "./host-core";
import { isWire, type Wire } from "./wire";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://ityjpcxznauprubztqdz.supabase.co";
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? "sb_publishable_4-nakKezTg9UbVlUMyXOgQ_AQ7Khjjr";

/** What we need from a Supabase Realtime channel (tests plug in a fake). */
export interface ChannelLike {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload?: unknown }) => void): ChannelLike;
  subscribe(cb: (status: string, err?: Error) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
  unsubscribe(): Promise<unknown>;
}
export type ChannelFactory = (topic: string) => ChannelLike;

const EVENT = "wire";
interface Envelope {
  msg: Wire;
  /** From the host: only this player should read it. */
  to?: PlayerId;
  /** From a phone: messages from phones are only for the host. */
  fromPhone?: boolean;
}

export const topicForRoom = (code: RoomCode) => `couch-dungeon-v1:${code}`;

async function defaultFactory(): Promise<ChannelFactory> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return (topic) => client.channel(topic, { config: { broadcast: { self: false, ack: false } } }) as unknown as ChannelLike;
}

function subscribed(ch: ChannelLike, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        reject(new Error(status));
      }
    });
  });
}

const OFFLINE = "Keine Verbindung zum Spiel-Server. Ist das Gerät mit dem Internet verbunden?";

export class SupabaseTransport implements Transport {
  private channel: ChannelLike | undefined;
  private host: HostCore | undefined;
  private client: ClientCore | undefined;
  private eventHandlers: ((e: GameEvent, from: PlayerId | "host") => void)[] = [];
  private presenceHandlers: ((players: PlayerInfo[]) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];
  private replacedHandlers: (() => void)[] = [];

  constructor(
    private newPlayerId: () => PlayerId = () => crypto.randomUUID(),
    private factory?: ChannelFactory,
  ) {}

  private async open(code: RoomCode, onMessage: (e: Envelope) => void): Promise<ChannelLike> {
    this.factory ??= await defaultFactory();
    const ch = this.factory(topicForRoom(code));
    ch.on("broadcast", { event: EVENT }, ({ payload }) => {
      const env = payload as Envelope | undefined;
      if (env && isWire(env.msg)) onMessage(env);
    });
    try {
      await subscribed(ch);
    } catch {
      void ch.unsubscribe();
      throw new Error(OFFLINE);
    }
    this.channel = ch;
    return ch;
  }

  private post(env: Envelope): void {
    void this.channel?.send({ type: "broadcast", event: EVENT, payload: env }).catch(() => {});
  }

  async createRoom(preferred?: RoomCode): Promise<RoomCode> {
    const code = preferred && isValidRoomCode(preferred) ? preferred : generateRoomCode();
    await this.open(code, (env) => {
      if (env.fromPhone) this.host?.receive(env.msg);
    });
    const host = new HostCore((msg, to) => this.post({ msg, ...(to ? { to } : {}) }));
    this.eventHandlers.forEach((h) => host.onEvent(h));
    this.presenceHandlers.forEach((h) => host.onPresence(h));
    this.host = host;
    host.start();
    return code;
  }

  async joinRoom(code: RoomCode, player: PlayerInfo, opts: { claim?: boolean } = {}): Promise<void> {
    await this.open(code, (env) => {
      if (env.fromPhone) return; // other phones
      if (env.to && this.client && env.to !== this.client.player.id && env.msg.t !== "id-taken" && env.msg.t !== "replaced") return;
      this.client?.receive(env.msg);
    });
    const client = new ClientCore((msg) => this.post({ msg, fromPhone: true }), player, this.newPlayerId);
    this.eventHandlers.forEach((h) => client.onEvent(h));
    this.presenceHandlers.forEach((h) => client.onPresence(h));
    this.connectionHandlers.forEach((h) => client.onConnection(h));
    this.replacedHandlers.forEach((h) => client.onReplaced(h));
    client.claim = !!opts.claim;
    this.client = client;
    await client.join(8000).catch(() => {
      throw new Error("Kein Spiel mit diesem Code gefunden. Läuft das Spielbrett auf dem Fernseher, und stimmt der Code?");
    });
  }

  get player(): PlayerInfo | undefined {
    return this.client?.player;
  }

  send(event: GameEvent, to?: PlayerId): void {
    if (this.host) this.host.send(event, to);
    else this.client?.send(event);
  }

  onEvent(handler: (e: GameEvent, from: PlayerId | "host") => void): void {
    this.eventHandlers.push(handler);
    (this.host ?? this.client)?.onEvent(handler);
  }

  onPresence(handler: (players: PlayerInfo[]) => void): void {
    this.presenceHandlers.push(handler);
    (this.host ?? this.client)?.onPresence(handler);
  }

  onConnection(handler: (connected: boolean) => void): void {
    this.connectionHandlers.push(handler);
    this.client?.onConnection(handler);
  }

  onReplaced(handler: () => void): void {
    this.replacedHandlers.push(handler);
    this.client?.onReplaced(handler);
  }

  updatePlayer(patch: Partial<PlayerInfo>): void {
    this.client?.updatePlayer(patch);
  }

  close(): void {
    this.host?.stop();
    this.client?.stop();
    void this.channel?.unsubscribe();
  }
}
