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
import type { DmContext, DmEffect, DmResponse, DmTrigger, DungeonMaster } from "../../shared/dm";
import { allowedEffectNames, effectFromName } from "../effects";
import { SKILL_IDS, type SkillId } from "../../shared/rules";
import type { Narration, Story } from "../../shared/story";
import { sceneById } from "../planner";
import { ScriptedDM } from "../scripted";
import { allowedClues, allowedFlags, buildPrompt, eligibleEndings, responseSchema, SYSTEM_PROMPT } from "./prompt";
import { LlmError, type LlmErrorKind, type LlmProvider, type LlmUsage } from "./provider";

export type AiStatus = { kind: "ok"; model: string } | { kind: "thinking" } | { kind: "pause"; reason: string; cause: LlmErrorKind; retryS: number };

/** Why the AI is taking a break, in words for the sofa (shown under the note on the TV). */
export function pauseReason(cause: LlmErrorKind, cooldownS = 60): string {
  const retry = `neuer Versuch in ${cooldownS} Sekunden`;
  switch (cause) {
    case "limit":
      return `Grund: KI-Kontingent gerade erschöpft (zu viele Anfragen) – ${retry}`;
    case "timeout":
      return `Grund: Die KI hat zu lange gebraucht – ${retry}`;
    case "network":
      return `Grund: Keine Verbindung zur KI (Internet?) – ${retry}`;
    case "auth":
      return "Grund: KI-Schlüssel ungültig – bis Spielende erzählt das Drehbuch (⚙️ Einstellungen prüfen)";
    case "bad_json":
      return `Grund: Die KI hat unbrauchbar geantwortet – ${retry}`;
    default:
      return `Grund: Unbekannter Fehler bei der KI – ${retry}`;
  }
}

export interface AiDmOptions {
  onStatus?: (status: AiStatus) => void;
  /** Called for every request sent (for the "KI-Aufrufe heute" counter). */
  onCall?: () => void;
  now?: () => number;
  /** How long to leave the AI alone after a limit error. */
  cooldownMs?: number;
  /** Tokens of every answered call (for the counter in the settings). */
  onUsage?: (usage: LlmUsage) => void;
  /**
   * Saving brake: "full" – the AI for every moment; "important" – only for what really matters
   * (a hero's idea, its roll, the start and end of scenes); "none" – the script tells everything.
   */
  budget?: () => "full" | "important" | "none";
  /** For the DM lab: see the raw exchange. */
  onExchange?: (e: { provider: string; model: string; prompt: string; raw?: unknown; error?: string; ms: number }) => void;
}

