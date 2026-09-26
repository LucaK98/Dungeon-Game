/**
 * The AI game master (hybrid): the scripted DM still provides the frame (scenes, goals,
 * twist, fights). The AI retells scene openings in its own words, reacts to free actions,
 * asks for rolls and picks the ending. Rules and numbers stay in code.
 *
 * Budget: at most one AI call per player action; nothing for moves or ordinary attacks.
 * Every AI answer is checked here (only allowed clues/flags/endings, sane DCs) and again by
 * `validateResponse` in the Director. Any failure → the scripted answer, the game goes on.
 */
import { getSkill } from "../../engine/data";
import type { DmContext, DmResponse, DmTrigger, DungeonMaster } from "../../shared/dm";
import { SKILL_IDS, type SkillId } from "../../shared/rules";
import type { Narration, Story } from "../../shared/story";
import { sceneById } from "../planner";
import { ScriptedDM } from "../scripted";
import { allowedClues, allowedFlags, buildPrompt, eligibleEndings, responseSchema, SYSTEM_PROMPT } from "./prompt";
import { LlmError, type LlmProvider } from "./provider";

export type AiStatus = { kind: "ok"; model: string } | { kind: "thinking" } | { kind: "pause"; reason: string };

export interface AiDmOptions {
  onStatus?: (status: AiStatus) => void;
  /** Called for every request sent (for the "KI-Aufrufe heute" counter). */
  onCall?: () => void;
  now?: () => number;
  /** How long to leave the AI alone after a limit error. */
  cooldownMs?: number;
  /** For the DM lab: see the raw exchange. */
  onExchange?: (e: { provider: string; model: string; prompt: string; raw?: unknown; error?: string; ms: number }) => void;
}

/** Which moments go to the AI. Everything else is told by the script (saves free-tier calls). */
const AI_TRIGGERS: DmTrigger["kind"][] = ["scene_start", "free_text", "roll_result", "story_end"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Turns the AI's JSON into a DmResponse, keeping only what is allowed right now. */
export function coerceAiAnswer(raw: unknown, story: Story, ctx: DmContext, trigger: DmTrigger, scripted: DmResponse): DmResponse {
  if (typeof raw !== "object" || raw === null) throw new LlmError("bad_json", "Antwort ist kein Objekt.");
  const o = raw as Record<string, unknown>;
  const narration = str(o.narration, 1200);
  if (!narration) throw new LlmError("bad_json", "Antwort ohne Erzähltext.");
  const script: Narration[] = [{ text: narration }];
  const out: DmResponse = { narration, script, next: "await_action" };
  const npcName = str(o.npc_name, 40);
  const npcText = str(o.npc_text, 400);
  if (npcName && npcText) out.npc_say = { name: npcName, text: npcText.replace(/^[„"“]+|[“"”]+$/g, "") };

  const scene = sceneById(story, ctx.sceneId);
  if (trigger.kind === "free_text") {
    const skill = str(o.roll_skill, 30) as SkillId;
    const dc = Math.round(Number(o.roll_dc));
    if (SKILL_IDS.includes(skill) && dc >= 5 && dc <= 25) {
      out.request_roll = { playerId: trigger.playerId, ability: getSkill(skill).ability, skill, dc };
      out.next = "await_roll";
    }
  }
  if (trigger.kind === "free_text" || trigger.kind === "roll_result") {
    const clue = str(o.reveal_clue, 60);
    // Clues only for a success or a plain good idea, never on a failed roll.
    const earned = trigger.kind === "free_text" ? !out.request_roll : trigger.success;
    if (earned && allowedClues(story, scene, ctx).some((c) => c.id === clue)) out.reveal_clue = clue;
    const ok = allowedFlags(scene).map((f) => f.flag);
    const flags = Array.isArray(o.set_flags) ? o.set_flags.filter((f): f is string => typeof f === "string" && ok.includes(f)) : [];
    if (flags.length && earned) out.set_flags = flags.slice(0, 3);
  }
  if (trigger.kind === "scene_start") {
    // Keep the scripted beginner tips; the AI replaces only the plain text.
    const tips = (scripted.script ?? []).filter((l) => l.tip);
    out.script = [...script, ...tips];
  }
  if (trigger.kind === "story_end") {
    const ending = str(o.ending, 60);
    const eligible = eligibleEndings(story, ctx);
    out.choose_ending = eligible.some((e) => e.id === ending) ? ending : (scripted.choose_ending ?? eligible[0]!.id);
    out.next = "end_scene";
  }
  return out;
}

export class AiDM implements DungeonMaster {
  private scripted: ScriptedDM;
  private pausedUntil = 0;
  private now: () => number;

  constructor(
    private story: Story,
    private providers: LlmProvider[],
    private opts: AiDmOptions = {},
  ) {
    this.scripted = new ScriptedDM(story);
    this.now = opts.now ?? Date.now;
  }

  async respond(ctx: DmContext, trigger: DmTrigger): Promise<DmResponse> {
    const scripted = await this.scripted.respond(ctx, trigger);
    if (!AI_TRIGGERS.includes(trigger.kind) || !this.providers.length) return scripted;
    if (this.now() < this.pausedUntil) return scripted;
    const req = {
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(this.story, ctx, trigger, scripted),
      schema: responseSchema(this.story, ctx, trigger),
    };
    let lastError = "";
    this.opts.onStatus?.({ kind: "thinking" });
    for (const provider of this.providers) {
      // One retry on the same model for a broken answer, then the next model (e.g. Flash-Lite).
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = this.now();
        try {
          this.opts.onCall?.();
          const raw = await provider.complete(req);
          const answer = coerceAiAnswer(raw, this.story, ctx, trigger, scripted);
          this.opts.onExchange?.({ provider: provider.id, model: provider.model, prompt: req.prompt, raw, ms: this.now() - started });
          this.opts.onStatus?.({ kind: "ok", model: provider.model });
          return answer;
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError("other", String(err));
          lastError = e.message;
          this.opts.onExchange?.({ provider: provider.id, model: provider.model, prompt: req.prompt, error: `${e.kind}: ${e.message}`, ms: this.now() - started });
          if (e.kind === "bad_json" && attempt === 0) continue;
          if (e.kind === "auth") {
            // A wrong key will not get better: stay with the script for this game.
            this.providers = [];
            this.opts.onStatus?.({ kind: "pause", reason: e.message });
            return scripted;
          }
          break; // limit, timeout, network, other → next model
        }
      }
    }
    this.pausedUntil = this.now() + (this.opts.cooldownMs ?? 60_000);
    this.opts.onStatus?.({ kind: "pause", reason: lastError });
    return scripted;
  }
}
