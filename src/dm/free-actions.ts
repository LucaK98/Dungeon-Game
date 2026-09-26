/**
 * Free actions without AI: the scripted narrator recognises common ideas by keywords
 * (bribe, charm, scare, push, throw sand, search, bandage, …), asks for a fitting roll and
 * turns the result into effects from the toolbox (src/dm/effects.ts).
 * The AI does the same more freely; the rules check is shared.
 */
import { getSkill } from "../engine/data";
import type { DmContext, DmEffect, DmResponse, DmTrigger } from "../shared/dm";
import type { Narration } from "../shared/story";
import { canFlee } from "./combat-tricks";
import { BRIBE_PER_ENEMY } from "./effects";

type Intent =
  | "attack" | "help" | "cover" | "bribe" | "charm" | "surrender" | "scare" | "push" | "blind" | "hazard" | "trick"
  | "search" | "first_aid" | "door" | "reveal" | "befriend";

interface IntentRule {
  intent: Intent;
  words: RegExp;
  combat: boolean | "both";
  skill?: string;
  dc?: number;
}

/** Order matters: the first match wins. */
const RULES: IntentRule[] = [
  { intent: "help", words: /helf|hilf|unterstütz|beisteh|räuberleiter/, combat: "both" },
  { intent: "cover", words: /deckung|versteck|duck|hinter .*(fass|säule|stein|baum|kiste)/, combat: true },
  { intent: "bribe", words: /bestech|münz|goldstück|bezahl|zahl|geld|gold an/, combat: true, skill: "persuasion", dc: 12 },
  { intent: "charm", words: /verführ|betör|schmeichel|flirt|charm|umgarn|zwinker|küss|kuss|schöne augen|kompliment|tanz/, combat: true, skill: "persuasion", dc: 14 },
  { intent: "surrender", words: /ergeb|aufgeb|verhandel|frieden|überred|waffen nieder|lass.* gehen/, combat: true, skill: "persuasion", dc: 14 },
  { intent: "scare", words: /einschücht|droh|brüll|erschreck|verjag|verscheuch|angst/, combat: true, skill: "intimidation", dc: 13 },
  { intent: "push", words: /stoß|stoss|schubs|umwerf|umreiß|umreiss|bein stell|umrenn|zu boden|stolper/, combat: true, skill: "athletics", dc: 13 },
  { intent: "blind", words: /sand|blend|entwaffn|waffe .*(weg|aus der hand)|netz|mantel über|spuck/, combat: true, skill: "sleight-of-hand", dc: 13 },
  { intent: "hazard", words: /fass|fässer|kronleuchter|felsbrocken|stein|wirf|werf|schleuder|kiste|umkipp|lawine|seil/, combat: true, skill: "athletics", dc: 13 },
  { intent: "trick", words: /ablenk|täusch|trick|bluff|verwirr|lock|list|hinter dir/, combat: true, skill: "deception", dc: 13 },
  { intent: "attack", words: /greif|schlag|hau |haue|stech|schieß|schiess|angriff|attack|töte|kämpf|schwert/, combat: true },
  { intent: "befriend", words: /geschenk|schenk|bestech|kompliment|schmeichel|lob|freund/, combat: false, skill: "persuasion", dc: 12 },
  { intent: "search", words: /durchsuch|such|stöber|untersuch|wühl|schau.*(nach|unter|hinter)/, combat: false, skill: "investigation", dc: 12 },
  { intent: "first_aid", words: /verbind|verarzt|heil|pfleg|erste hilfe|wunde/, combat: false, skill: "medicine", dc: 10 },
  { intent: "door", words: /tür|schloss|aufbrech|knack|dietrich/, combat: false, skill: "sleight-of-hand", dc: 12 },
  { intent: "reveal", words: /geheim|verborgen|erkund|späh|ausschau|klettere hoch|überblick/, combat: false, skill: "perception", dc: 12 },
];

export function intentOf(text: string, fighting: boolean): IntentRule | undefined {
  const t = ` ${text.toLowerCase()} `;
  return RULES.find((r) => (r.combat === "both" || r.combat === fighting) && r.words.test(t));
}

