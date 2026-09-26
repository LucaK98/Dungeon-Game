import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCore } from "./client-core";
import { HostCore } from "./host-core";
import type { Wire } from "./wire";

/** Wires one host and several clients together like a BroadcastChannel would. */
function network() {
  let now = 0;
  const clients: ClientCore[] = [];
  const host = new HostCore((msg) => clients.forEach((c) => c.receive(structuredClone(msg))), () => now);
  const connect = (id: string, newId = () => `${id}-neu`) => {
    const c = new ClientCore((msg: Wire) => host.receive(structuredClone(msg)), { id, name: id }, newId, () => now);
    clients.push(c);
    return c;
  };
  return { host, connect, tick: (ms: number) => (now += ms), clients };
}

describe("host and client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins and receives events addressed to everyone or to this player", async () => {
    const net = network();
    net.host.start();
    const a = net.connect("a");
    const b = net.connect("b");
    await Promise.all([a.join(), b.join()]);
    const got: string[] = [];
    a.onEvent((e) => got.push(`a:${e.type}`));
    b.onEvent((e) => got.push(`b:${e.type}`));
    net.host.send({ type: "narration", text: "Hallo" });
    net.host.send({ type: "secret_message", text: "psst" }, "b");
    expect(got).toEqual(["a:narration", "b:narration", "b:secret_message"]);
  });

  it("gives a second open tab with the same stored ID a new one", async () => {
    const net = network();
    net.host.start();
    const first = net.connect("same");
    await first.join();
    const second = net.connect("same");
    await second.join();
    expect(second.player.id).toBe("same-neu");
    expect(net.host.list().map((p) => p.id).sort()).toEqual(["same", "same-neu"]);
  });

  it("lets a reloaded phone take its old seat back", async () => {
    const net = network();
    net.host.start();
    const before = net.connect("p");
    await before.join();
    before.stop(); // page reload sends "bye"
    const after = net.connect("p");
    await after.join();
    expect(after.player.id).toBe("p");
    expect(net.host.list()).toHaveLength(1);
  });

  it("marks silent phones as disconnected", async () => {
    const net = network();
    net.host.start();
    const a = net.connect("a");
    await a.join();
    a.stop();
    net.tick(10_000);
    vi.advanceTimersByTime(1000);
    expect(net.host.list()[0]!.connected).toBe(false);
  });

  it("forwards player events to the host with the sender", async () => {
    const net = network();
    net.host.start();
    const a = net.connect("a");
    await a.join();
    const got: string[] = [];
    net.host.onEvent((e, from) => got.push(`${from}:${e.type}`));
    a.send({ type: "player_action", action: { kind: "end_turn" } });
    expect(got).toEqual(["a:player_action"]);
  });
});
