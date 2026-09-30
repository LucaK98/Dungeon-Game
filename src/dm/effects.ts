/**
 * The effect toolbox for free actions. The DM (AI or script) chooses effects by name;
 * this module decides what is allowed right now (fight or not, roll result, bosses, gold),
 * so the AI can be creative but never breaks the rules.
 *
 * Degrees of success:
 *   no roll      → only "helfen" or "deckung" (no dice needed)
 *   success      → 1 effect, 2 if the roll beat the DC by 5 or more
 *   near miss    → (missed by 1–2) 1 effect, but the hero pays a price ("ja, aber")
 *   clear miss   → a setback: something goes wrong (never nothing at all)
 */
import type { DmContext, DmEffect, DmTrigger } from "../shared/dm";
import { canFlee } from "./combat-tricks";

export const BRIBE_PER_ENEMY = 5;

/** German effect names (as the AI sees them) → what they do. */
export const EFFECT_HELP: Record<string, { combat: boolean; text: string }> = {
  ablenken: { combat: true, text: "ein Gegner ist abgelenkt: der nächste Angriff auf ihn hat Vorteil" },
  umstossen: { combat: true, text: "ein Gegner (kein Anführer) liegt am Boden: Nahkampfangriffe auf ihn haben Vorteil" },
  behindern: { combat: true, text: "ein Gegner (kein Anführer) ist entwaffnet oder geblendet: seine Angriffe haben Nachteil" },
  helfen: { combat: true, text: "ein anderer Held bekommt Vorteil auf seinen nächsten Wurf (auch ohne Probe)" },
  deckung: { combat: true, text: "der Held selbst bekommt +2 Rüstungsklasse bis zu seinem nächsten Zug (auch ohne Probe)" },
  umgebung: { combat: true, text: "etwas aus der Umgebung trifft einen Gegner: leicht 1W6, mittel 2W6, schwer 3W6 Schaden" },
  flucht: { combat: true, text: "alle Gegner fliehen, der Kampf ist vorbei (nur ohne Anführer)" },
  ergeben: { combat: true, text: "ein Gegner oder alle gewöhnlichen Gegner geben auf und kämpfen nicht mehr" },
  bestechen: { combat: true, text: `wie ergeben, kostet ${BRIBE_PER_ENEMY} Gold pro Gegner aus der Gruppenkasse` },
  betoeren: { combat: true, text: "ein Gegner oder alle gewöhnlichen Gegner sind betört und kämpfen nicht mehr" },
  finden_gold: { combat: false, text: "die Gruppe findet etwas Gold (höchstens zweimal pro Szene etwas finden)" },
  finden_trank: { combat: false, text: "die Gruppe findet einen Heiltrank" },
  finden_fackel: { combat: false, text: "die Gruppe findet eine Fackel" },
  erste_hilfe: { combat: false, text: "ein Held wird verarztet: 1W4+1 Trefferpunkte" },
  tuer_oeffnen: { combat: false, text: "die nächste verschlossene Tür geht auf" },
  entdecken: { combat: false, text: "ein verborgener Teil der Umgebung wird sichtbar" },
  abkuerzung: { combat: false, text: "die Idee löst das aktuelle Hindernis der Szene (nur nach gelungener SCHWERER Probe, SG 15 oder mehr; einmal pro Szene)" },
};

/** Only a hard roll (this DC or more) may open a shortcut. */
export const BYPASS_DC = 15;

/** Setbacks for a clearly failed attempt ("Rückschläge"). */
export const SETBACK_HELP: Record<string, { combat: boolean | "both"; text: string }> = {
  blosse: { combat: true, text: "der Held gibt sich eine Blöße: der nächste Angriff auf ihn hat Vorteil" },
  hinfallen: { combat: true, text: "der Held fällt selbst hin (liegt am Boden)" },
  patzer: { combat: true, text: "der Held behindert sich selbst: seine Angriffe haben bis nach seinem nächsten Zug Nachteil" },
  wuetend: { combat: true, text: "ein Gegner wird wütend: Vorteil auf seinen nächsten Angriff" },
  verletzt: { combat: "both", text: "der Held verletzt sich (leicht 1W4, mittel 1W6 Schaden, nie bewusstlos)" },
  gold_verloren: { combat: "both", text: "die Gruppe verliert 1W6 Gold" },
};

const NO_ROLL = new Set(["helfen", "deckung"]);

/** A clearly failed roll: only setbacks are allowed. */
export function isClearMiss(trigger: DmTrigger): boolean {
  return trigger.kind === "roll_result" && !trigger.success && trigger.total - trigger.dc < -2;
}

/** Effect names the DM may use for this trigger (for the AI schema). */
export function allowedEffectNames(ctx: DmContext, trigger: DmTrigger): string[] {
  const fighting = !!ctx.combat?.enemies.length;
  if (isClearMiss(trigger)) {
    return Object.entries(SETBACK_HELP)
      .filter(([, e]) => e.combat === "both" || e.combat === fighting)
      .map(([name]) => name)
      .filter((name) => name !== "gold_verloren" || (ctx.gold ?? 0) > 0);
  }
  const names = Object.entries(EFFECT_HELP)
    .filter(([, e]) => e.combat === fighting)
    .map(([name]) => name)
    .filter((name) => name !== "flucht" || canFlee(ctx))
    .filter((name) => name !== "bestechen" || (ctx.gold ?? 0) >= BRIBE_PER_ENEMY)
    .filter((name) => name !== "abkuerzung" || (!!ctx.bypass && trigger.kind === "roll_result" && trigger.success && trigger.dc >= BYPASS_DC));
  if (trigger.kind === "free_text") return names.filter((n) => NO_ROLL.has(n));
  if (trigger.kind === "roll_result") return names;
  return [];
}