/** Which moments go to the AI. Everything else is told by the script (saves free-tier calls). */
const AI_TRIGGERS: DmTrigger["kind"][] = ["scene_start", "free_text", "roll_result", "story_end", "suggest", "rules_question", "idle", "campfire", "final_blow", "npc_moment"];
/** What still gets the AI when the day's budget runs low. */
const IMPORTANT: DmTrigger["kind"][] = ["scene_start", "free_text", "roll_result", "story_end", "final_blow"];
/** Small tasks: the smaller, cheaper model (Flash-Lite) answers first. */
const LITE: DmTrigger["kind"][] = ["suggest", "rules_question", "idle", "npc_moment"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Turns the AI's JSON into a DmResponse, keeping only what is allowed right now. */
export function coerceAiAnswer(raw: unknown, story: Story, ctx: DmContext, trigger: DmTrigger, scripted: DmResponse): DmResponse {
  if (typeof raw !== "object" || raw === null) throw new LlmError("bad_json", "Antwort ist kein Objekt.");
  const o = raw as Record<string, unknown>;
  const narration = str(o.narration, 1200);
  // A character's answer alone is enough (the narrator does not have to speak as well).
  const speaks = !!(str(o.npc_name, 40) && str(o.npc_text, 400));
  if (!narration && !speaks && trigger.kind !== "suggest" && trigger.kind !== "rules_question") throw new LlmError("bad_json", "Antwort ohne Erzähltext.");
  const script: Narration[] = narration ? [{ text: narration }] : [];
  const out: DmResponse = { narration, script, next: "await_action" };
  const npcName = str(o.npc_name, 40);
  const npcText = str(o.npc_text, 400);
  if (npcName && npcText) out.npc_say = { name: npcName, text: npcText.replace(/^[„"“]+|[“"”]+$/g, "") };
  const memory = str(o.npc_memory, 160);
  if (npcName && memory) out.npc_memory = { name: npcName, fact: memory };

  const scene = sceneById(story, ctx.sceneId);
  if (trigger.kind === "free_text") {
    const back = str(o.rueckfrage, 160);
    if (back) out.ask_back = back;
    const skill = str(o.roll_skill, 30) as SkillId;
    const dc = Math.round(Number(o.roll_dc));
    if (SKILL_IDS.includes(skill) && dc >= 5 && dc <= 25) {
      out.request_roll = { playerId: trigger.playerId, ability: getSkill(skill).ability, skill, dc };
      out.next = "await_roll";
      const plan = str(o.plan, 90);
      if (plan) out.plan = plan;
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
  if (trigger.kind === "free_text" || trigger.kind === "roll_result") {
    // Effects from the toolbox; the Director checks them once more against the roll (filterEffects).
    const allowed = allowedEffectNames(ctx, trigger);
    const raw = Array.isArray(o.effects) ? (o.effects as unknown[]) : [];
    const effects = raw
      .map((e) => (typeof e === "object" && e ? (e as Record<string, unknown>) : {}))
      .filter((e) => allowed.includes(str(e.name, 30)))
      .map((e) => effectFromName(str(e.name, 30), str(e.target, 60) || undefined, ctx, str(e.severity, 10), str(e.art, 20) || undefined, str(e.richtung, 60) || undefined))
      .filter((e): e is DmEffect => !!e);
    // A small chain: walk there, then up to three things (the Director checks them against the roll).
    if (effects.length) out.effects = effects.slice(0, 4);
    const att = o.npc_attitude as { npc?: unknown; change?: unknown } | undefined;
    const change = Math.round(Number(att?.change));
    if (att && typeof att.npc === "string" && story.npcs.some((n) => n.id === att.npc) && change && Math.abs(change) <= 2) {
      out.npc_attitude = { npc: att.npc, change };
    }
  }
  if (trigger.kind === "rules_question") {
    const answer = str(o.answer, 900);
    if (!answer) throw new LlmError("bad_json", "Antwort ohne Text.");
    out.answer = answer;
  }
  if (trigger.kind === "suggest") {
    out.ideas = (Array.isArray(o.ideas) ? o.ideas : []).filter((i): i is string => typeof i === "string").map((i) => i.slice(0, 90)).slice(0, 4);
  }
  if (trigger.kind === "scene_start") {
    // The store for the scene: only for characters that are really here, short and plain.
    const here = (scene.npcs ?? []).map((n) => story.npcs.find((x) => x.id === n.npc)?.name).filter((n): n is string => !!n);
    const greetings = (Array.isArray(o.gruesse) ? o.gruesse : [])
      .map((g) => (typeof g === "object" && g ? (g as Record<string, unknown>) : {}))
      .map((g) => ({ name: str(g.name, 40), text: str(g.text, 160).replace(/^[„"“]+|[“"”]+$/g, "") }))
      .filter((g) => g.text && here.includes(g.name))
      .slice(0, 6);
    const moments = (Array.isArray(o.momente) ? o.momente : []).filter((m): m is string => typeof m === "string" && !!m.trim()).map((m) => m.trim().slice(0, 200)).slice(0, 3);
    if (greetings.length || moments.length) out.pack = { greetings, moments };
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
    const budget = this.opts.budget?.() ?? "full";
    if (budget === "none" || (budget === "important" && !IMPORTANT.includes(trigger.kind))) return scripted;
    const lite = LITE.includes(trigger.kind);
    const req = {
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(this.story, ctx, trigger, scripted),
      schema: responseSchema(this.story, ctx, trigger),
      ...(lite ? { tier: "lite" as const } : {}),
    };
    // Small tasks try the small model first (the server picks it itself from the tier).
    const providers = lite ? [...this.providers.filter((p) => p.lite), ...this.providers.filter((p) => !p.lite)] : this.providers;
    let lastError = "";
    let lastKind: LlmErrorKind = "other";
    this.opts.onStatus?.({ kind: "thinking" });
    for (const provider of providers) {
      // One retry on the same model for a broken answer, then the next model (e.g. Flash-Lite).
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = this.now();
        try {
          this.opts.onCall?.();
          const raw = await provider.complete(req);
          if (provider.lastUsage) this.opts.onUsage?.(provider.lastUsage);
          const answer = coerceAiAnswer(raw, this.story, ctx, trigger, scripted);
          this.opts.onExchange?.({ provider: provider.id, model: provider.model, prompt: req.prompt, raw, ms: this.now() - started });
          this.opts.onStatus?.({ kind: "ok", model: provider.model });
          return answer;
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError("other", String(err));
          lastError = e.message;
          lastKind = e.kind;
          this.opts.onExchange?.({ provider: provider.id, model: provider.model, prompt: req.prompt, error: `${e.kind}: ${e.message}`, ms: this.now() - started });
          if (e.kind === "bad_json" && attempt === 0) continue;
          if (e.kind === "auth") {
            // A wrong key will not get better: drop it for this game (a backup key may still take over).
            this.providers = this.providers.filter((p) => p.id !== provider.id);
            if (this.providers.length) break;
            this.opts.onStatus?.({ kind: "pause", reason: e.message, cause: "auth", retryS: 0 });
            return scripted;
          }
          break; // limit, timeout, network, other → next model
        }
      }
    }
    this.pausedUntil = this.now() + (this.opts.cooldownMs ?? 60_000);
    this.opts.onStatus?.({ kind: "pause", reason: lastError, cause: lastKind, retryS: Math.round((this.opts.cooldownMs ?? 60_000) / 1000) });
    return scripted;
  }
}
