import { describe, expect, it } from "vitest";
import type { ChannelFactory, ChannelLike } from "./supabase";
import { SupabaseTransport, topicForRoom } from "./supabase";

/** In-memory stand-in for Supabase Realtime broadcast (no echo to the sender, like self: false). */
function fakeRealtime() {
  const topics = new Map<string, Set<FakeChannel>>();
  class FakeChannel implements ChannelLike {
    private handlers: ((m: { payload?: unknown }) => void)[] = [];
    constructor(private topic: string) {}
    on(_t: "broadcast", _f: { event: string }, cb: (m: { payload?: unknown }) => void) {
      this.handlers.push(cb);
      return this;
    }
    subscribe(cb: (status: string) => void) {
      if (!topics.has(this.topic)) topics.set(this.topic, new Set());
      topics.get(this.topic)!.add(this);
      setTimeout(() => cb("SUBSCRIBED"), 1);
      return this;
    }
    async send(msg: { payload: unknown }) {
      const copy = structuredClone(msg.payload);
      for (const other of topics.get(this.topic) ?? []) if (other !== this) setTimeout(() => other.handlers.forEach((h) => h({ payload: copy })), 1);
      return "ok";
    }
    async unsubscribe() {
      topics.get(this.topic)?.delete(this);
      return "ok";
    }
  }
  const factory: ChannelFactory = (topic) => new FakeChannel(topic);
  return { factory, topics };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe("SupabaseTransport", () => {
  it("connects phones and delivers broadcast and private events", async () => {
    const rt = fakeRealtime();
    const tv = new SupabaseTransport(undefined, rt.factory);
    const room = await tv.createRoom("ABCD");
    expect(rt.topics.has(topicForRoom("ABCD"))).toBe(true);
    const a = new SupabaseTransport(() => "a2", rt.factory);
    const b = new SupabaseTransport(() => "b2", rt.factory);
    await a.joinRoom(room, { id: "a", name: "Anna" });
    await b.joinRoom(room, { id: "b", name: "Ben" });
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

  it("tells the phone when no TV has this code", async () => {
    const rt = fakeRealtime();
    const phone = new SupabaseTransport(undefined, rt.factory);
    await expect(phone.joinRoom("QQQQ", { id: "x", name: "X" })).rejects.toThrow(/Kein Spiel/);
  }, 15000);

  it("gives a reopened phone its seat back", async () => {
    const rt = fakeRealtime();
    const tv = new SupabaseTransport(undefined, rt.factory);
    const room = await tv.createRoom("WXYZ");
    let players: { id: string; connected?: boolean }[] = [];
    tv.onPresence((p) => (players = p));
    const first = new SupabaseTransport(() => "neu", rt.factory);
    await first.joinRoom(room, { id: "p", name: "Pia" });
    let replaced = false;
    first.onReplaced(() => (replaced = true));
    // App killed without goodbye, reopened on the same phone.
    const again = new SupabaseTransport(() => "neu", rt.factory);
    await again.joinRoom(room, { id: "p", name: "Pia" }, { claim: true });
    await flush();
    expect(again.player!.id).toBe("p");
    expect(replaced).toBe(true);
    expect(players.filter((p) => p.connected !== false).map((p) => p.id)).toEqual(["p"]);
    tv.close();
    again.close();
  });

  it("reports when the server can't be reached", async () => {
    const failing: ChannelFactory = () => ({
      on() {
        return this;
      },
      subscribe(cb: (s: string) => void) {
        setTimeout(() => cb("CHANNEL_ERROR"), 1);
      },
      send: async () => "error",
      unsubscribe: async () => "ok",
    });
    await expect(new SupabaseTransport(undefined, failing).createRoom()).rejects.toThrow(/Spiel-Server/);
  });
});
