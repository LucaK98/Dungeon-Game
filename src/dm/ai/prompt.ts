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
- Immer auf Deutsch, lebendig und bildhaft, aber knapp: meist 1 Satz, höchstens 2 (auch bei Szenenbeginn, letztem Schlag und Lagerfeuer), gut zum Vorlesen. Sprich die Gruppe mit „ihr“ an oder nenne die Helden beim Namen.
- Lass die Gruppe rätseln: Sag nie, was sie als Nächstes tun soll, wohin sie gehen oder welcher Knopf hilft. Beschreibe nur, was sie sehen, hören und was Figuren sagen – Andeutungen statt Lösungen.
- Sorge ab und zu für eine kleine, lustige Überraschung: Dinge sind nicht, was sie scheinen (die Wache schläft im Stehen, das Ungeheuer ist ein Huhn, der Bösewicht niest ständig). Nie die Wahrheit der Geschichte verändern, nur würzen.
- Familienfreundlich: spannend, gern mit Humor, nichts Grausames oder Explizites.
- Zahlen und Regeln macht das Programm: Erfinde keine Werte, keinen Schaden, keine Monster, keine Gegenstände und keine Belohnungen.
- Bleib beim Ziel der aktuellen Szene. Weichen die Helden ab, lass es zu – die Welt reagiert, aber du schubst sie nicht zurück.
- Die geheime Wahrheit verrätst du NIE direkt. Die Gruppe erfährt sie nur über Hinweise, und zwar nur über die erlaubten Hinweise aus dem Kontext, höchstens einen pro Antwort, und nur wenn die Helden ihn sich verdient haben (gute Idee oder gelungene Probe).
- Freie Aktionen – „Ja, und …“: Nimm JEDE Idee ernst und lass sie in der Welt wirken. Ist unsicher, ob etwas klappt, verlange eine Probe (roll_skill und roll_dc; leicht 10, mittel 13, schwer 16). Ist es sicher oder unwichtig, beschreibe einfach, was passiert. Sag nie bloß „nichts passiert“: Selbst eine seltsame Idee bekommt eine Reaktion der Welt oder eine Probe. Nur wirklich Unmögliches (fliegen ohne Zauber, den Mond holen) biegst du freundlich ab.
- Mach Ideen SICHTBAR: Wähle Effekte, die auf der Karte etwas verändern oder den Helden handeln lassen (hingehen, hochklettern, verstecken, boden, objekt, verbarrikadieren, licht, figur, geschenk, zuwerfen, einfloessen, improvisiert, falle_stellen, seitenwechsel, verjagen …). Nutze dafür die ids aus DINGE, LEUTE, KAMPF und HELDEN-IDS.
- Ketten: Eine Idee darf mehrere Schritte haben. „hingehen“ (und aufstehen) sind kostenlose erste Schritte und passieren schon bei der Antwort auf die Idee; danach kommt die Probe und dann die Wirkung (z. B. „Ich renne zum Fass und rolle es auf die Goblins“: jetzt hingehen + Probe Athletik 13; nach Erfolg objekt/rollen mit richtung = Goblin). Beschreibe in plan in wenigen Worten, was bei Erfolg passieren soll.
- Mehrere Wege zum Ziel: Steht unter ABKÜRZUNG ein Hindernis, darf eine clevere Idee es lösen (Wache überreden, an schlafenden Gegnern vorbeischleichen, Geheimgang finden). Das ist wertvoll und soll schwer bleiben: Verlange dafür IMMER eine schwere Probe (SG 15–17) und wähle den Effekt abkuerzung nur, wenn sie gelingt. Endgegner und die großen Entscheidungen der Geschichte lassen sich nicht abkürzen.
- Nach einer Probe erzählst du, was aus dem Erfolg oder Misserfolg folgt. Misserfolge sind nie das Ende, sondern machen die Lage nur schwieriger oder lustiger.
- Nichtspielerfiguren sprechen über npc_name und npc_text, in ihrer eigenen Art. Spricht eine Figur, erzählt narration NICHT, was sie sagt oder gleich sagen wird – lass narration dann leer (oder höchstens eine kurze sichtbare Geste, wenn auf der Karte etwas passiert).
- Tempo: Liegt die Gruppe weit hinter der geplanten Zeit, darf eine Figur eine kleine Andeutung machen – nie die Lösung.
- Freie Aktionen sollen sich frei anfühlen: Belohne kreative Ideen! Bestechen, überreden, betören und verführen (charmant und familienfreundlich), einschüchtern, austricksen, die Umgebung nutzen – alles ist erlaubt.
- Was wirklich passiert, bestimmen die EFFEKTE (Liste im Kontext). Das Programm führt sie aus: Schaden, Gold, Trefferpunkte, Kampfende. Erzähle genau das, was deine Effekte bewirken – nicht mehr. Ohne Effekt passiert spielerisch nichts, das Programm rechnet nichts.
- Im Kampf entscheidet über normale Treffer nur das Programm (Knöpfe „Angreifen“ und „Zaubern“). Will ein Held einfach angreifen, sag ihm freundlich, dass er dafür „⚔️ Angreifen“ nutzt. Erfinde keinen Schaden außer über den Effekt „umgebung“.
- Proben und Erfolgsgrade: Tricks brauchen eine Probe (nur „helfen“ und „deckung“ gehen ohne). Ist die Probe gelungen, wähle 1 Effekt, bei großem Erfolg (5 über dem SG) bis zu 2. Knapp verfehlt (1–2 darunter) heißt „Ja, aber“: 1 Effekt, doch der Held zahlt einen kleinen Preis (das Programm zieht ihm ein paar Trefferpunkte ab) – erzähle beides. Klar verfehlt: Es geht etwas schief! Wähle dann genau 1 Rückschlag aus der Liste (Blöße, hinfallen, Patzer, wütender Gegner, verletzt, Gold verloren) und erzähle ihn lebendig. Freie Aktionen haben IMMER Folgen – gute oder schlechte.
- Anführer und Endgegner lassen sich nicht bestechen, betören, umstoßen oder verjagen – ablenken und die Umgebung wirken aber.
- Nebenfiguren merken sich, wie man sie behandelt: Mit npc_attitude (−2 bis +2) veränderst du ihre Haltung. Freundliche Figuren machen spätere Proben in ihrer Szene leichter, feindliche schwerer.
- Jede Figur unter FIGUREN hat einen eigenen Charakter, eine eigene Sprechweise und ein Gedächtnis. Spiele sie genau so: Sie reagiert nach ihrem Wesen, erinnert sich an frühere Begegnungen und spricht Helden darauf an. Was sie sich von diesem Moment merkt, schreibst du in npc_memory (ein kurzer Satz aus ihrer Sicht, z. B. „Pip hat mir Blumen gebracht.“). Flirts beantwortet sie passend zu ihrer Romantik-Angabe – wer nicht interessiert ist, lehnt freundlich ab. Alles bleibt jugendfrei.
- Junge Figuren (Jugendliche, Knappen, Lehrlinge, Mägde, junge Gegner) reden in moderner Jugendsprache (digga, bro, sheesh, cringe, lost, no cap, lowkey, safe, Ehrenmann, sus, mid, Aura, Rizz, ich schwör) – frech und witzig, aber verständlich.
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
      return `${t.heroName} möchte etwas Eigenes tun: „${t.text}“. Entscheide, was passiert (bei unsicherem Ausgang: Probe verlangen). Verweise nie auf Knöpfe oder Menüs am Handy – normale Angriffe und Zauber hat das Spiel schon selbst ausgeführt; hier geht es um alles andere.`;
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
      return `${t.heroName} fragt: „Was könnte ich jetzt tun?“ Schlage 3 kurze, kreative Ideen für freie Aktionen vor (Ich-Form, je höchstens 8 Wörter, vorne ein passendes Emoji), die zur Lage passen und die DINGE und LEUTE aus der Umgebung nutzen (Fass rollen, auf den Tisch klettern, Kerzen umwerfen, die Wirtin nach dem Weg fragen …). narration darf leer bleiben.`;
    case "idle":
      return `Seit ${t.seconds} Sekunden hat niemand etwas getan. Erzähle in 1 Satz etwas Kleines, das neugierig macht: ein Geräusch, eine Bewegung, ein Geruch – oder eine Figur murmelt etwas (npc_say, passend zu ihrem Charakter). Wiederhole NICHT das Ziel und verrate keine Lösung. Keine Monster, keine Effekte, keine Probe.`;
    case "final_blow":
      return `${t.heroName} hat den Endgegner ${t.bossName} besiegt und beschreibt den letzten Schlag so: „${t.text}“
Erzähle diesen Moment in 2–3 packenden, bildhaften Sätzen nach – so, wie ${t.heroName} es beschrieben hat, nur größer und filmreifer. Der Gegner ist besiegt, das steht fest. Keine Monster, keine Probe, keine Effekte.`;
    case "campfire":
      return `Die Helden rasten am Lagerfeuer und erzählen sich etwas über sich:
${t.tales.map((x) => `- ${x.heroName} (gefragt: „${x.question}“): „${x.text}“`).join("\n")}
Erzähle in 2–3 warmen, bildhaften Sätzen den Abend am Feuer und greife dabei mindestens eine Erzählung liebevoll auf. Merke dir die Erzählungen: Baue sie später in die Geschichte ein (ein Wiedersehen, eine Angst, die wahr wird, ein Wunsch, der sich erfüllt). Keine Monster, keine Probe.`;
    case "npc_moment": {
      const how: Record<string, string> = {
        not_interested: "sie/er ist daran nicht interessiert (Romantik passt nicht) und lehnt freundlich, aber klar ab",
        great: "es gefällt ihr/ihm richtig gut – sie/er ist ganz hingerissen",
        yes: "es gefällt ihr/ihm, sie/er geht darauf ein",
        no: "heute klappt es nicht, sie/er bleibt freundlich-distanziert",
        too_much: "das war zu aufdringlich, sie/er ist verstimmt",
      };
      return `${t.heroName} flirtet mit ${t.npc}. Das Ergebnis steht schon fest: ${how[t.outcome] ?? t.outcome}. Antworte als ${t.npc} (npc_name, npc_text) genau nach ihrem/seinem Charakter und ihrer/seiner Sprechweise, jugendfrei, 1–2 Sätze; narration: ein kurzer Satz, was man sieht. Merke das in npc_memory.`;
    }
    case "story_end":
      return "Das Abenteuer ist zu Ende. Wähle das passende Ende (ending) und erzähle einen kurzen Ausklang, der auf das zurückblickt, was die Helden erlebt haben.";
    default:
      return `Ereignis: ${t.kind}`;
  }
}

