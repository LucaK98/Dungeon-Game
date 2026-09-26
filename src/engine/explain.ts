/**
 * Turns engine results into short German sentences for TV and phones, e.g.
 *   "🎲 14 + 3 (Stärke) + 2 (Übung) = 19 gegen RK 15 → Treffer!"
 * Every line carries the glossary keys of the terms it uses.
 */
import type {
  AttackResult,
  Battle,
  CheckResult,
  D20Roll,
  DamageResult,
  DeathSaveResult,
  HpChange,
  InitiativeEntry,
  SpellResult,
} from "../shared/game";
import type { BreakdownPart } from "../shared/types";
import type { ActionOutcome } from "./actions";
import { abilityName, nameOf } from "./names";

export interface ExplainedLine {
  text: string;
  glossarKeys: string[];
}

const MINUS = "−";

/** 5 feet = 1 square = 1,5 m. */
export function metres(feet: number): string {
  return `${((feet / 5) * 1.5).toLocaleString("de-DE", { maximumFractionDigits: 1 })} m`;
}

function signed(v: number, first: boolean): string {
  if (first) return v < 0 ? `${MINUS}${Math.abs(v)}` : String(v);
  return v < 0 ? ` ${MINUS} ${Math.abs(v)}` : ` + ${v}`;
}

/** "🎲 14 + 3 (Stärke) + 2 (Übung)" – the d20 is shown as a die, everything else labelled. */
export function formatParts(parts: BreakdownPart[]): string {
  return parts
    .map((p, i) => {
      if (p.glossarKey === "w20" && p.label === "Würfel") return `🎲 ${p.value}`;
      return `${signed(p.value, i === 0)} (${p.label})`;
    })
    .join("");
}

function keysOf(parts: BreakdownPart[]): string[] {
  return [...new Set(parts.map((p) => p.glossarKey).filter((k): k is string => !!k))];
}

function rollNote(roll: D20Roll): ExplainedLine | undefined {
  if (roll.mode === "normal") return undefined;
  const which = roll.mode === "advantage" ? "Vorteil" : "Nachteil";
  const pick = roll.mode === "advantage" ? "der höhere" : "der niedrigere";
  const why = roll.reasons.filter((r) => r.effect === roll.mode).map((r) => r.text);
  return {
    text: `${which}: 🎲 ${roll.rolls.join(" und ")} gewürfelt, ${pick} zählt${why.length ? ` (${why.join(", ")})` : ""}.`,
    glossarKeys: [roll.mode === "advantage" ? "vorteil" : "nachteil", ...roll.reasons.map((r) => r.glossarKey)],
  };
}

const name = (battle: Battle, id: string): string => battle.creatures[id]?.name ?? id;

function attackName(battle: Battle, r: AttackResult): string {
  const attacker = battle.creatures[r.attackerId];
  const option = attacker?.attacks.find((a) => a.id === r.optionId);
  if (!option) return nameOf("spells", r.optionId);
  if (option.source === "monster") return nameOf("monsterActions", option.sourceId);
  return nameOf("weapons", option.sourceId);
}

export function explainDamage(d: DamageResult): ExplainedLine[] {
  return d.lines.map((l) => {
    const typeName = nameOf("damageTypes", l.type);
    let text = `💥 ${formatParts(l.parts)} = ${l.raw} ${typeName}schaden`;
    if (l.note === "resistance") text += `, halbiert wegen Resistenz → ${l.final}`;
    if (l.note === "immunity") text += `, aber das Ziel ist immun → 0`;
    if (l.note === "vulnerability") text += `, doppelt wegen Verwundbarkeit → ${l.final}`;
    const keys = [...keysOf(l.parts), "schaden", `schadensart:${l.type}`];
    if (l.note === "resistance") keys.push("resistenz");
    if (l.note === "immunity") keys.push("immunitaet");
    if (l.note === "vulnerability") keys.push("verwundbarkeit");
    return { text, glossarKeys: keys };
  });
}

