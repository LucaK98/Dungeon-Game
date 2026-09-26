import { describe, expect, it } from "vitest";
import { seededRng, type Rng } from "../engine/rng";
import { isWalkable } from "../map/walk";
import { defaultLook } from "../shared/doll";
import type { DungeonMap } from "../shared/map";
import type { Story } from "../shared/story";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";
import { Director, newStoryState, type StoryResult } from "./director";
import { allScenes, planScenes, sceneById, tempoCheck } from "./planner";
import { ScriptedDM } from "./scripted";
import type { DungeonMaster } from "../shared/dm";
import { AiDM } from "./ai/aidm";
import { LlmError, type LlmProvider } from "./ai/provider";
import storyJson from "./stories/drachenfels.json";
import { STORIES } from "./stories";

const STORY = storyJson as unknown as Story;

const HEROES = [
  { name: "Brunhild", classId: "fighter", raceId: "human" },
  { name: "Siegfried", classId: "paladin", raceId: "human" },
  { name: "Thorgrim", classId: "cleric", raceId: "dwarf" },
  { name: "Pip", classId: "rogue", raceId: "halfling" },
  { name: "Ilmarin", classId: "wizard", raceId: "elf" },
  { name: "Kriemhild", classId: "fighter", raceId: "dwarf" },
];

