/**
 * What the AI game master gets to read: the rules for telling the story (system prompt)
 * and a small context of the current moment (< 3,000 tokens). Also the JSON schema of its answer.
 */
import { nameOf } from "../../engine/names";
import type { DmContext, DmResponse, DmTrigger } from "../../shared/dm";
import { SKILL_IDS } from "../../shared/rules";
import type { Ending, Scene, Story } from "../../shared/story";
import { actOf, sceneById } from "../planner";
import { pickEnding } from "../scripted";
import { canFlee } from "../combat-tricks";
import { allowedEffectNames, BRIBE_PER_ENEMY, EFFECT_HELP, isClearMiss, SETBACK_HELP } from "../effects";
import { resolveClue } from "../validate";

export { canFlee };

export const SYSTEM_PROMPT = `Du bist die Spielleitung (Dungeon Master) eines Fantasy-Abenteuers für Einsteiger, die zum ersten Mal ein Rollenspiel spielen. Die Gruppe sitzt vor dem Fernseher, jede Person steuert einen Helden mit dem Handy.

So erzählst du:
- Immer auf Deutsch, lebendig und bildhaft, aber kurz: 2 bis 4 Sätze, gut zum Vorlesen. Sprich die Gruppe mit „ihr“ an oder nenne die Helden beim Namen.
- Familienfreundlich: spannend, gern mit Humor, nichts Grausames oder Explizites.
- Zahlen und Regeln macht das Programm: Erfinde keine Werte, keinen Schaden, keine Monster, keine Gegenstände und keine Belohnungen.
- Bleib beim Ziel der aktuellen Szene. Weichen die Helden ab, lass es kurz zu und lenke sie freundlich zurück.
- Die geheime Wahrheit verrätst du NIE direkt. Die Gruppe erfährt sie nur über Hinweise, und zwar nur über die erlaubten Hinweise aus dem Kontext, höchstens einen pro Antwort, und nur wenn die Helden ihn sich verdient haben (gute Idee oder gelungene Probe).
- Freie Aktionen: Ist unsicher, ob etwas klappt, verlange eine Probe (roll_skill und roll_dc; leicht 10, mittel 13, schwer 16). Ist es sicher oder unwichtig, beschreibe einfach, was passiert. Unmögliches biegst du freundlich ab.
- Nach einer Probe erzählst du, was aus dem Erfolg oder Misserfolg folgt. Misserfolge sind nie das Ende, sondern machen die Lage nur schwieriger oder lustiger.
- Nichtspielerfiguren sprechen über npc_name und npc_text, in ihrer eigenen Art.
- Tempo: Liegt die Gruppe hinter der geplanten Zeit, erzähle knapper und führe sie zum Ziel. Liegt sie gut in der Zeit, darfst du ausschmücken.
- Freie Aktionen sollen sich frei anfühlen: Belohne kreative Ideen! Bestechen, überreden, betören und verführen (charmant und familienfreundlich), einschüchtern, austricksen, die Umgebung nutzen – alles ist erlaubt.
- Was wirklich passiert, bestimmen die EFFEKTE (Liste im Kontext). Das Programm führt sie aus: Schaden, Gold, Trefferpunkte, Kampfende. Erzähle genau das, was deine Effekte bewirken – nicht mehr. Ohne Effekt passiert spielerisch nichts, das Programm rechnet nichts.
- Im Kampf entscheidet über normale Treffer nur das Programm (Knöpfe „Angreifen“ und „Zaubern“). Will ein Held einfach angreifen, sag ihm freundlich, dass er dafür „⚔️ Angreifen“ nutzt. Erfinde keinen Schaden außer über den Effekt „umgebung“.
- Proben und Erfolgsgrade: Tricks brauchen eine Probe (nur „helfen“ und „deckung“ gehen ohne). Ist die Probe gelungen, wähle 1 Effekt, bei großem Erfolg (5 über dem SG) bis zu 2. Knapp verfehlt (1–2 darunter) heißt „Ja, aber“: 1 Effekt, doch der Held zahlt einen kleinen Preis (das Programm zieht ihm ein paar Trefferpunkte ab) – erzähle beides. Klar verfehlt: Es geht etwas schief! Wähle dann genau 1 Rückschlag aus der Liste (Blöße, hinfallen, Patzer, wütender Gegner, verletzt, Gold verloren) und erzähle ihn lebendig. Freie Aktionen haben IMMER Folgen – gute oder schlechte.
- Anführer und Endgegner lassen sich nicht bestechen, betören, umstoßen oder verjagen – ablenken und die Umgebung wirken aber.
- Nebenfiguren merken sich, wie man sie behandelt: Mit npc_attitude (−2 bis +2) veränderst du ihre Haltung. Freundliche Figuren machen spätere Proben in ihrer Szene leichter, feindliche schwerer.
- Greife die CHRONIK auf: Erinnere an frühere Taten der Helden, wenn es passt.
- LAGERFEUER: Was die Helden am Feuer über sich erzählt haben, ist wertvoll. Lass es ab und zu in die Geschichte einfließen (eine Figur aus der Heimat, eine Angst, ein Wunsch), ohne die Regeln zu ändern.
- Nutze die UMGEBUNG: Baue Gegenstände aus dem Raum in deine Beschreibungen und Vorschläge ein.
- Antworte nur mit dem verlangten JSON.`;

