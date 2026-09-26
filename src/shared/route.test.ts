import { describe, expect, it } from "vitest";
import { defaultNet, parseRoute } from "./route";

describe("parseRoute", () => {
  it("falls back to home", () => {
    expect(parseRoute("")).toEqual({ view: "home" });
    expect(parseRoute("#/unbekannt")).toEqual({ view: "home" });
  });

  it("parses the TV route", () => {
    expect(parseRoute("#/tv")).toEqual({ view: "tv", net: "local", demo: false });
    expect(parseRoute("#/tv?net=peer")).toEqual({ view: "tv", net: "peer", demo: false });
    expect(parseRoute("#/tv?demo")).toEqual({ view: "tv", net: "local", demo: true });
  });

  it("parses the phone route with room code", () => {
    expect(parseRoute("#/play?room=abcd")).toEqual({ view: "play", net: "local", room: "ABCD" });
    expect(parseRoute("#/play")).toEqual({ view: "play", net: "local", room: null });
  });

  it("ignores unknown transports", () => {
    expect(parseRoute("#/tv", "peer")).toEqual({ view: "tv", net: "peer", demo: false });
    expect(defaultNet("localhost")).toBe("local");
    expect(defaultNet("lucak98.github.io")).toBe("supabase");
    expect(parseRoute("#/tv?net=carrier-pigeon")).toEqual({ view: "tv", net: "local", demo: false });
  });
});