export function explainHp(battle: Battle, hp: HpChange): ExplainedLine[] {
  const who = name(battle, hp.targetId);
  const out: ExplainedLine[] = [];
  if (hp.survived) {
    out.push({ text: `${who} weigert sich zu fallen und steht mit 1 Trefferpunkt wieder auf!`, glossarKeys: ["monstermerkmal:undead-fortitude"] });
  }
  if (hp.killed) {
    const c = battle.creatures[hp.targetId];
    out.push({
      text: c?.kind === "pc" ? `☠️ ${who} ist gefallen.` : `☠️ ${who} ist besiegt!`,
      glossarKeys: c?.kind === "pc" ? ["todesrettungswurf"] : ["trefferpunkte"],
    });
  } else if (hp.downed) {
    out.push({ text: `${who} bricht bewusstlos zusammen! Jetzt zählen die Todesrettungswürfe.`, glossarKeys: ["zustand:unconscious", "todesrettungswurf"] });
  } else if (hp.deathSaveFailures) {
    out.push({ text: `${who} liegt am Boden und wird getroffen: ${hp.deathSaveFailures} Fehlschlag${hp.deathSaveFailures > 1 ? "e" : ""} beim Todesrettungswurf.`, glossarKeys: ["todesrettungswurf"] });
  } else if (hp.after > hp.before) {
    out.push({ text: `${who} hat jetzt ${hp.after} Trefferpunkte.`, glossarKeys: ["trefferpunkte"] });
  }
  if (hp.wokeUp && hp.after > 0 && hp.before === 0) out.push({ text: `${who} kommt wieder zu sich!`, glossarKeys: ["zustand:unconscious"] });
  else if (hp.wokeUp) out.push({ text: `${who} wacht auf.`, glossarKeys: ["zauber:sleep"] });
  if (hp.concentration) {
    const spell = nameOf("spells", hp.concentration.spellId);
    out.push({
      text: hp.concentration.lost
        ? `${who} verliert die Konzentration (${formatParts(hp.concentration.check.parts)} = ${hp.concentration.check.total} gegen SG ${hp.concentration.check.dc}): ${spell} endet.`
        : `${who} bleibt konzentriert (${hp.concentration.check.total} gegen SG ${hp.concentration.check.dc}), ${spell} hält.`,
      glossarKeys: ["konzentration", "rettungswurf"],
    });
  }
  return out;
}

export function explainAttack(battle: Battle, r: AttackResult): ExplainedLine[] {
  const out: ExplainedLine[] = [];
  const verdict = r.crit ? "Kritischer Treffer!" : r.hit ? "Treffer!" : r.roll.natural === 1 ? "Daneben (eine 1 verfehlt immer)." : "Verfehlt.";
  out.push({
    text: `${name(battle, r.attackerId)} greift ${name(battle, r.targetId)} an (${attackName(battle, r)}).`,
    glossarKeys: ["angriffswurf"],
  });
  const note = rollNote(r.roll);
  if (note) out.push(note);
  const keys = [...keysOf(r.parts), "ruestungsklasse", "angriffswurf"];
  if (r.crit) keys.push("kritischer_treffer");
  out.push({ text: `${formatParts(r.parts)} = ${r.total} gegen RK ${r.targetAc} → ${verdict}`, glossarKeys: keys });
  if (r.crit) out.push({ text: "Bei einem kritischen Treffer werden alle Schadenswürfel doppelt gewürfelt.", glossarKeys: ["kritischer_treffer"] });
  if (r.damage) out.push(...explainDamage(r.damage));
  if (r.hp) out.push(...explainHp(battle, r.hp));
  return out;
}

export function explainCheck(battle: Battle, creatureId: string, r: CheckResult): ExplainedLine[] {
  const what = r.kind === "save"
    ? `Rettungswurf auf ${abilityName(r.ability)}`
    : r.skill
      ? `Probe auf ${nameOf("skills", r.skill)}`
      : `Probe auf ${abilityName(r.ability)}`;
  const out: ExplainedLine[] = [
    { text: `${name(battle, creatureId)}: ${what}.`, glossarKeys: [r.kind === "save" ? "rettungswurf" : "probe", ...(r.skill ? [`fertigkeit:${r.skill}`] : [])] },
  ];
  const note = rollNote(r.roll);
  if (note) out.push(note);
  out.push({
    text: `${formatParts(r.parts)} = ${r.total} gegen SG ${r.dc} → ${r.success ? "Geschafft!" : "Nicht geschafft."}`,
    glossarKeys: [...keysOf(r.parts), "schwierigkeitsgrad"],
  });
  return out;
}

