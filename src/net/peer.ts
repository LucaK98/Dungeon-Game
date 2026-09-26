/**
 * Multiplayer between real devices (TV + phones in the same Wi-Fi) with PeerJS.
 * The free public PeerJS server only introduces the devices to each other (no account needed);
 * after that they talk directly (WebRTC). The TV's peer ID is derived from the room code.
 */
import type { GameEvent } from "../shared/events";
import { generateRoomCode, isValidRoomCode } from "../shared/room";
import type { Transport } from "../shared/transport";
import type { PlayerId, PlayerInfo, RoomCode } from "../shared/types";
import { ClientCore } from "./client-core";
import { HostCore } from "./host-core";
import { isWire, type Wire } from "./wire";

/** The parts of PeerJS we use (so tests can plug in a fake network). */
export interface PeerLike {
  readonly id: string;
  readonly disconnected: boolean;
  on(event: "open", cb: (id: string) => void): void;
  on(event: "connection", cb: (conn: ConnLike) => void): void;
  on(event: "disconnected", cb: () => void): void;
  on(event: "error", cb: (err: { type?: string; message?: string }) => void): void;
  connect(id: string, opts?: { reliable?: boolean }): ConnLike;
  reconnect(): void;
  destroy(): void;
}

export interface ConnLike {
  readonly open: boolean;
  on(event: "open", cb: () => void): void;
  on(event: "data", cb: (data: unknown) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  send(data: unknown): void;
  close(): void;
}

export type PeerFactory = (id?: string) => PeerLike;

const PREFIX = "couch-dungeon-v1-";
export const peerIdForRoom = (code: RoomCode) => `${PREFIX}${code}`;

/** Loads PeerJS only when needed (phones and TVs that use local mode never download it). */
async function defaultFactory(): Promise<PeerFactory> {
  const { Peer } = await import("peerjs");
  return (id?: string) => (id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 })) as unknown as PeerLike;
}

function whenOpen(peer: PeerLike): Promise<string> {
  return new Promise((resolve, reject) => {
    peer.on("open", (id) => resolve(id));
    peer.on("error", (err) => reject(err));
  });
}

export class PeerTransport implements Transport {
  private peer: PeerLike | undefined;
  private host: HostCore | undefined;
  private client: ClientCore | undefined;
  /** Host side: open connections and which player they belong to. */
  private conns = new Set<ConnLike>();
  private connOfPlayer = new Map<PlayerId, ConnLike>();
  private helloOfConn = new Map<ConnLike, { playerId: PlayerId; instance: string }>();
  /** Phone side: the connection to the TV. */
  private hostConn: ConnLike | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private eventHandlers: ((e: GameEvent, from: PlayerId | "host") => void)[] = [];
  private presenceHandlers: ((players: PlayerInfo[]) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];
  private replacedHandlers: (() => void)[] = [];

  constructor(
    private newPlayerId: () => PlayerId = () => crypto.randomUUID(),
    private factory?: PeerFactory,
  ) {}

  private async makePeer(id?: string): Promise<PeerLike> {
    this.factory ??= await defaultFactory();
    return this.factory(id);
  }

  // ---------------------------------------------------------------- TV

