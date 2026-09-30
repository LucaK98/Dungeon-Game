/**
 * A one-way picture stream from the TV to viewers at home (the "Zuschauer-Bildschirm").
 * It runs on its own channel next to the game's, so phones never download the board.
 * Over the internet it uses Supabase Realtime (also when the phones use PeerJS);
 * on one computer (net=local) a BroadcastChannel.
 */
import { defaultFactory, type ChannelLike } from "./supabase";

export interface Stream {
  publish(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  close(): void;
}

const EVENT = "m";

export async function openStream(code: string, local: boolean): Promise<Stream> {
  const handlers: ((msg: unknown) => void)[] = [];
  if (local) {
    const ch = new BroadcastChannel(`couch-dungeon/${code}/watch`);
    ch.onmessage = (e: MessageEvent) => handlers.forEach((h) => h(e.data));
    return { publish: (m) => ch.postMessage(m), onMessage: (cb) => handlers.push(cb), close: () => ch.close() };
  }
  const factory = await defaultFactory();
  const ch: ChannelLike = factory(`couch-dungeon-v1:${code}:watch`);
  ch.on("broadcast", { event: EVENT }, ({ payload }) => handlers.forEach((h) => h(payload)));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 10000);
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
  return {
    publish: (m) => void ch.send({ type: "broadcast", event: EVENT, payload: m }).catch(() => {}),
    onMessage: (cb) => handlers.push(cb),
    close: () => void ch.unsubscribe(),
  };
}