export function explainInitiative(battle: Battle, e: InitiativeEntry): ExplainedLine {
  return { text: `${name(battle, e.creatureId)}: ${formatParts(e.parts)} = ${e.total}`, glossarKeys: ["initiative", ...keysOf(e.parts)] };
}

export function explainDeathSave(battle: Battle, r: DeathSaveResult): ExplainedLine[] {
  const who = name(battle, r.creatureId);
  const n = r.roll.natural;
  const base = `${who} kämpft ums Überleben: 🎲 ${n}`;
  const detail =
    r.outcome === "revived"
      ? "Eine 20! Wieder bei Bewusstsein mit 1 Trefferpunkt."
      : n === 1
        ? "Eine 1 zählt als zwei Fehlschläge."
        : r.success
          ? "Ab 10 ist es ein Erfolg."
          : "Unter 10 ist es ein Fehlschlag.";
  const out: ExplainedLine[] = [
    { text: `${base} → ${detail} (Erfolge ${r.successes}/3, Fehlschläge ${r.failures}/3)`, glossarKeys: ["todesrettungswurf", "w20"] },
  ];
  if (r.outcome === "stable") out.push({ text: `${who} ist stabil und stirbt nicht, bleibt aber bewusstlos.`, glossarKeys: ["stabil"] });
  if (r.outcome === "dead") out.push({ text: `☠️ ${who} ist gestorben.`, glossarKeys: ["todesrettungswurf"] });
  return out;
}

export function explainSpell(battle: Battle, r: SpellResult): ExplainedLine[] {
  const spell = nameOf("spells", r.spellId);
  const out: ExplainedLine[] = [
    {
      text: `${name(battle, r.casterId)} wirkt ${spell}${r.slotLevel ? ` (Zauberplatz Grad ${r.slotLevel})` : " (Zaubertrick)"}.`,
      glossarKeys: [`zauber:${r.spellId}`, r.slotLevel ? "zauberplaetze" : "zaubertrick"],
    },
  ];
  if (r.dc) out.push({ text: `Rettungswurf-SG: ${formatParts(r.dc.parts)} = ${r.dc.value}`, glossarKeys: ["zauber_sg", ...keysOf(r.dc.parts)] });
  if (r.pool) out.push({ text: `Schlaf-Vorrat: ${formatParts(r.pool.parts)} = ${r.pool.total} Trefferpunkte`, glossarKeys: ["zauber:sleep", "trefferpunkte"] });
  for (const t of r.targets) {
    if (t.attack) out.push(...explainAttack(battle, t.attack));
    if (t.save) out.push(...explainCheck(battle, t.targetId, t.save));
    if (t.damage && !t.attack) {
      out.push(...explainDamage(t.damage));
      if (t.save?.success) {
        out.push({
          text: t.damage.total ? `Rettungswurf geschafft → nur halber Schaden: ${t.damage.total}.` : "Rettungswurf geschafft → kein Schaden.",
          glossarKeys: ["rettungswurf"],
        });
      }
    }
    if (t.heal) {
      out.push({
        text: `💚 ${name(battle, t.targetId)} heilt ${formatParts(t.heal.parts)} = ${t.heal.total} Trefferpunkte.`,
        glossarKeys: ["trefferpunkte", ...keysOf(t.heal.parts)],
      });
    }
    if (t.hp && !t.attack) out.push(...explainHp(battle, t.hp));
    if (t.unaffected) out.push({ text: t.unaffected, glossarKeys: [`zauber:${r.spellId}`] });
    if (t.applied && !t.attack) {
      const txt: Record<string, string> = {
        bless: "ist gesegnet: +1W4 auf Angriffe und Rettungswürfe.",
        "shield-of-faith": "wird von einem schimmernden Schild umgeben: +2 RK.",
        "divine-favor": "Waffe glüht: +1W4 Glanzschaden pro Treffer.",
        unconscious: "schläft tief und fest.",
      };
      out.push({ text: `${name(battle, t.targetId)} ${txt[t.applied] ?? t.applied}`, glossarKeys: [t.applied === "unconscious" ? "zustand:unconscious" : `zauber:${t.applied}`] });
    }
  }
  return out;
}