  async createRoom(preferred?: RoomCode): Promise<RoomCode> {
    // The public server refuses an ID that is still in use: then try another code.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = attempt === 0 && preferred && isValidRoomCode(preferred) ? preferred : generateRoomCode();
      const peer = await this.makePeer(peerIdForRoom(code));
      try {
        await whenOpen(peer);
      } catch (err) {
        peer.destroy();
        if ((err as { type?: string }).type === "unavailable-id") continue;
        throw new Error("Der Vermittlungsserver ist nicht erreichbar. Ist das Internet verbunden?");
      }
      this.peer = peer;
      this.host = new HostCore((msg, to) => this.hostPost(msg, to));
      this.eventHandlers.forEach((h) => this.host!.onEvent(h));
      this.presenceHandlers.forEach((h) => this.host!.onPresence(h));
      peer.on("connection", (conn) => this.acceptConnection(conn));
      peer.on("disconnected", () => this.keepAlive());
      this.host.start();
      return code;
    }
    throw new Error("Kein freier Raum-Code gefunden. Bitte später noch einmal versuchen.");
  }

  private acceptConnection(conn: ConnLike): void {
    this.conns.add(conn);
    // Greet every new link: the phone answers with hello, so we know at once whose link it is (also after a reconnect).
    const greet = () => conn.send({ t: "host-hello" } satisfies Wire);
    if (conn.open) greet();
    else conn.on("open", greet);
    conn.on("data", (data) => {
      if (!isWire(data)) return;
      // Remember which phone is on which connection.
      if (data.t === "hello") {
        this.connOfPlayer.set(data.player.id, conn);
        this.helloOfConn.set(conn, { playerId: data.player.id, instance: data.instance });
      }
      if (data.t === "bye") this.connOfPlayer.delete(data.playerId);
      this.host?.receive(data);
    });
    const drop = () => {
      // The phone closed the app or lost Wi-Fi: show it as offline right away (not only after the timeout).
      const last = this.helloOfConn.get(conn);
      if (last && this.connOfPlayer.get(last.playerId) === conn) this.host?.receive({ t: "bye", ...last });
      this.helloOfConn.delete(conn);
      this.conns.delete(conn);
      for (const [id, c] of this.connOfPlayer) if (c === conn) this.connOfPlayer.delete(id);
    };
    conn.on("close", drop);
    conn.on("error", drop);
  }

  private hostPost(msg: Wire, to?: PlayerId): void {
    // id-taken goes to everyone (the phone recognises its instance); events with a target go to one phone.
    if (to && msg.t === "event") {
      const conn = this.connOfPlayer.get(to);
      if (conn?.open) conn.send(msg);
      return;
    }
    for (const conn of this.conns) if (conn.open) conn.send(msg);
  }

  /** Lost the connection to the PeerJS server: reconnect (existing phone links keep working). */
  private keepAlive(): void {
    if (this.closed || !this.peer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.peer?.disconnected && !this.closed) this.peer.reconnect();
    }, 1500);
  }

  // ---------------------------------------------------------------- phone

  async joinRoom(code: RoomCode, player: PlayerInfo, opts: { claim?: boolean } = {}): Promise<void> {
    const peer = await this.makePeer();
    try {
      await whenOpen(peer);
    } catch {
      throw new Error("Der Vermittlungsserver ist nicht erreichbar. Ist das Handy mit dem Internet verbunden?");
    }
    this.peer = peer;
    peer.on("disconnected", () => this.keepAlive());
    const client = new ClientCore((msg) => this.hostConn?.open && this.hostConn.send(msg), player, this.newPlayerId);
    this.eventHandlers.forEach((h) => client.onEvent(h));
    this.presenceHandlers.forEach((h) => client.onPresence(h));
    this.connectionHandlers.forEach((h) => client.onConnection(h));
    this.replacedHandlers.forEach((h) => client.onReplaced(h));
    client.claim = !!opts.claim;
    // Reconnect to the TV whenever the link drops.
    client.onConnection((connected) => {
      if (!connected) this.connectToHost(code);
    });
    this.client = client;
    await this.connectToHost(code);
    await client.join(8000).catch(() => {
      throw new Error("Kein Spiel mit diesem Code gefunden. Läuft das Spielbrett auf dem Fernseher, und seid ihr im selben WLAN?");
    });
  }

  private connectToHost(code: RoomCode): Promise<void> {
    if (!this.peer || this.closed) return Promise.resolve();
    this.hostConn?.close();
    const conn = this.peer.connect(peerIdForRoom(code), { reliable: true });
    this.hostConn = conn;
    conn.on("data", (data) => {
      if (isWire(data)) this.client?.receive(data);
    });
    conn.on("close", () => {
      if (this.hostConn !== conn || this.closed) return;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => void this.connectToHost(code), 2000);
    });
    return new Promise((resolve) => {
      conn.on("open", () => resolve());
      conn.on("error", () => resolve());
      setTimeout(resolve, 6000);
    });
  }

  get player(): PlayerInfo | undefined {
    return this.client?.player;
  }

  // ---------------------------------------------------------------- shared

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
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.client?.stop();
    this.host?.stop();
    for (const c of this.conns) c.close();
    this.hostConn?.close();
    this.peer?.destroy();
  }
}