/** Flags the AI may set in this scene: the ones the story's keyword reactions could set, with their meaning. */
export function allowedFlags(scene: Scene): { flag: string; meaning: string }[] {
  const out: { flag: string; meaning: string }[] = [];
  for (const k of scene.keywords ?? []) {
    for (const f of k.set ?? []) {
      if (!out.some((o) => o.flag === f)) out.push({ flag: f, meaning: `${k.words.slice(0, 4).join("/")}: ${k.response.map((r) => r.text).join(" ").slice(0, 160)}` });
    }
  }
  return out;
}

/** Clues the AI may reveal here (already mapped to this game's truth), not yet found. */
export function allowedClues(story: Story, scene: Scene, ctx: DmContext): { id: string; text: string }[] {
  const refs = [...(scene.clues ?? []).map((c) => c.id), ...(scene.keywords ?? []).flatMap((k) => (k.clue ? [k.clue] : []))];
  const out: { id: string; text: string }[] = [];
  for (const ref of refs) {
    const id = resolveClue({ story, scene, truth: ctx.truth, eventsUsed: [] }, ref);
    if (!id || ctx.cluesFound.includes(id) || out.some((o) => o.id === id)) continue;
    out.push({ id, text: story.clues.find((c) => c.id === id)!.text });
  }
  return out;
}

/** Endings that fit the truth and what happened (the AI picks one of these at the end). */
export function eligibleEndings(story: Story, ctx: DmContext): Ending[] {
  const has = (f: string) => ctx.flags.includes(f);
  const list = story.endings.filter((e) => (!e.truths || e.truths.includes(ctx.truth)) && (e.requires ?? []).every(has) && !(e.unless ?? []).some(has));
  return list.length ? list : [pickEnding(story, ctx.truth, ctx.flags)];
}

function triggerText(t: DmTrigger): string {
  switch (t.kind) {
    case "scene_start":
      return "Eine neue Szene beginnt. Erzähle stimmungsvoll, wo die Helden ankommen und was sie sehen, und mach das Ziel der Szene deutlich.";
    case "free_text":
      return `${t.heroName} möchte etwas Eigenes tun: „${t.text}“. Entscheide, was passiert (bei unsicherem Ausgang: Probe verlangen).`;
    case "roll_result": {
      const margin = t.total - t.dc;
      const grade = t.success ? (margin >= 5 ? "GROSSER ERFOLG (bis zu 2 Effekte)" : "ERFOLG (1 Effekt)") : margin >= -2 ? "KNAPP VERFEHLT – Ja, aber (1 Effekt mit Preis)" : "MISSERFOLG (kein Effekt)";
      return `${t.heroName} hat für „${t.text}“ eine Probe auf ${nameOf("skills", t.skill)} (SG ${t.dc}) gewürfelt: ${t.total} → ${grade}. Wähle passende Effekte und erzähle die Folgen.`;
    }
    case "rules_question":
      return `REGELFRAGE von ${t.heroName} (${t.hero}): „${t.question}“
PASSENDE REGELN AUS DEM GLOSSAR: ${t.glossary.map((g) => `${g.title}: ${g.text}`).join(" || ") || "keine gefunden"}
Antworte in answer kurz (2–4 Sätze), freundlich und für Einsteiger verständlich, nur mit Regeln aus dem Glossar oder aus dem Spielstand. Erfinde keine Regeln. Sag konkret, was der Held jetzt tun kann. narration darf leer bleiben.`;
    case "suggest":
      return `${t.heroName} fragt: „Was könnte ich jetzt tun?“ Schlage 3 kurze, kreative Ideen für freie Aktionen vor (Ich-Form, je höchstens 8 Wörter), die zur Lage, zur Umgebung und zu den Figuren passen. narration darf leer bleiben.`;
    case "idle":
      return `Seit ${t.seconds} Sekunden hat niemand etwas getan. Erzähle in 1–2 Sätzen etwas Kleines, das die Helden neugierig macht oder an ihr Ziel erinnert: ein Geräusch, eine Bewegung, oder eine Figur der Szene spricht sie an (npc_say, passend zu ihrer Haltung gegenüber der Gruppe). Keine Monster, keine Effekte, keine Probe.`;
    case "final_blow":
      return `${t.heroName} hat den Endgegner ${t.bossName} besiegt und beschreibt den letzten Schlag so: „${t.text}“
Erzähle diesen Moment in 2–4 packenden, bildhaften Sätzen nach – so, wie ${t.heroName} es beschrieben hat, nur größer und filmreifer. Der Gegner ist besiegt, das steht fest. Keine Monster, keine Probe, keine Effekte.`;
    case "campfire":
      return `Die Helden rasten am Lagerfeuer und erzählen sich etwas über sich:
${t.tales.map((x) => `- ${x.heroName} (gefragt: „${x.question}“): „${x.text}“`).join("\n")}
Erzähle in 2–4 warmen, bildhaften Sätzen den Abend am Feuer und greife dabei mindestens eine Erzählung liebevoll auf. Merke dir die Erzählungen: Baue sie später in die Geschichte ein (ein Wiedersehen, eine Angst, die wahr wird, ein Wunsch, der sich erfüllt). Keine Monster, keine Probe.`;
    case "story_end":
      return "Das Abenteuer ist zu Ende. Wähle das passende Ende (ending) und erzähle einen kurzen Ausklang, der auf das zurückblickt, was die Helden erlebt haben.";
    default:
      return `Ereignis: ${t.kind}`;
  }
}

