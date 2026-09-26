import { describe, expect, it } from "vitest";
import type { ConnLike, PeerFactory, PeerLike } from "./peer";
import { PeerTransport, peerIdForRoom } from "./peer";

/** A tiny in-memory stand-in for the PeerJS server + WebRTC links. */
function fakeNetwork() {
  const peers = new Map<string, FakePeer>();
  let n = 0;
  type Handlers = Record<string, ((...a: any[]) => void)[]>;
  const emit = (h: Handlers, ev: string, ...a: unknown[]) => (h[ev] ?? []).forEach((f) => f(...a));

  class FakeConn implements ConnLike {
    open = false;
    other!: FakeConn;
    h: Handlers = {};
    on(ev: string, cb: (...a: any[]) => void) {
      (this.h[ev] ??= []).push(cb);
    }
    send(data: unknown) {
      const copy = structuredClone(data);
      queueMicrotask(() => this.other.open && emit(this.other.h, "data", copy));
    }
    close() {
      if (!this.open) return;
      this.open = this.other.open = false;
      emit(this.h, "close");
      emit(this.other.h, "close");
    }
  }

  class FakePeer implements PeerLike {
    disconnected = false;
    h: Handlers = {};
    constructor(public id: string) {
      setTimeout(() => {
        if (peers.has(id)) emit(this.h, "error", { type: "unavailable-id" });
        else {
          peers.set(id, this);
          emit(this.h, "open", id);
        }
      }, 1);
    }
    on(ev: string, cb: (...a: any[]) => void) {
      (this.h[ev] ??= []).push(cb);
    }
    connect(id: string): ConnLike {
      const mine = new FakeConn();
      const theirs = new FakeConn();
      mine.other = theirs;
      theirs.other = mine;
      setTimeout(() => {
        const target = peers.get(id);
        if (!target) return emit(mine.h, "error", new Error("peer-unavailable"));
        mine.open = theirs.open = true;
        emit(target.h, "connection", theirs);
        emit(mine.h, "open");
        emit(theirs.h, "open");
      }, 1);
      return mine;
    }
    reconnect() {
      this.disconnected = false;
    }
    destroy() {
      if (peers.get(this.id) === this) peers.delete(this.id);
    }
  }
  const factory: PeerFactory = (id) => new FakePeer(id ?? `anon-${++n}`);
  return { factory, peers };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("PeerTransport", () => {
  it("connects phones to the TV and delivers broadcast and private events", async () => {
    const net = fakeNetwork();
    const tv = new PeerTransport(undefined, net.factory);
    const room = await tv.createRoom("ABCD");
    expect(room).toBe("ABCD");
    expect(net.peers.has(peerIdForRoom("ABCD"))).toBe(true);

    const a = new PeerTransport(() => "a2", net.factory);
    const b = new PeerTransport(() => "b2", net.factory);
    await a.joinRoom(room, { id: "a", name: "Anna" });
    await b.joinRoom(room, { id: "b", name: "Ben" });
    await flush();

    const seen: string[] = [];
    tv.onEvent((e, from) => seen.push(`tv<-${from}:${e.type}`));
    a.onEvent((e) => seen.push(`a:${e.type}`));
    b.onEvent((e) => seen.push(`b:${e.type}`));
    tv.send({ type: "narration", lines: [{ text: "Hallo" }] });
    tv.send({ type: "secret_message", text: "nur für Ben" }, "b");
    a.send({ type: "player_action", action: { kind: "end_turn" } });
    await flush();
    expect(seen.sort()).toEqual(["a:narration", "b:narration", "b:secret_message", "tv<-a:player_action"].sort());
    tv.close();
    a.close();
    b.close();
  });

  it("reconnects a phone after its link to the TV dropped", async () => {
    const net = fakeNetwork();
    const tv = new PeerTransport(undefined, net.factory);
    const room = await tv.createRoom("RSTU");
    const a = new PeerTransport(undefined, net.factory);
    await a.joinRoom(room, { id: "a", name: "Anna" });
    await flush();
    (a as unknown as { hostConn: ConnLike }).hostConn.close();
    await new Promise((r) => setTimeout(r, 2300));
    const got: string[] = [];
    a.onEvent((e) => got.push(e.type));
    tv.send({ type: "secret_message", text: "wieder da" }, "a");
    await flush();
    expect(got).toEqual(["secret_message"]);
    tv.close();
    a.close();
  }, 10000);

  it("shows a phone as offline as soon as its link closes", async () => {
    const net = fakeNetwork();
    const tv = new PeerTransport(undefined, net.factory);
    const room = await tv.createRoom("MNOP");
    let players: { id: string; connected?: boolean }[] = [];
    tv.onPresence((p) => (players = p));
    const a = new PeerTransport(undefined, net.factory);
    await a.joinRoom(room, { id: "a", name: "Anna" });
    await flush();
    expect(players.find((p) => p.id === "a")?.connected).toBe(true);
    a.close();
    await flush();
    expect(players.find((p) => p.id === "a")?.connected).toBe(false);
    tv.close();
  });

  it("picks another room code when the ID is taken", async () => {
    const net = fakeNetwork();
    const first = new PeerTransport(undefined, net.factory);
    await first.createRoom("WXYZ");
    const second = new PeerTransport(undefined, net.factory);
    const code = await second.createRoom("WXYZ");
    expect(code).not.toBe("WXYZ");
    first.close();
    second.close();
  });

  it("tells the phone when there is no TV with that code", async () => {
    const net = fakeNetwork();
    const phone = new PeerTransport(undefined, net.factory);
    await expect(phone.joinRoom("QQQQ", { id: "x", name: "X" })).rejects.toThrow(/Kein Spiel/);
    phone.close();
  }, 20000);
});