function walkDistances(map: DungeonMap, goals: { x: number; y: number }[]): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier = goals.map((g) => ({ ...g }));
  frontier.forEach((g) => dist.set(`${g.x},${g.y}`, 0));
  for (let d = 1; frontier.length; d++) {
    const next: { x: number; y: number }[] = [];
    for (const p of frontier) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const q = { x: p.x + dx, y: p.y + dy };
          const k = `${q.x},${q.y}`;
          if (dist.has(k) || !isWalkable(map, q)) continue;
          dist.set(k, d);
          next.push(q);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** Plays the story with simple bots that use the same messages as the phones. */
async function playStory(opts: { story?: Story; seed: number; duration: "kurz" | "mittel" | "lang"; truth?: string; players?: number; slow?: boolean; dm?: DungeonMaster; freeText?: boolean }) {
  let clock = 0;
  const rng: Rng = seededRng(opts.seed);
  const botRng = seededRng(opts.seed + 1000);
  const heroes = HEROES.slice(0, opts.players ?? 4);
  const session = createSession(rng, {
    players: heroes.map((h, i) => ({ playerId: `p${i}`, profile: { ...h, look: defaultLook(h.classId, h.raceId), color: "#fff" } })),
    plan: { path: ["burghof"] },
  });
  for (const c of Object.values(session.battle.creatures)) if (c.kind === "monster") delete session.battle.creatures[c.id];
  let lastError = "";
  const game = new GameController(session, rng, (_to, e) => { if (e.type === "action_error") lastError = e.reason; }, () => {}, { monsterDelayMs: 0 });
  game.start();
  const story = opts.story ?? STORY;
  const state = newStoryState(story, rng, opts.duration, opts.truth);
  const narration: string[] = [];
  game.on({ narration: (lines) => narration.push(...lines.map((l) => l.text)) });
  let result: StoryResult | undefined;
  const director = new Director(story, state, game, opts.dm ?? new ScriptedDM(story), rng, { duration: opts.duration, ...(opts.slow ? { now: () => clock } : {}), onEnd: (r) => (result = r) });
  const run = director.run();
  let guard = 0;
  while (!result && guard++ < 20000) {
    await new Promise((r) => setTimeout(r, 0));
    // A slow table: every move takes a minute and a half.
    clock += 90_000;
    if (process.env.DEBUG_STORY && guard % 1000 === 0) {
      const d = director as unknown as { stepId?: string; scene?: { id: string } };
      console.log(guard, state.sceneIndex, d.scene?.id, d.stepId, game.mode, game.active()?.name, JSON.stringify(game.heroes().map((h) => h.pos)), game.viewFor(game.heroes()[0]!.playerId!)?.story?.choices.map((c) => `${c.label}:${c.enabled}`));
      const a = game.active();
      if (a?.playerId) {
        const v = game.viewFor(a.playerId)!;
        console.log("  mine", v.turn.mine, "move", v.turn.movementLeftFt, "reach", v.minimap.reachable.length, "enemies", JSON.stringify(Object.values(game.session.battle.creatures).filter((c) => c.side === "enemy").map((c) => [c.name, c.pos, c.dead, c.hp])), "pending", !!v.pendingRoll, "err", lastError, JSON.stringify(v.choices.filter((c) => c.enabled).map((c) => c.id)));
        const { mapToAscii } = await import("../map/ascii");
        if (guard === 1000) console.log(mapToAscii(game.map));
      }
    }
    const pids = game.heroes().map((h) => h.playerId!);
    // 1. open rolls
    const rolling = pids.map((p) => game.viewFor(p)!).find((v) => v.pendingRoll);
    if (rolling) {
      game.handle(rolling.me.playerId!, { kind: "roll", rollId: rolling.pendingRoll!.id });
      continue;
    }
    // 2. story decisions (random but reproducible, prefer recommended)
    const v0 = game.viewFor(pids[0]!)!;
    const choices = v0.story?.choices.filter((c) => c.enabled) ?? [];
    if (choices.length) {
      const pick = choices.find((c) => c.recommended) ?? choices[botRng.int(0, choices.length - 1)]!;
      game.handle(pids[botRng.int(0, pids.length - 1)]!, pick.action);
      continue;
    }
    // 3. the active hero acts
    const active = game.active();
    if (!active?.playerId) continue;
    const pid = active.playerId;
    const view = game.viewFor(pid)!;
    if (!view.turn.mine) continue;
    const attack = view.choices.find((c) => c.enabled && c.group === "attack" && c.targets?.length);
    if (attack && attack.action.kind === "attack") {
      game.handle(pid, { ...attack.action, targetId: attack.targets![0]!.id });
      continue;
    }
    const chest = view.choices.find((c) => c.enabled && c.id.startsWith("open:"));
    if (chest) {
      game.handle(pid, chest.action);
      continue;
    }
    if (opts.freeText && game.mode !== "combat" && botRng.int(1, 12) === 1) {
      game.handle(pid, { kind: "free_text", text: "Ich untersuche die Wand nach geheimen Zeichen" });
      await new Promise((r) => setTimeout(r, 0));
    }
    const map = game.map;
    const creatures = Object.values(game.session.battle.creatures);
    let goals: { x: number; y: number }[] = [];
    if (game.mode === "combat") goals = creatures.filter((c) => c.side === "enemy" && !c.dead && c.pos).map((c) => c.pos!);
    else {
      const closedChests = map.objects.filter((o) => o.kind === "chest" && o.state !== "open");
      const npcs = creatures.filter((c) => c.side === "neutral" && c.pos).map((c) => c.pos!);
      const lastRoom = map.rooms[map.rooms.length - 1]!;
      goals = [...npcs, ...closedChests.map((o) => ({ x: o.x, y: o.y })), { x: lastRoom.x + Math.floor(lastRoom.w / 2), y: lastRoom.y + Math.floor(lastRoom.h / 2) }];
      // Go to the next goal in the list that isn't reached yet.
      const here = active.pos!;
      goals = goals.filter((g) => Math.max(Math.abs(g.x - here.x), Math.abs(g.y - here.y)) > 1).slice(0, 1);
    }
    const reach = view.minimap.reachable;
    if (goals.length && reach.length && view.turn.movementLeftFt > 0) {
      const field = walkDistances(map, goals);
      const d = (p: { x: number; y: number }) => {
        let best = field.get(`${p.x},${p.y}`) ?? 9999;
        // Goals are blocked squares (NPC, chest): standing next to them is fine.
        for (const g of goals) best = Math.min(best, Math.max(Math.abs(g.x - p.x), Math.abs(g.y - p.y)) <= 1 ? 0 : best);
        return best;
      };
      // The minimap only shows the surroundings; that's enough to walk step by step.
      const best = [...reach].sort((a, b) => d(a) - d(b))[0]!;
      if (d(best) < d(active.pos!)) {
        game.handle(pid, { kind: "move", to: best });
        continue;
      }
    }
    game.handle(pid, { kind: "end_turn" });
  }
  await Promise.race([run, new Promise((r) => setTimeout(r, 10))]);
  if (process.env.DEBUG_STORY) console.log("HEROES", game.heroes().map((h) => `${h.name} ${h.hp}/${h.maxHp} L${h.pc?.level} pos ${JSON.stringify(h.pos)}`).join(" | "), "\nLAST", narration.slice(-14).join(" / "), "\nMONSTERS", JSON.stringify(Object.values(game.session.battle.creatures).filter((c) => c.kind === "monster").map((c) => [c.name, c.hp, c.dead, c.pos])));
  if (process.env.DEBUG_STORY) console.log("END", result?.ending.id, state.sceneIndex, state.plan.length, state.dropped, state.flags.join(","));
  game.destroy();
  return { result, state, narration, guard };
}

for (const STORY of STORIES) {
  describe(`story format: ${STORY.id}`, () => {
    it("plans only mandatory scenes for Kurz and more for longer games", () => {
      const kurz = planScenes(STORY, "kurz");
      const mittel = planScenes(STORY, "mittel");
      const lang = planScenes(STORY, "lang");
      expect(kurz.every((id) => sceneById(STORY, id).pflicht)).toBe(true);
      expect(mittel.length).toBeGreaterThan(kurz.length);
      expect(lang.length).toBeGreaterThan(mittel.length);
      expect(kurz[0]).toBe(STORY.acts[0]!.scenes[0]!.id);
    });

    it("gives every truth at least three clues in mandatory scenes", () => {
      for (const truth of STORY.truths) {
        const clues = allScenes(STORY)
          .filter((s) => s.pflicht)
          .flatMap((s) => s.clues ?? [])
          .map((slot) => STORY.clues.find((c) => c.id === slot.byTruth[truth.id]))
          .filter((c) => c && c.truth === truth.id);
        expect(clues.length, truth.id).toBeGreaterThanOrEqual(3);
      }
    });

    it("never puts a clue of another truth into a slot", () => {
      for (const s of allScenes(STORY)) {
        for (const slot of s.clues ?? []) {
          for (const [truth, clueId] of Object.entries(slot.byTruth)) {
            const clue = STORY.clues.find((c) => c.id === clueId);
            expect(clue, `${s.id}/${slot.id}/${truth}`).toBeDefined();
            expect(clue!.truth === null || clue!.truth === truth, `${s.id}/${slot.id}: ${clueId} for ${truth}`).toBe(true);
          }
        }
      }
    });

    it("references only existing monsters, rooms, NPCs and steps", async () => {
      const { MODULES } = await import("../map/modules");
      const { hasMonster } = await import("../engine/data");
      for (const s of allScenes(STORY)) {
        for (const r of [...s.rooms, ...Object.values(s.extraRooms ?? {}).flat()]) expect(MODULES.some((m) => m.id === r), `${s.id}: ${r}`).toBe(true);
        for (const n of s.npcs ?? []) expect(STORY.npcs.some((x) => x.id === n.npc), `${s.id}: ${n.npc}`).toBe(true);
        const groups = s.steps.flatMap((st) => [
          ...(st.fight ?? []),
          ...(st.choices ?? []).flatMap((c) => [...(c.outcome?.fight ?? []), ...(c.check?.success.fight ?? []), ...(c.check?.failure.fight ?? [])]),
        ]);
        for (const g of groups) expect(hasMonster(g.monster), `${s.id}: ${g.monster}`).toBe(true);
        const ids = s.steps.map((st) => st.id);
        const gotos = s.steps.flatMap((st) => (st.choices ?? []).flatMap((c) => [c.outcome?.goto, c.check?.success.goto, c.check?.failure.goto]));
        for (const g of gotos) if (g) expect(ids, `${s.id}: goto ${g}`).toContain(g);
      }
      for (const n of STORY.npcs) expect(hasMonster(n.monster), n.id).toBe(true);
    });

    it("drops optional scenes when the group is too slow (tempo guard)", () => {
      const plan = planScenes(STORY, "mittel");
      const report = tempoCheck(STORY, plan, 0, 40);
      expect(report.ratio).toBeGreaterThan(1.15);
      expect(report.dropped.length).toBeGreaterThan(0);
      expect(report.dropped.every((id) => !sceneById(STORY, id).pflicht)).toBe(true);
      expect(tempoCheck(STORY, plan, 0, 8).dropped).toEqual([]);
    });
  });

  describe(`playing: ${STORY.id}`, () => {
    for (const duration of ["kurz", "mittel", "lang"] as const) {
      it(`can be played from start to end (${duration})`, async () => {
        const { result, state, guard } = await playStory({ story: STORY, seed: 11, duration });
        expect(guard).toBeLessThan(20000);
        expect(result, `ended (${state.sceneIndex}/${state.plan.length})`).toBeDefined();
        // Either all scenes were played, or the final fight was lost ("second chance" ending).
        if (result!.ending.id === "scheitern") expect(state.sceneIndex).toBe(state.plan.length - 1);
        else expect(state.sceneIndex).toBe(state.plan.length);
        expect(result!.truth.id).toBe(state.truth);
      }, 60_000);
    }

    for (const truth of STORY.truths.map((t) => t.id)) {
      it(`reveals only clues of the rolled truth (${truth})`, async () => {
        const { result, state } = await playStory({ story: STORY, seed: 20 + truth.charCodeAt(0), duration: "mittel", truth });
        expect(result).toBeDefined();
        for (const id of state.clues) {
          const clue = STORY.clues.find((c) => c.id === id)!;
          expect(clue.truth === null || clue.truth === truth, `${id} with truth ${truth}`).toBe(true);
        }
        expect(state.clues.filter((id) => STORY.clues.find((c) => c.id === id)!.truth === truth).length).toBeGreaterThanOrEqual(3);
        expect(state.twistRevealed).toBe(true);
      }, 60_000);
    }

    it("the tempo guard really skips optional scenes of a slow group", async () => {
      const { state, result } = await playStory({ story: STORY, seed: 5, duration: "mittel", slow: true });
      expect(result).toBeDefined();
      expect(state.dropped.length).toBeGreaterThan(0);
    }, 60_000);

    it("can be won (not every game ends in defeat)", async () => {
      const endings: string[] = [];
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { result } = await playStory({ story: STORY, seed, duration: "kurz" });
        endings.push(result!.ending.id);
      }
      expect(endings.filter((e) => e !== "scheitern").length, endings.join(",")).toBeGreaterThan(0);
    }, 120_000);

    it("works with six players", async () => {
      const { result, state } = await playStory({ story: STORY, seed: 8, duration: "kurz", players: 6 });
      expect(result).toBeDefined();
      expect(state.sceneIndex).toBeGreaterThanOrEqual(state.plan.length - 1);
    }, 60_000);

    for (const duration of ["mittel", "lang"] as const) {
      it(`works with six players (${duration})`, async () => {
        const { result, state } = await playStory({ story: STORY, seed: 9, duration, players: 6 });
        expect(result).toBeDefined();
        expect(state.sceneIndex).toBeGreaterThanOrEqual(state.plan.length - 1);
      }, 90_000);
    }

    it("works with a single player", async () => {
      const { result } = await playStory({ story: STORY, seed: 3, duration: "kurz", players: 1 });
      expect(result).toBeDefined();
    }, 60_000);
  });
}

