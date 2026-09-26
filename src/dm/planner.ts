/**
 * Picks the scenes for the chosen game length and keeps an eye on the clock (tempo guard).
 */
import type { Duration, MonsterGroup, Scene, Story } from "../shared/story";

const ORDER: Record<Duration, number> = { kurz: 0, mittel: 1, lang: 2 };

export function allScenes(story: Story): Scene[] {
  return story.acts.flatMap((a) => a.scenes);
}

/** Mandatory scenes always; optional ones from their minimum length on. */
export function planScenes(story: Story, duration: Duration): string[] {
  return allScenes(story)
    .filter((s) => s.pflicht || ORDER[s.mindestDauer] <= ORDER[duration])
    .map((s) => s.id);
}

export function sceneById(story: Story, id: string): Scene {
  const s = allScenes(story).find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
}

export function actOf(story: Story, sceneId: string): { index: number; act: Story["acts"][number] } {
  const index = story.acts.findIndex((a) => a.scenes.some((s) => s.id === sceneId));
  return { index, act: story.acts[index]! };
}

/** Room modules of a scene for the chosen length. */
export function sceneRooms(scene: Scene, duration: Duration): string[] {
  const extra = scene.extraRooms?.[duration] ?? [];
  if (!extra.length) return scene.rooms;
  return [...scene.rooms.slice(0, -1), ...extra, scene.rooms[scene.rooms.length - 1]!];
}

/** Encounter scaling by number of players (built for 2; ±1 per player). */
export function scaleGroup(g: MonsterGroup, players: number): number {
  const extra = Math.max(0, players - 2) * (g.perExtraPlayer ?? 0);
  const fewer = players < 2 && !g.boss && g.count > 1 ? 1 : 0;
  return Math.max(0, g.count + extra - fewer);
}

export interface TempoReport {
  elapsedMin: number;
  plannedMin: number;
  /** >1: slower than planned. */
  ratio: number;
  dropped: string[];
}

/**
 * Tempo guard: compares real play time with the plan after each scene.
 * If the group is more than 15 % behind, upcoming optional scenes are dropped.
 */
export function tempoCheck(story: Story, plan: string[], doneIndex: number, elapsedMin: number): TempoReport {
  const plannedMin = plan.slice(0, doneIndex + 1).reduce((s, id) => s + sceneById(story, id).dauer_min, 0);
  const ratio = plannedMin ? elapsedMin / plannedMin : 1;
  const dropped: string[] = [];
  if (ratio > 1.15) {
    let overMin = elapsedMin - plannedMin;
    for (const id of plan.slice(doneIndex + 1)) {
      const s = sceneById(story, id);
      if (s.pflicht || overMin <= 0) continue;
      dropped.push(id);
      overMin -= s.dauer_min;
    }
  }
  return { elapsedMin, plannedMin, ratio, dropped };
}

export function plannedMinutes(story: Story, plan: string[]): number {
  return plan.reduce((s, id) => s + sceneById(story, id).dauer_min, 0);
}
