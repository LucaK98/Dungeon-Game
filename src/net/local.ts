/**
 * Multiplayer between browser tabs on the same computer (BroadcastChannel).
 * For development: 1 tab #/tv, 2–4 tabs #/play.
 */
import type { GameEvent } from "../shared/events";
import { generateRoomCode, isValidRoomCode } from "../shared/room";
import type { Transport } from "../shared/transport";
import type { PlayerId, PlayerInfo, RoomCode } from "../shared/types";
import { ClientCore } from "./client-core";
import { HostCore } from "./host-core";
import { isWire, type Wire } from "./wire";

export class LocalTransport implements Transport {
  private channel: BroadcastChannel | undefined;
  private host: HostCore | undefined;
  private client: ClientCore | undefined;
  // Handlers may be registered before the room exists; they are attached on create/join.
  private eventHandlers: ((e: GameEvent, from: PlayerId | "host") => void)[] = [];
  private presenceHandlers: ((players: PlayerInfo[]) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];

  constructor(private newPlayerId: () => PlayerId = () => crypto.randomUUID()) {}

  private open(code: RoomCode, onMessage: (msg: Wire) => void): BroadcastChannel {
    const channel = new BroadcastChannel(`couch-dungeon/${code}`);
    channel.onmessage = (e: MessageEvent) => {
      if (isWire(e.data)) onMessage(e.data);
    };
    this.channel = channel;
    return channel;
  }

  async createRoom(preferred?: RoomCode): Promise<RoomCode> {
    const code = preferred && isValidRoomCode(preferred) ? preferred : generateRoomCode();
    const channel = this.open(code, (msg) => this.host?.receive(msg));
    const host = new HostCore((msg) => channel.postMessage(msg));
    this.eventHandlers.forEach((h) => host.onEvent(h));
    this.presenceHandlers.forEach((h) => host.onPresence(h));
    this.host = host;
    host.start();
    return code;
  }

  async joinRoom(code: RoomCode, player: PlayerInfo): Promise<void> {
    const channel = this.open(code, (msg) => this.client?.receive(msg));
    const client = new ClientCore((msg) => channel.postMessage(msg), player, this.newPlayerId);
    this.eventHandlers.forEach((h) => client.onEvent(h));
    this.presenceHandlers.forEach((h) => client.onPresence(h));
    this.connectionHandlers.forEach((h) => client.onConnection(h));
    this.client = client;
    await client.join();
  }

  /** The (possibly changed) player of this phone. */
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

  updatePlayer(patch: Partial<PlayerInfo>): void {
    this.client?.updatePlayer(patch);
  }

  close(): void {
    this.host?.stop();
    this.client?.stop();
    this.channel?.close();
  }
}
