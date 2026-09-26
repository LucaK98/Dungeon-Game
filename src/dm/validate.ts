/**
 * The host never trusts the DM blindly (especially not the AI in A8):
 * every instruction is checked against the story and the rules before it is applied.
 */
import { hasMonster } from "../engine/data";
import type { DmResponse } from "../shared/dm";
import type { Scene, Story } from "../shared/story";

export interface ValidationContext {
  story: Story;
  scene: Scene;
  truth: string;
  eventsUsed: string[];
}

export interface Validated {
  response: DmResponse;
  /** What was removed and why (for the DM lab and tests). */
  rejected: string[];
}

/** Resolves a clue reference: a slot of the scene (mapped by truth) or a clue id. */
export function resolveClue(ctx: ValidationContext, ref: string): string | undefined {
  const slot = ctx.scene.clues?.find((c) => c.id === ref);
  const id = slot ? slot.byTruth[ctx.truth] : ref;
  const clue = ctx.story.clues.find((c) => c.id === id);
  if (!clue) return undefined;
  // Never reveal a clue that belongs to another truth.
  if (clue.truth !== null && clue.truth !== ctx.truth) return undefined;
  return clue.id;
}

export function validateResponse(res: DmResponse, ctx: ValidationContext): Validated {
  const out: DmResponse = { ...res };
  const rejected: string[] = [];
  const drop = <K extends keyof DmResponse>(key: K, why: string) => {
    delete out[key];
    rejected.push(`${String(key)}: ${why}`);
  };

  if (typeof out.narration !== "string") out.narration = "";
  if (out.narration.length > 1200) out.narration = out.narration.slice(0, 1200);

  if (out.request_roll && (out.request_roll.dc < 5 || out.request_roll.dc > 25)) drop("request_roll", "SG muss zwischen 5 und 25 liegen");
  if (out.spawn) {
    const ok = out.spawn.every((s) => hasMonster(s.monster) && s.count >= 1 && s.count <= 6);
    if (!ok) drop("spawn", "unbekanntes Monster oder Anzahl außerhalb 1–6");
  }
  if (out.reveal_clue !== undefined) {
    const id = resolveClue(ctx, out.reveal_clue);
    if (!id) drop("reveal_clue", "Hinweis gehört nicht zur ausgewürfelten Wahrheit oder existiert nicht");
    else out.reveal_clue = id;
  }
  if (out.trigger_event !== undefined) {
    const ev = ctx.story.events?.find((e) => e.id === out.trigger_event);
    if (!ev || ctx.eventsUsed.includes(ev.id)) drop("trigger_event", "unbekanntes oder schon benutztes Ereignis");
  }
  if (out.choose_ending !== undefined && out.choose_ending !== null) {
    const ending = ctx.story.endings.find((e) => e.id === out.choose_ending);
    if (!ending || (ending.truths && !ending.truths.includes(ctx.truth))) drop("choose_ending", "Ende passt nicht zur Wahrheit");
  }
  if (out.set_flags) {
    const flags = out.set_flags.filter((f) => typeof f === "string" && /^[a-z0-9_]{1,40}$/.test(f)).slice(0, 5);
    if (flags.length !== out.set_flags.length) rejected.push("set_flags: ungültige Einträge entfernt");
    out.set_flags = flags;
  }
  if (out.npc_attitude && (Math.abs(out.npc_attitude.change) > 3 || !ctx.story.npcs.some((n) => n.id === out.npc_attitude!.npc))) {
    drop("npc_attitude", "unbekannter NPC oder zu große Änderung");
  }
  return { response: out, rejected };
}