export function buildPrompt(story: Story, ctx: DmContext, trigger: DmTrigger, scripted: DmResponse): string {
  const scene = sceneById(story, ctx.sceneId);
  const { act } = actOf(story, scene.id);
  const truth = story.truths.find((t) => t.id === ctx.truth);
  const npcs = (scene.npcs ?? []).map((n) => story.npcs.find((x) => x.id === n.npc)).filter((n) => !!n);
  const clues = allowedClues(story, scene, ctx);
  const flags = allowedFlags(scene);
  const found = ctx.cluesFound.map((id) => story.clues.find((c) => c.id === id)?.text).filter(Boolean);
  const lines = [
    `GESCHICHTE: ${story.title} – ${story.description}`,
    `GEHEIME WAHRHEIT (nie direkt verraten): ${truth ? `${truth.title}: ${truth.summary}` : "–"}`,
    `Wendung schon enthüllt: ${ctx.twistRevealed ? "ja" : "nein"}`,
    `KAPITEL: ${act.title} · SZENE ${ctx.sceneIndex + 1} von ${ctx.sceneCount}: ${scene.title}`,
    `ZIEL DER SZENE: ${scene.ziel}`,
    npcs.length ? `NICHTSPIELERFIGUREN HIER: ${npcs.map((n) => `${n.name} (${n.description})`).join("; ")}` : "",
    `HELDEN: ${ctx.players.map((p) => `${p.name} (${nameOf("classes", p.classId)}, ${p.hp}/${p.maxHp} TP)`).join("; ")}`,
    `SCHON GEFUNDENE HINWEISE: ${found.length ? found.join(" | ") : "keine"}`,
    clues.length ? `ERLAUBTE HINWEISE (reveal_clue = id): ${clues.map((c) => `${c.id}: ${c.text}`).join(" | ")}` : "ERLAUBTE HINWEISE: keine",
    flags.length ? `ERLAUBTE MERKER (set_flags), wenn die Helden so etwas tun: ${flags.map((f) => `${f.flag} = ${f.meaning}`).join(" | ")}` : "",
    ctx.combat
      ? `KAMPF LÄUFT. Gegner: ${ctx.combat.enemies.map((e) => `${e.id} = ${e.name} (${e.hp}/${e.maxHp} TP${e.boss ? ", Anführer" : ""})`).join("; ")}. Flucht möglich: ${canFlee(ctx) ? "ja" : "nein"}`
      : "",
    ctx.room ? `UMGEBUNG: ${ctx.room.name}${ctx.room.objects.length ? ` – ${ctx.room.objects.join(", ")}` : ""}` : "",
    `GOLD DER GRUPPE: ${ctx.gold ?? 0} (Bestechung kostet ${BRIBE_PER_ENEMY} Gold pro Gegner)`,
    ctx.chronicle?.length ? `CHRONIK (frühere Taten): ${ctx.chronicle.join(" | ")}` : "",
    ctx.tales?.length ? `LAGERFEUER (die Helden über sich): ${ctx.tales.join(" | ")}` : "",
    Object.keys(ctx.attitudes ?? {}).length
      ? `HALTUNG DER FIGUREN: ${Object.entries(ctx.attitudes!).map(([id, v]) => `${story.npcs.find((n) => n.id === id)?.name ?? id} ${v > 0 ? "+" : ""}${v}`).join(", ")}`
      : "",
    story.npcs.length ? `FIGUREN-IDS (für npc_attitude): ${story.npcs.map((n) => `${n.id} = ${n.name}`).join(", ")}` : "",
    allowedEffectNames(ctx, trigger).length
      ? `${isClearMiss(trigger) ? "RÜCKSCHLÄGE (wähle genau einen)" : "EFFEKTE"} (Name: Wirkung): ${allowedEffectNames(ctx, trigger).map((n) => `${n}: ${(EFFECT_HELP[n] ?? SETBACK_HELP[n])!.text}`).join(" | ")}. Ziele: Gegner-id aus KAMPF, Helden-id aus HELDEN-IDS, oder „alle“.`
      : "",
    `HELDEN-IDS: ${ctx.players.map((p) => `${p.id} = ${p.name}`).join(", ")}`,
    `ZEIT: ${Math.round(ctx.minutesPlayed)} von geplant ${Math.round(ctx.minutesPlanned)} Minuten bis Ende dieser Szene`,
    trigger.kind === "story_end" ? `MÖGLICHE ENDEN: ${eligibleEndings(story, ctx).map((e) => `${e.id} (${e.title})`).join(", ")}` : "",
    `DREHBUCH-VORSCHLAG (Inhalt beibehalten, frei formulieren): ${scripted.narration || "–"}`,
    `JETZT: ${triggerText(trigger)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: "STRING", description, ...extra });

export function responseSchema(story: Story, ctx: DmContext, trigger: DmTrigger): Record<string, unknown> {
  const scene = sceneById(story, ctx.sceneId);
  const properties: Record<string, unknown> = {
    narration: S("Erzähltext, 2–4 Sätze, Deutsch"),
    npc_name: S("Name der sprechenden Nichtspielerfigur, sonst leer"),
    npc_text: S("Was sie sagt, sonst leer"),
  };
  if (trigger.kind === "free_text") {
    properties.roll_skill = S("Fertigkeit für eine Probe oder none", { enum: ["none", ...SKILL_IDS] });
    properties.roll_dc = { type: "INTEGER", description: "Schwierigkeit 8–18, 0 wenn keine Probe" };
  }
  if (trigger.kind === "free_text" || trigger.kind === "roll_result") {
    const clues = allowedClues(story, scene, ctx);
    if (clues.length) properties.reveal_clue = S("id eines erlaubten Hinweises oder none", { enum: ["none", ...clues.map((c) => c.id)] });
    const flags = allowedFlags(scene);
    if (flags.length) properties.set_flags = { type: "ARRAY", items: S("Merker", { enum: flags.map((f) => f.flag) }) };
  }
  const effectNames = allowedEffectNames(ctx, trigger);
  if (effectNames.length) {
    properties.effects = {
      type: "ARRAY",
      description: "Echte Wirkungen der freien Aktion (leer lassen, wenn nichts passiert)",
      items: {
        type: "OBJECT",
        properties: {
          name: S("Effekt", { enum: effectNames }),
          target: S("Ziel: Gegner-id, Helden-id oder alle (leer, wenn nicht nötig)"),
          severity: S("nur bei umgebung", { enum: ["leicht", "mittel", "schwer"] }),
        },
        required: ["name"],
      },
    };
  }
  if ((trigger.kind === "free_text" || trigger.kind === "roll_result") && story.npcs.length) {
    properties.npc_attitude = {
      type: "OBJECT",
      description: "Nur wenn eine Figur ihre Haltung ändert",
      properties: { npc: S("Figuren-id", { enum: story.npcs.map((n) => n.id) }), change: { type: "INTEGER", description: "−2 bis +2" } },
    };
  }
  if (trigger.kind === "suggest") properties.ideas = { type: "ARRAY", items: S("Idee in Ich-Form") };
  if (trigger.kind === "rules_question") properties.answer = S("Antwort auf die Regelfrage, 2–4 Sätze");
  if (trigger.kind === "story_end") properties.ending = S("id des Endes", { enum: eligibleEndings(story, ctx).map((e) => e.id) });
  return { type: "OBJECT", properties, required: trigger.kind === "suggest" ? ["ideas"] : trigger.kind === "rules_question" ? ["answer"] : ["narration"] };
}