export function explainOutcome(battle: Battle, o: ActionOutcome): ExplainedLine[] {
  if (!o.ok) return [{ text: o.reason, glossarKeys: [] }];
  const who = name(battle, o.actorId);
  switch (o.kind) {
    case "move": {
      const out: ExplainedLine[] = o.opportunityAttacks.flatMap((a) => [
        { text: `${name(battle, a.attackerId)} nutzt die Lücke für einen Gelegenheitsangriff!`, glossarKeys: ["gelegenheitsangriff", "reaktion"] },
        ...explainAttack(battle, a),
      ]);
      if (o.move.costFt) {
        out.push({ text: `${who} bewegt sich ${o.move.costFt / 5} Felder (${metres(o.move.costFt)}).`, glossarKeys: ["bewegung"] });
      }
      return out;
    }
    case "attack":
      return explainAttack(battle, o.attack);
    case "spell":
      return explainSpell(battle, o.spell);
    case "save-action":
      return [
        { text: `${who} setzt ${nameOf("monsterActions", o.actionId)} ein! Rettungswurf SG ${o.dc}.`, glossarKeys: ["rettungswurf", "schwierigkeitsgrad"] },
        ...o.results.flatMap((r) => [
          ...explainCheck(battle, r.targetId, r.save),
          {
            text: `${name(battle, r.targetId)} erleidet ${r.damage} Schaden${r.save.success ? " (halbiert, weil der Rettungswurf geschafft ist)" : ""}.`,
            glossarKeys: ["schaden"],
          },
          ...explainHp(battle, r.hp),
        ]),
      ];
    case "simple": {
      const txt = {
        dash: [`${who} spurtet und kann sich doppelt so weit bewegen.`, "spurt"],
        disengage: [`${who} löst sich vorsichtig vom Gegner, ohne Gelegenheitsangriffe auszulösen.`, "rueckzug"],
        dodge: [`${who} konzentriert sich aufs Ausweichen. Angriffe gegen ${who} haben Nachteil.`, "ausweichen"],
        "action-surge": [`${who} mobilisiert alle Kräfte: eine zusätzliche Aktion!`, "merkmal:action-surge-1-use"],
        "stand-up": [`${who} steht auf.`, "zustand:prone"],
      }[o.what];
      return [{ text: txt[0]!, glossarKeys: [txt[1]!] }];
    }
    case "hide":
      return [
        ...explainCheck(battle, o.actorId, o.check),
        { text: o.check.success ? `${who} ist versteckt.` : `${who} wird entdeckt.`, glossarKeys: ["verstecken"] },
      ];
    case "heal": {
      const how = { "second-wind": "atmet durch und", "lay-on-hands": "legt die Hände auf und", potion: "trinkt einen Heiltrank und" }[o.what];
      const target = o.targetId === o.actorId ? "" : ` ${name(battle, o.targetId)}`;
      return [
        {
          text: `💚 ${who} ${how} heilt${target} ${formatParts(o.parts)} = ${o.total} Trefferpunkte.`,
          glossarKeys: [
            o.what === "potion" ? "gegenstand:potion-of-healing" : o.what === "second-wind" ? "merkmal:second-wind" : "merkmal:lay-on-hands",
            "trefferpunkte",
            ...keysOf(o.parts),
          ],
        },
        ...explainHp(battle, o.hp),
      ];
    }
    case "turn-undead":
      return [
        { text: `${who} hebt das heilige Symbol: Untote, weicht! (SG ${o.dc})`, glossarKeys: ["merkmal:channel-divinity-turn-undead"] },
        ...o.results.flatMap((r) => [
          ...explainCheck(battle, r.targetId, r.save),
          { text: r.turned ? `${name(battle, r.targetId)} flieht in Panik.` : `${name(battle, r.targetId)} widersteht.`, glossarKeys: ["zustand:frightened"] },
        ]),
      ];
  }
}