/** How many effects the roll allows, and whether the hero pays a price. */
export function rollAllowance(trigger: DmTrigger): { max: number; cost: boolean } {
  if (trigger.kind === "free_text") return { max: 1, cost: false };
  if (trigger.kind !== "roll_result") return { max: 0, cost: false };
  const margin = trigger.total - trigger.dc;
  if (trigger.success) return { max: margin >= 5 ? 2 : 1, cost: false };
  if (margin >= -2) return { max: 1, cost: true };
  return { max: 1, cost: false }; // one setback
}

/** Name + target from the AI → a DmEffect (or undefined if it makes no sense). */
export function effectFromName(name: string, target: string | undefined, ctx: DmContext, severity?: string): DmEffect | undefined {
  const enemies = ctx.combat?.enemies ?? [];
  const enemy = enemies.find((e) => e.id === target);
  const hero = ctx.players.find((p) => p.id === target);
  const all = target === "alle" || target === "all";
  switch (name) {
    case "ablenken":
      return enemy ? { kind: "distract", target: enemy.id } : enemies[0] ? { kind: "distract", target: enemies[0].id } : undefined;
    case "umstossen":
      return enemy && !enemy.boss ? { kind: "prone", target: enemy.id } : undefined;
    case "behindern":
      return enemy && !enemy.boss ? { kind: "hamper", target: enemy.id } : undefined;
    case "helfen":
      return hero ? { kind: "help", target: hero.id } : undefined;
    case "deckung":
      return { kind: "cover" };
    case "umgebung": {
      const t = enemy ?? enemies[0];
      const sev = severity === "schwer" || severity === "mittel" ? severity : "leicht";
      return t ? { kind: "hazard", target: t.id, severity: sev } : undefined;
    }
    case "flucht":
      return canFlee(ctx) ? { kind: "flee" } : undefined;
    case "ergeben":
    case "bestechen":
    case "betoeren": {
      const t = all ? "all" : enemy && !enemy.boss ? enemy.id : undefined;
      if (!t) return undefined;
      const count = t === "all" ? enemies.filter((e) => !e.boss).length : 1;
      if (!count) return undefined;
      if (name === "bestechen" && (ctx.gold ?? 0) < count * BRIBE_PER_ENEMY) return undefined;
      return { kind: "pacify", target: t, how: name };
    }
    case "finden_gold":
      return { kind: "find", item: "gold" };
    case "finden_trank":
      return { kind: "find", item: "trank" };
    case "finden_fackel":
      return { kind: "find", item: "fackel" };
    case "erste_hilfe":
      return hero ? { kind: "first_aid", target: hero.id } : undefined;
    case "tuer_oeffnen":
      return { kind: "open_door" };
    case "entdecken":
      return { kind: "reveal" };
    case "abkuerzung":
      return { kind: "bypass" };
    case "blosse":
      return { kind: "exposed" };
    case "hinfallen":
      return { kind: "fall" };
    case "patzer":
      return { kind: "fumble" };
    case "verletzt":
      return { kind: "hurt", severity: severity === "mittel" || severity === "schwer" ? "mittel" : "leicht" };
    case "gold_verloren":
      return (ctx.gold ?? 0) > 0 ? { kind: "lose_gold" } : undefined;
    case "wuetend": {
      const t = enemy ?? enemies[0];
      return t ? { kind: "enrage", target: t.id } : undefined;
    }
    default:
      return undefined;
  }
}

const COMBAT_KINDS = new Set<DmEffect["kind"]>(["distract", "prone", "hamper", "help", "cover", "hazard", "flee", "pacify", "exposed", "fall", "fumble", "enrage"]);
const SETBACK_KINDS = new Set<DmEffect["kind"]>(["exposed", "fall", "fumble", "hurt", "lose_gold", "enrage"]);
const BOTH_KINDS = new Set<DmEffect["kind"]>(["help", "hurt", "lose_gold"]);
const NO_ROLL_KINDS = new Set<DmEffect["kind"]>(["help", "cover"]);

/** Final check of a DM answer's effects against the roll and the situation. */
export function filterEffects(effects: DmEffect[] | undefined, ctx: DmContext, trigger: DmTrigger): DmEffect[] {
  const { max, cost } = rollAllowance(trigger);
  if (!max) return [];
  const fighting = !!ctx.combat?.enemies.length;
  const miss = isClearMiss(trigger);
  const ok = (effects ?? [])
    .filter((e) => e.kind !== "cost")
    // Clear miss: only setbacks. Otherwise: no setbacks.
    .filter((e) => SETBACK_KINDS.has(e.kind) === miss)
    .filter((e) => (BOTH_KINDS.has(e.kind) ? true : COMBAT_KINDS.has(e.kind) === fighting))
    .filter((e) => trigger.kind !== "free_text" || NO_ROLL_KINDS.has(e.kind))
    .filter((e) => e.kind !== "flee" || canFlee(ctx))
    // A shortcut needs a clean success on a hard roll – it must not make the game easy.
    .filter((e) => e.kind !== "bypass" || (!!ctx.bypass && trigger.kind === "roll_result" && trigger.success && trigger.dc >= BYPASS_DC))
    .slice(0, max);
  if (!ok.length) return [];
  return cost ? [...ok, { kind: "cost" }] : ok;
}