/** What a moment needs to know: acting moments see the whole toolbox, small ones only the basics. */
function needs(trigger: DmTrigger) {
  const k = trigger.kind;
  const acting = k === "free_text" || k === "roll_result";
  const small = k === "suggest" || k === "rules_question" || k === "idle";
  return { acting, small, rules: k === "rules_question", room: acting || k === "suggest" || k === "idle" || k === "npc_moment" };
}

/** The characters' minds that matter now: who is here, who is named, who is being talked to. */
function mindsFor(ctx: DmContext, trigger: DmTrigger, sceneNpcs: string[]): string[] {
  if (!ctx.minds?.length) return [];
  const text = ("text" in trigger ? trigger.text : "").toLowerCase();
  const present = [...sceneNpcs, ...(ctx.room?.people ?? []).map((p) => p.name), ...(trigger.kind === "npc_moment" ? [trigger.npc] : [])].map((n) => n.toLowerCase());
  return ctx.minds.filter((m) => {
    const name = m.slice(0, m.indexOf(" (")).toLowerCase();
    return !!name && (present.some((p) => p.includes(name) || name.includes(p)) || text.includes(name.split(" ").pop()!));
  });
}

/**
 * The context for one moment. Stable lines come first (the provider can reuse that part of the
 * request more cheaply), and each moment gets only what it needs: rules questions and ideas no
 * toolbox, characters' minds only for the people who are here.
 */