/** Who is meant: the full name first ("Räuber 2"), then a unique first word ("Brunhild"). */
function mentioned<T extends { name: string }>(text: string, list: T[]): T | undefined {
  const t = text.toLowerCase();
  const full = list.filter((x) => t.includes(x.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (full) return full;
  const byWord = list.filter((x) => t.includes(x.name.toLowerCase().split(" ")[0]!));
  return byWord[0];
}

function line(text: string, tip?: Narration["tip"]): Narration {
  return tip ? { text, tip } : { text };
}

function respond(lines: Narration[], extra: Partial<DmResponse> = {}): DmResponse {
  return { narration: lines.map((l) => l.text).join(" "), script: lines, next: "await_action", ...extra };
}

/** First reaction to a free action (no roll yet). */
export function scriptedFreeText(ctx: DmContext, trigger: Extract<DmTrigger, { kind: "free_text" }>): DmResponse | undefined {
  const fighting = !!ctx.combat?.enemies.length;
  const rule = intentOf(trigger.text, fighting);
  const hero = trigger.heroName;
  if (!rule) return undefined;
  if (rule.intent === "attack") {
    return respond([
      line(`${hero} will angreifen – dafür gibt es den Knopf „⚔️ Angreifen“ auf dem Handy. Nur so wird der Schaden richtig ausgewürfelt.`, {
        key: "freie_aktion",
        text: "Freie Aktionen eignen sich im Kampf für Tricks: ablenken, umstoßen, Sand werfen, bestechen, betören oder einschüchtern.",
      }),
    ]);
  }
  if (rule.intent === "help") {
    const friend = mentioned(trigger.text, ctx.players.filter((p) => p.id !== trigger.playerId));
    if (!friend) return respond([line(`Wem will ${hero} helfen? Nennt den Namen des Helden, z. B. „Ich helfe Brunhild“.`)]);
    return respond([line(`${hero} eilt ${friend.name} zu Hilfe.`)], { effects: [{ kind: "help", target: friend.id }] });
  }
  if (rule.intent === "cover") return respond([line(`${hero} sucht Deckung.`)], { effects: [{ kind: "cover" }] });
  if (rule.intent === "bribe" && (ctx.gold ?? 0) < BRIBE_PER_ENEMY) {
    return respond([line(`${hero} greift in den Beutel – aber die Gruppe hat nicht genug Gold für eine Bestechung (${BRIBE_PER_ENEMY} pro Gegner).`)]);
  }
  const skill = rule.skill!;
  return respond([line(`${hero} versucht es. Gelingt die Probe?`)], {
    request_roll: { playerId: trigger.playerId, ability: getSkill(skill as never).ability, skill, dc: rule.dc! },
    next: "await_roll",
  });
}

/** Effects the scripted narrator wants after the roll (filterEffects decides what is allowed). */
export function scriptedRollResult(ctx: DmContext, trigger: Extract<DmTrigger, { kind: "roll_result" }>): DmResponse {
  const fighting = !!ctx.combat?.enemies.length;
  const rule = intentOf(trigger.text, fighting);
  const margin = trigger.total - trigger.dc;
  const hero = trigger.heroName;
  const nearMiss = !trigger.success && margin >= -2;
  const intro = trigger.success ? (margin >= 5 ? "Großartig geschafft!" : "Geschafft!") : nearMiss ? "Knapp! Es klappt – aber nicht ohne Preis." : "Leider nicht.";
  if (!rule || (!trigger.success && !nearMiss)) return respond([line(`${intro} ${trigger.success ? `${hero} gelingt es.` : `${hero} versucht es, aber es klappt nicht.`}`)]);

  const enemies = ctx.combat?.enemies ?? [];
  const named = mentioned(trigger.text, enemies);
  const ordinary = enemies.filter((e) => !e.boss);
  const one = named && !named.boss ? named : ordinary[0];
  const all = /alle|ihr |euch|die räuber|die wölfe|die kobolde/.test(trigger.text.toLowerCase());
  const effects: DmEffect[] = [];
  switch (rule.intent) {
    case "bribe":
    case "charm":
    case "surrender": {
      const how = rule.intent === "bribe" ? "bestechen" : rule.intent === "charm" ? "betoeren" : "ergeben";
      const target = all && ordinary.length > 1 ? "all" : one?.id;
      if (target) effects.push({ kind: "pacify", target, how });
      else effects.push({ kind: "distract", target: (named ?? enemies[0])!.id });
      break;
    }
    case "scare":
      if (canFlee(ctx)) effects.push({ kind: "flee" });
      else if (one) effects.push({ kind: "pacify", target: one.id, how: "ergeben" });
      else effects.push({ kind: "distract", target: enemies[0]!.id });
      break;
    case "push":
      if (one) effects.push({ kind: "prone", target: one.id });
      break;
    case "blind":
      if (one) effects.push({ kind: "hamper", target: one.id });
      break;
    case "hazard":
      effects.push({ kind: "hazard", target: (named ?? enemies[0])!.id, severity: margin >= 5 ? "schwer" : "mittel" });
      break;
    case "trick":
      effects.push({ kind: "distract", target: (named ?? enemies[0])!.id });
      break;
    case "search":
      effects.push({ kind: "find", item: margin >= 5 ? "trank" : "gold" });
      break;
    case "first_aid": {
      const patient = mentioned(trigger.text, ctx.players) ?? [...ctx.players].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (patient) effects.push({ kind: "first_aid", target: patient.id });
      break;
    }
    case "door":
      effects.push({ kind: "open_door" });
      break;
    case "reveal":
      effects.push({ kind: "reveal" });
      break;
    case "befriend":
      break;
  }
  if (rule.intent === "befriend") return respond([line(trigger.success ? `${intro} Das kommt gut an.` : intro)]);
  return respond([line(intro)], { effects });
}

/** "Was könnte ich tun?" without AI: ideas that the keywords above understand. */
export function scriptedIdeas(ctx: DmContext): string[] {
  const enemies = ctx.combat?.enemies ?? [];
  if (enemies.length) {
    const e = enemies.find((x) => !x.boss) ?? enemies[0]!;
    const ideas = [`Ich werfe ${e.name} Sand in die Augen`, `Ich stoße ${e.name} um`, "Ich brülle sie an und verjage sie"];
    if ((ctx.gold ?? 0) >= BRIBE_PER_ENEMY) ideas.push(`Ich biete ${e.name} Gold an, damit er aufhört`);
    ideas.push(`Ich mache ${e.name} schöne Augen`);
    if (ctx.room?.objects.some((o) => /Fäss|Kiste|Fels/.test(o))) ideas.push(`Ich werfe ein Fass auf ${e.name}`);
    return ideas.slice(0, 4);
  }
  const ideas = ["Ich durchsuche den Raum", "Ich halte Ausschau nach verborgenen Wegen"];
  const hurt = ctx.players.find((p) => p.hp < p.maxHp);
  if (hurt) ideas.push(`Ich verbinde ${hurt.name}s Wunden`);
  if (ctx.room?.objects.includes("Tür")) ideas.push("Ich knacke das Schloss der Tür");
  return ideas.slice(0, 4);
}