describe("AI game master in a whole story", () => {
  it("finishes the story even when the AI answers badly, hits limits or asks for rolls", async () => {
    const rng = seededRng(77);
    let calls = 0;
    let statusPause = 0;
    const flaky: LlmProvider = {
      id: "gemini",
      model: "fake-flash",
      async complete(req) {
        calls++;
        const n = rng.int(1, 6);
        if (n === 1) throw new LlmError("limit", "429");
        if (n === 2) return { nonsense: true };
        if (n === 3) throw new LlmError("timeout", "slow");
        const wantsRoll = req.prompt.includes("möchte etwas Eigenes tun");
        return {
          narration: "Die Fackeln flackern, und ein kalter Wind weht durch die Halle.",
          npc_name: "",
          npc_text: "",
          ...(wantsRoll ? { roll_skill: "investigation", roll_dc: 12, reveal_clue: "gibt-es-nicht" } : {}),
          ...(req.prompt.includes("MÖGLICHE ENDEN") ? { ending: "erfunden" } : {}),
        };
      },
    };
    const dm = new AiDM(STORY, [flaky], { cooldownMs: 0, onStatus: (s) => s.kind === "pause" && statusPause++ });
    const { result, narration } = await playStory({ seed: 5, duration: "kurz", dm, freeText: true });
    expect(result).toBeDefined();
    expect(STORY.endings.some((e) => e.id === result!.ending.id)).toBe(true);
    expect(calls).toBeGreaterThan(3);
    expect(statusPause).toBeGreaterThan(0);
    expect(narration.some((t) => t.includes("kalter Wind"))).toBe(true);
  }, 60000);
});