export function buildPrompt(story: Story, ctx: DmContext, trigger: DmTrigger, scripted: DmResponse): string {
  const scene = sceneById(story, ctx.sceneId);
  const { act } = actOf(story, scene.id);
  const truth = story.truths.find((t) => t.id === ctx.truth);
  const npcs = (scene.npcs ?? []).map((n) => story.npcs.find((x) => x.id === n.npc)).filter((n) => !!n);
  const need = needs(trigger);
  const clues = need.acting ? allowedClues(story, scene, ctx) : [];
  const flags = need.acting ? allowedFlags(scene) : [];
  const found = ctx.cluesFound.map((id) => story.clues.find((c) => c.id === id)?.text).filter(Boolean);
  const minds = need.small ? [] : mindsFor(ctx, trigger, npcs.map((n) => n.name));
  const effects = allowedEffectNames(ctx, trigger);
  const lines = [
    // Stable for the whole adventure.
    `GESCHICHTE: ${story.title} – ${story.description}`,
    need.rules ? "" : `GEHEIME WAHRHEIT (nie direkt verraten): ${truth ? `${truth.title}: ${truth.summary}` : "–"}`,
    `HELDEN-IDS: ${ctx.players.map((p) => `${p.id} = ${p.name}`).join(", ")}`,
    need.acting && story.npcs.length ? `FIGUREN-IDS (für npc_attitude): ${story.npcs.map((n) => `${n.id} = ${n.name}`).join(", ")}` : "",
    // Stable for the scene.
    `KAPITEL: ${act.title} · SZENE ${ctx.sceneIndex + 1} von ${ctx.sceneCount}: ${scene.title}`,
    `ZIEL DER SZENE: ${scene.ziel}`,
    npcs.length && !need.rules ? `NICHTSPIELERFIGUREN HIER: ${npcs.map((n) => `${n.name} (${n.description})`).join("; ")}` : "",
    need.acting ? (clues.length ? `ERLAUBTE HINWEISE (reveal_clue = id): ${clues.map((c) => `${c.id}: ${c.text}`).join(" | ")}` : "ERLAUBTE HINWEISE: keine") : "",
    flags.length ? `ERLAUBTE MERKER (set_flags), wenn die Helden so etwas tun: ${flags.map((f) => `${f.flag} = ${f.meaning}`).join(" | ")}` : "",
    // The moment.
    need.rules ? "" : `Wendung schon enthüllt: ${ctx.twistRevealed ? "ja" : "nein"}`,
    `HELDEN: ${ctx.players.map((p) => `${p.name} (${nameOf("classes", p.classId)}, ${p.hp}/${p.maxHp} TP)`).join("; ")}`,
    need.rules ? "" : `SCHON GEFUNDENE HINWEISE: ${found.length ? found.join(" | ") : "keine"}`,
    ctx.combat
      ? `KAMPF LÄUFT. Gegner: ${ctx.combat.enemies.map((e) => `${e.id} = ${e.name} (${e.hp}/${e.maxHp} TP${e.boss ? ", Anführer" : ""})`).join("; ")}. Flucht möglich: ${canFlee(ctx) ? "ja" : "nein"}`
      : "",
    ctx.room && !need.rules ? `UMGEBUNG: ${ctx.room.name}${ctx.room.objects.length ? ` – ${ctx.room.objects.join(", ")}` : ""}` : "",
    need.room && ctx.room?.things?.length ? `DINGE (id = Name, für objekt/hingehen): ${ctx.room.things.map((t) => `${t.id} = ${t.name}`).join(", ")}` : "",
    need.room && ctx.room?.people?.length ? `LEUTE (id = Name, für figur/geschenk/hingehen): ${ctx.room.people.map((p) => `${p.id} = ${p.name}`).join(", ")}` : "",
    need.acting ? `GOLD DER GRUPPE: ${ctx.gold ?? 0} (Bestechung kostet ${BRIBE_PER_ENEMY} Gold pro Gegner)` : "",
    !need.small && ctx.chronicle?.length ? `CHRONIK (frühere Taten): ${ctx.chronicle.slice(-6).join(" | ")}` : "",
    !need.small && ctx.tales?.length ? `LAGERFEUER (die Helden über sich): ${ctx.tales.slice(-4).join(" | ")}` : "",
    minds.length ? `FIGUREN (Charakter, Gefühle, Gedächtnis):\n${minds.map((m) => `- ${m}`).join("\n")}` : "",
    !need.small && Object.keys(ctx.attitudes ?? {}).length
      ? `HALTUNG DER FIGUREN: ${Object.entries(ctx.attitudes!).map(([id, v]) => `${story.npcs.find((n) => n.id === id)?.name ?? id} ${v > 0 ? "+" : ""}${v}`).join(", ")}`
      : "",
    ctx.bypass && need.acting ? `ABKÜRZUNG möglich: ${ctx.bypass}. Nur mit schwerer Probe (SG 15–17), dann Effekt abkuerzung.` : "",
    effects.length
      ? `${isClearMiss(trigger) ? "RÜCKSCHLÄGE (wähle genau einen)" : "EFFEKTE"} (Name: Wirkung): ${effects.map((n) => `${n}: ${(EFFECT_HELP[n] ?? SETBACK_HELP[n])!.text}`).join(" | ")}. Ziele: Gegner-id aus KAMPF, Helden-id aus HELDEN-IDS, oder „alle“.`
      : "",
    need.rules ? "" : `ZEIT: ${Math.round(ctx.minutesPlayed)} von geplant ${Math.round(ctx.minutesPlanned)} Minuten bis Ende dieser Szene`,
    trigger.kind === "story_end" ? `MÖGLICHE ENDEN: ${eligibleEndings(story, ctx).map((e) => `${e.id} (${e.title})`).join(", ")}` : "",
    scripted.narration ? `DREHBUCH-VORSCHLAG (Inhalt beibehalten, frei formulieren): ${scripted.narration}` : "",
    trigger.kind === "scene_start" ? SCENE_PACK_NOTE : "",
    `JETZT: ${triggerText(trigger)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** At the start of a scene the AI also fills a small store for the rest of it (used without further calls). */
const SCENE_PACK_NOTE =
  "VORRAT FÜR DIESE SZENE: Schreib zusätzlich für jede Nichtspielerfigur hier einen kurzen Gruß in ihrer Art (gruesse) und 2–3 kleine Momente der Umgebung oder Gerüchte, die die Gruppe später hören kann, wenn es still ist (momente: Geräusche, Gerede, Andeutungen – nie die Lösung).";

const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: "STRING", description, ...extra });

export function responseSchema(story: Story, ctx: DmContext, trigger: DmTrigger): Record<string, unknown> {
  const scene = sceneById(story, ctx.sceneId);
  const properties: Record<string, unknown> = {
    narration: S("Erzähltext, höchstens 2 kurze Sätze, Deutsch"),
    npc_name: S("Name der sprechenden Nichtspielerfigur, sonst leer"),
    npc_text: S("Was sie sagt, sonst leer"),
  };
  if (ctx.minds?.length) properties.npc_memory = S("Was sich die sprechende Figur merkt (ein kurzer Satz aus ihrer Sicht), sonst leer");
  if (trigger.kind === "free_text") {
    properties.roll_skill = S("Fertigkeit für eine Probe oder none", { enum: ["none", ...SKILL_IDS] });
    properties.roll_dc = { type: "INTEGER", description: "Schwierigkeit 8–18, 0 wenn keine Probe" };
    properties.rueckfrage = S("Nur wenn die Idee wirklich unklar ist (z. B. „Ich mache was“): eine kurze Rückfrage an den Spieler, sonst leer");
    properties.plan = S("Bei einer Probe: was bei Erfolg passiert, in höchstens 8 Wörtern (z. B. „Das Fass rollt auf die Goblins“)");
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
          art: S("Art: boden feuer/oel/wasser/eis/schlamm; objekt umwerfen/zerschlagen/anzuenden/schieben/rollen; figur folgen/kommen/gehen/weg_zeigen; geschenk/zuwerfen gold/trank/fackel"),
          richtung: S("Ziel-id, wohin geschoben/gerollt/verbarrikadiert wird (optional)"),
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
  if (trigger.kind === "scene_start") {
    properties.gruesse = { type: "ARRAY", items: { type: "OBJECT", properties: { name: S("Name der Figur"), text: S("Gruß, ein kurzer Satz") }, required: ["name", "text"] } };
    properties.momente = { type: "ARRAY", items: S("Ein kurzer Satz") };
  }
  if (trigger.kind === "suggest") properties.ideas = { type: "ARRAY", items: S("Idee in Ich-Form") };
  if (trigger.kind === "rules_question") properties.answer = S("Antwort auf die Regelfrage, 2–4 Sätze");
  if (trigger.kind === "story_end") properties.ending = S("id des Endes", { enum: eligibleEndings(story, ctx).map((e) => e.id) });
  return { type: "OBJECT", properties, required: trigger.kind === "suggest" ? ["ideas"] : trigger.kind === "rules_question" ? ["answer"] : ["narration"] };
}
