import { describe, expect, it } from "vitest";
import { cloudLoad, cloudSave, formatCode, isCloudCode, newCloudId, normalizeCode } from "./cloud-save";

function fakeFetch(db: Map<string, { data: unknown; token: string }>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (url.endsWith("/couch_dungeon_save")) {
      const code = body.p_code as string;
      const old = db.get(code);
      if (old && old.token !== body.p_token) return ok(false);
      db.set(code, { data: body.p_data, token: body.p_token as string });
      return ok(true);
    }
    if (url.endsWith("/couch_dungeon_load")) return ok(db.get(body.p_code as string)?.data ?? null);
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("cloud saves", () => {
  it("makes readable codes and secret tokens", () => {
    const id = newCloudId();
    expect(isCloudCode(id.code)).toBe(true);
    expect(id.code).not.toMatch(/[01IO]/);
    expect(id.token.length).toBe(32);
    expect(formatCode("ABCD2345")).toBe("ABCD-2345");
    expect(normalizeCode(" abcd-2345 ")).toBe("ABCD2345");
  });

  it("saves and loads; nobody else can overwrite a save", async () => {
    const db = new Map();
    const { impl, calls } = fakeFetch(db);
    const id = newCloudId();
    expect(await cloudSave(id, { state: 1 }, impl)).toBe(true);
    expect(await cloudLoad(formatCode(id.code).toLowerCase(), impl)).toEqual({ state: 1 });
    expect(await cloudSave({ code: id.code, token: "x".repeat(32) }, { state: 2 }, impl)).toBe(false);
    expect(await cloudLoad(id.code, impl)).toEqual({ state: 1 });
    // The token never goes into the load request.
    expect(calls.filter((c) => c.url.endsWith("_load")).every((c) => !("p_token" in c.body))).toBe(true);
  });

  it("stays quiet when offline or the code is wrong", async () => {
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await cloudSave(newCloudId(), {}, broken)).toBe(false);
    expect(await cloudLoad("ABCD2345", broken)).toBeUndefined();
    expect(await cloudLoad("kurz", broken)).toBeUndefined();
  });
});
