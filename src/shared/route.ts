import { NET_KINDS, type NetKind } from "./transport";

export type Route =
  | { view: "home" }
  | { view: "dm-lab" }
  | { view: "tv"; net: NetKind; demo: boolean }
  | { view: "play"; net: NetKind; room: string | null };

/**
 * Parses the hash route used on GitHub Pages:
 *   #/tv            → board
 *   #/play?room=ABCD → phone
 * `?net=local|peer|supabase` picks the transport. Without it: `local` on this computer
 * (localhost, several tabs), `peer` everywhere else (real TV + phones).
 */
export function defaultNet(hostname: string): NetKind {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "" ? "local" : "peer";
}

export function parseRoute(hash: string, fallbackNet: NetKind = "local"): Route {
  const raw = hash.replace(/^#/, "");
  const [path = "", query = ""] = raw.split("?", 2);
  const params = new URLSearchParams(query);
  const netParam = params.get("net");
  const net: NetKind = NET_KINDS.includes(netParam as NetKind) ? (netParam as NetKind) : fallbackNet;

  switch (path.replace(/\/+$/, "")) {
    case "/dm-lab":
      return { view: "dm-lab" };
    case "/tv":
      return { view: "tv", net, demo: params.has("demo") };
    case "/play": {
      const room = params.get("room")?.trim().toUpperCase() || null;
      return { view: "play", net, room };
    }
    default:
      return { view: "home" };
  }
}
